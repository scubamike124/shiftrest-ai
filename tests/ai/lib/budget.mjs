// Hard token cap shared by every model call an eval makes (the app provider
// and the llm-rubric grader). The wrapper (tests/ai/run-evals.mjs) sets the cap
// and a ledger path; without them, paid calls are refused outright so nobody
// can run an uncapped eval by calling `promptfoo eval` directly.
//
// Accounting is conservative: before a call, the prompt estimate plus the full
// output allowance is reserved; after it, the reservation is replaced with the
// usage the provider reports (or the estimate, if it reports none). A call that
// would push the total past the cap is refused, not sent.
import fs from "node:fs";

const state = (globalThis.__restpilotEvalBudget ??= {
  used: 0,
  reserved: 0,
  calls: 0,
  refused: 0,
  cachedHits: 0,
  costUsd: 0,
  loaded: false,
});

export function estimateTokens(text) {
  // ~3.5 characters per token for English prose; rounds up on purpose.
  return Math.ceil(String(text ?? "").length / 3.5);
}

function cap() {
  const raw = process.env.RESTPILOT_EVAL_MAX_TOKENS;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ledgerPath() {
  return process.env.RESTPILOT_EVAL_LEDGER || null;
}

function load() {
  if (state.loaded) return;
  state.loaded = true;
  const p = ledgerPath();
  if (p && fs.existsSync(p)) {
    try {
      const prev = JSON.parse(fs.readFileSync(p, "utf8"));
      state.used = Number(prev.used) || 0;
      state.calls = Number(prev.calls) || 0;
      state.refused = Number(prev.refused) || 0;
      state.cachedHits = Number(prev.cachedHits) || 0;
      state.costUsd = Number(prev.costUsd) || 0;
    } catch {
      /* corrupt ledger: start from zero but keep the cap */
    }
  }
}

function persist() {
  const p = ledgerPath();
  if (!p) return;
  const data = {
    cap: cap(),
    used: state.used,
    calls: state.calls,
    refused: state.refused,
    cachedHits: state.cachedHits,
    costUsd: Number(state.costUsd.toFixed(6)),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export class BudgetExceeded extends Error {
  constructor(message) {
    super(message);
    this.name = "BudgetExceeded";
  }
}

/** Reserve tokens for one call. Throws BudgetExceeded instead of overspending. */
export function reserve(estimate) {
  load();
  const limit = cap();
  if (limit === null) {
    state.refused += 1;
    persist();
    throw new BudgetExceeded(
      "COST_CAP: no token cap set. Run evals through `node tests/ai/run-evals.mjs`, which sets RESTPILOT_EVAL_MAX_TOKENS.",
    );
  }
  if (state.used + state.reserved + estimate > limit) {
    state.refused += 1;
    persist();
    throw new BudgetExceeded(
      `COST_CAP: refused a call needing ~${estimate} tokens; ${state.used} used + ${state.reserved} in flight of a ${limit}-token cap.`,
    );
  }
  state.reserved += estimate;
  return estimate;
}

/** Settle a reservation with actual usage. */
export function settle(reservation, actualTokens, costUsd = 0) {
  state.reserved = Math.max(0, state.reserved - reservation);
  state.used += actualTokens;
  state.calls += 1;
  state.costUsd += costUsd;
  persist();
}

export function release(reservation) {
  state.reserved = Math.max(0, state.reserved - reservation);
  persist();
}

export function noteCacheHit() {
  load();
  state.cachedHits += 1;
  persist();
}

/** Optional USD estimate from env prices (per million tokens). */
export function priceUsd(promptTokens, completionTokens) {
  const pin = Number(process.env.RESTPILOT_EVAL_PRICE_IN_PER_MTOK || 0);
  const pout = Number(process.env.RESTPILOT_EVAL_PRICE_OUT_PER_MTOK || 0);
  return (promptTokens * pin + completionTokens * pout) / 1_000_000;
}

export function snapshot() {
  load();
  return { cap: cap(), ...state };
}
