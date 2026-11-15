/**
 * Spend guard for every paid call the companion evals make (app provider and
 * llm-rubric judge): a hard token cap plus a disk response cache.
 *
 * Cap. RESTPILOT_EVAL_MAX_TOKENS must be set (run.mjs and tests/ai/run-evals.mjs
 * set it); without it every paid call is refused, so a bare `promptfoo eval`
 * cannot spend. Before each call the worst case (prompt estimate + full output
 * allowance) is reserved; a call that would cross the cap is refused, not sent.
 * Afterwards the reservation is replaced by the reported usage. The running
 * total is mirrored to RESTPILOT_EVAL_LEDGER (JSON) for the CI summary.
 *
 * Cache. Responses are stored under tests/ai/.cache/responses keyed on the
 * endpoint, model, full request body and repeat index. Promptfoo's --no-cache
 * (context.bustCache) or RESTPILOT_EVAL_CACHE=off disables reads and writes.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const state = (globalThis.__restpilotEvalGuard ??= {
  used: 0,
  reserved: 0,
  calls: 0,
  refused: 0,
  cachedHits: 0,
  costUsd: 0,
  loaded: false,
});

const CACHE_DIR =
  process.env.RESTPILOT_EVAL_CACHE_DIR || path.resolve(__dirname, "../../.cache/responses");

class BudgetExceeded extends Error {}

function cap() {
  const n = Number(process.env.RESTPILOT_EVAL_MAX_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function load() {
  if (state.loaded) return;
  state.loaded = true;
  const p = process.env.RESTPILOT_EVAL_LEDGER;
  if (!p || !fs.existsSync(p)) return;
  try {
    const prev = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const k of ["used", "calls", "refused", "cachedHits", "costUsd"])
      state[k] = Number(prev[k]) || 0;
  } catch {
    /* start from zero; the cap still applies */
  }
}

function persist() {
  const p = process.env.RESTPILOT_EVAL_LEDGER;
  if (!p) return;
  const { used, calls, refused, cachedHits, costUsd } = state;
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        cap: cap(),
        used,
        calls,
        refused,
        cachedHits,
        costUsd: Number(costUsd.toFixed(6)),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

/** ~3.5 characters per token for English prose, rounded up on purpose. */
function estimateTokens(text) {
  return Math.ceil(String(text ?? "").length / 3.5);
}

function reserve(tokens) {
  load();
  const limit = cap();
  if (limit === null) {
    state.refused += 1;
    persist();
    throw new BudgetExceeded(
      "COST_CAP: no token cap set. Run through tests/ai/companion/run.mjs or tests/ai/run-evals.mjs (they set RESTPILOT_EVAL_MAX_TOKENS).",
    );
  }
  if (state.used + state.reserved + tokens > limit) {
    state.refused += 1;
    persist();
    throw new BudgetExceeded(
      `COST_CAP: refused a call needing up to ${tokens} tokens; ${state.used} used + ${state.reserved} in flight of a ${limit}-token cap.`,
    );
  }
  state.reserved += tokens;
  return tokens;
}

function settle(reservation, actualTokens, costUsd = 0) {
  state.reserved = Math.max(0, state.reserved - reservation);
  state.used += Math.max(0, actualTokens || 0);
  state.calls += 1;
  state.costUsd += Number(costUsd) || 0;
  persist();
}

function cacheEnabled(context) {
  if (context && context.bustCache) return false;
  return !/^(0|off|false|no)$/i.test(process.env.RESTPILOT_EVAL_CACHE || "");
}

function cacheKey(parts) {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function readCache(key) {
  try {
    const hit = JSON.parse(
      fs.readFileSync(path.join(CACHE_DIR, key.slice(0, 2), `${key}.json`), "utf8"),
    );
    load();
    state.cachedHits += 1;
    persist();
    return hit;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  const dir = path.join(CACHE_DIR, key.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.json`);
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
}

/**
 * Run one paid call under the guard.
 *   parts      everything that changes the answer (cache key material)
 *   estimate   worst-case tokens (prompt estimate + output allowance)
 *   call       async () => provider result ({output, tokenUsage, cost} | {error})
 *   unavailable  error text when the call cannot be made (e.g. missing key)
 */
async function guarded({ parts, estimate, context, call, unavailable }) {
  const useCache = cacheEnabled(context);
  const key = cacheKey({ v: 1, ...parts, repeat: context?.repeatIndex ?? 0 });
  if (useCache) {
    const hit = readCache(key);
    if (hit) return { ...hit, cached: true };
  }
  // Cache first: a warm cache answers without any key. A miss without a key is
  // reported (never faked) and costs nothing.
  if (unavailable) return { error: unavailable };
  let reservation;
  try {
    reservation = reserve(estimate);
  } catch (e) {
    if (e instanceof BudgetExceeded) return { error: e.message };
    throw e;
  }
  let result;
  try {
    result = await call();
  } finally {
    const used =
      result?.tokenUsage?.total ?? (result && !result.error ? estimate : Math.ceil(estimate / 2));
    settle(reservation, used, result?.cost ?? 0);
  }
  if (useCache && result && !result.error && result.output) writeCache(key, result);
  return result;
}

function snapshot() {
  load();
  return { cap: cap(), ...state };
}

module.exports = { guarded, reserve, settle, estimateTokens, snapshot, BudgetExceeded, cacheKey };
