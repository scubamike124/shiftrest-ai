/**
 * Builds the exact system prompt production sends, by loading the app's own
 * TypeScript prompt code (context.server.ts, prompts.server.ts, the /api/ai
 * intent prompts) and feeding it a scenario's fixture data through a fake
 * database client. No network, no database, no provider: prompt assembly only.
 *
 * Production code calls `new Date()`; each scenario freezes the clock
 * (vars.user.now, local to vars.user.tz) so schedules, signals and the user's
 * own words agree.
 *
 * Promptfoo prompt function: file://lib/production-prompt.cjs:buildMessages
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { at, zoned } = require("./time.cjs");

const ROOT = path.resolve(__dirname, "../../../..");
const SRC = path.join(ROOT, "src");
const ts = require(path.join(ROOT, "node_modules", "typescript"));

const RealDate = Date;
let frozenNow = RealDate.now();
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(frozenNow);
    else super(...args);
  }
  static now() {
    return frozenNow;
  }
}
const sandbox = vm.createContext({ Date: FrozenDate, console, URL, TextEncoder, TextDecoder, setTimeout, clearTimeout, process: { env: {} } });

const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`benchmark loader cannot resolve ${spec} from ${fromDir}`);
}
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = (spec) => {
    if (spec.startsWith("@/") || spec.startsWith(".")) return loadTs(resolveFile(spec, path.dirname(file)));
    throw new Error(`benchmark loader refuses external import ${spec} in ${file}`);
  };
  const fn = vm.runInContext(`(function (exports, require, module, __filename, __dirname) {${js}\n})`, sandbox, { filename: file });
  fn(module.exports, localRequire, module, file, path.dirname(file));
  return module.exports;
}
const lib = (p) => loadTs(resolveFile(p, SRC));

/** The JSON-intent prompts live as private constants in the /api/ai route. */
function intentPrompts() {
  if (intentPrompts.value) return intentPrompts.value;
  const src = fs.readFileSync(path.join(SRC, "routes/api/ai.ts"), "utf8");
  const take = (name) => {
    const m = src.match(new RegExp("const " + name + " = `([\\s\\S]*?)`;\\n"));
    if (!m) throw new Error(`intent prompt ${name} not found in ai.ts`);
    return m[1];
  };
  const coachVoice = take("COACH_VOICE");
  const sub = (s) => s.replace(/\$\{COACH_VOICE\}/g, coachVoice);
  const value = {
    IMPACT_CONTRACT: take("IMPACT_CONTRACT"),
    daily_plan: sub(take("DAILY_PLAN_SYSTEM")),
    smart_alarm: sub(take("SMART_ALARM_SYSTEM")),
    commute: sub(take("COMMUTE_SYSTEM")),
    right_now: sub(take("RIGHT_NOW_SYSTEM")),
    adjust_plan: sub(take("ADJUST_PLAN_SYSTEM")),
    tomorrow_preview: sub(take("TOMORROW_PREVIEW_SYSTEM")),
    daily_review: sub(take("DAILY_REVIEW_SYSTEM")),
    jetlag_plan: sub(take("JETLAG_PLAN_SYSTEM")),
  };
  for (const v of Object.values(value)) {
    if (v.includes("${")) throw new Error("unresolved template expression in an intent prompt");
  }
  intentPrompts.value = value;
  return value;
}

/** Chainable stand-in for the Supabase client. Filters are ignored: fixtures are per scenario. */
function fakeAdmin(tables) {
  return {
    from(table) {
      const rows = tables[table] ?? [];
      const builder = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") return (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject);
            if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: rows[0] ?? null, error: null });
            return () => builder;
          },
        },
      );
      return builder;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

const iso = (ms) => new RealDate(ms).toISOString();
const ymd = (ms, tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new RealDate(ms));

/**
 * Expand a compact scenario `user` fixture into the rows the prompt code reads.
 * Clock fields are local to user.tz relative to user.now ("2026-11-17T16:30").
 *   nights: newest first, [{ d, at: "08:15", min, hrv?, rhr?, eff? }]  (sleep start, local)
 *   shifts: [{ d, at: "19:00", hours, title?, type? }]
 */
function fixtureTables(user = {}) {
  const tz = user.tz ?? "America/Chicago";
  const nowLocal = user.now ?? "2026-11-17T16:30";
  const prefs = {
    user_id: "bench-user",
    sleep_hours: user.goalHours ?? 7.5,
    wind_down_min: user.windDownMin ?? 30,
    home_tz: user.homeTz ?? tz,
    current_tz: tz,
    assistant_name: user.assistantName ?? "RestPilot",
    assistant_mode: user.mode ?? "coach",
    memory_enabled: (user.memories ?? []).length > 0 || Boolean(user.memoryEnabled),
    voice_language: user.language ?? "en-US",
    voice_accent: null,
  };
  const nights = (user.nights ?? []).map((n) => {
    const start = at(nowLocal, tz, n.at, n.d ?? 0);
    const end = start + n.min * 60_000;
    return {
      provider: user.wearable ?? "oura",
      date: ymd(end, tz),
      sleep_start: iso(start),
      sleep_end: iso(end),
      sleep_duration_min: n.min,
      sleep_efficiency: n.eff ?? null,
      hrv_ms: n.hrv ?? null,
      resting_hr: n.rhr ?? null,
    };
  });
  const shifts = (user.shifts ?? []).map((s) => {
    const start = at(nowLocal, tz, s.at, s.d ?? 0);
    return { start_utc: iso(start), end_utc: iso(start + s.hours * 3600_000), starts_at: iso(start), title: s.title ?? null, shift_type: s.type ?? null };
  });
  const now = zoned(nowLocal, tz);
  const memories = (user.memories ?? []).map((content, i) => ({
    id: `m${i}`, content, category: "preference", pinned: i === 0, importance: 3, confidence: 0.9,
    use_count: 1, last_referenced_at: null, updated_at: iso(now - i * 3600_000), expires_at: null, superseded_by: null,
  }));
  const patterns = (user.patterns ?? []).map((key, i) => ({
    id: `p${i}`, pattern_key: key, severity: 4, signals_json: {}, last_seen_at: iso(now - 3600_000), occurrences: 3,
  }));
  const events = user.alarm ? [{ starts_at: iso(at(nowLocal, tz, user.alarm.at, user.alarm.d ?? 0)), title: "Smart alarm" }] : [];
  return {
    user_prefs: [prefs],
    wearable_readings: user.wearable === "none" ? [] : nights,
    shifts,
    user_events: events,
    ai_memory: memories,
    ai_patterns: patterns,
    ai_recommendations: [],
    ai_feedback: [],
    trips: user.trip ? [user.trip] : [],
    tz_events: [],
  };
}

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

/**
 * vars.kind: "coach" | "voice" | "intent" | "brief"
 * vars.turns: chat history [{role, content}] (coach/voice)
 * vars.intent + vars.payload: JSON intents
 * vars.user: fixture (see fixtureTables)
 */
async function build({ vars }) {
  const user = parse(vars.user) ?? {};
  const turns = parse(vars.turns) ?? [];
  const tz = user.tz ?? "America/Chicago";
  frozenNow = zoned(user.now ?? "2026-11-17T16:30", tz);
  const kind = vars.kind ?? "coach";
  const context = lib("@/lib/ai/context.server");
  const { buildTimeDirective } = lib("@/lib/ai/time-directive");
  const { classifyIntent } = lib("@/lib/ai/intent-hint.server");
  const prompts = lib("@/lib/ai/prompts.server");
  const admin = fakeAdmin(fixtureTables(user));
  const profile = await context.loadAssistantProfile(admin, "bench-user");
  const time = buildTimeDirective({ localTime: iso(frozenNow), timezone: tz }).directive;

  if (kind === "brief") {
    const system = prompts.languageDirective(profile.language, profile.accent) + prompts.BRIEF_SYSTEM + time;
    return [{ role: "system", content: system }, { role: "user", content: vars.plan }];
  }
  if (kind === "intent") {
    const p = intentPrompts();
    const system = await context.buildSystemPrompt({ admin, userId: "bench-user", profile, liveContext: vars.context, intent: vars.intent });
    const payload = parse(vars.payload) ?? {};
    return [
      { role: "system", content: `${system}${time}\n\n${p[vars.intent]}\n\n${p.IMPACT_CONTRACT}` },
      { role: "user", content: JSON.stringify({ ...payload, nowIso: iso(frozenNow) }) },
    ];
  }
  const lastUser = [...turns].reverse().find((m) => m.role === "user");
  const system = await context.buildSystemPrompt({
    admin, userId: "bench-user", profile, liveContext: vars.context, intent: "coach",
    surface: kind === "voice" ? "voice" : "text", expand: false, intentHint: classifyIntent(lastUser?.content),
  });
  return [{ role: "system", content: system + time }, ...turns.slice(-20)];
}

/** Serialized: the frozen clock is shared module state. */
let chain = Promise.resolve();
function buildMessages(args) {
  const next = chain.then(() => build(args));
  chain = next.catch(() => {});
  return next;
}

module.exports = { buildMessages, fixtureTables, fakeAdmin, intentPrompts, loadTs: lib };
