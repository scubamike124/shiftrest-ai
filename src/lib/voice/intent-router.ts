/**
 * Deterministic intent parser for Companion voice commands.
 *
 * Pure / side-effect free so it can be unit-tested and reused. The router
 * NEVER guesses — every supported intent has a strict pattern and a high
 * confidence. Ambiguous phrases return `{ kind: "unknown", alternates }`
 * so the UI can ask for confirmation rather than firing the wrong action.
 *
 * Phase 7 extends the original /sleep grammar with cross-skill commands
 * (Quiet Mode, agenda, weather, traffic, reminders, tasks, settings).
 */
import { TRACKS } from "@/lib/sounds/catalog";

export type OpenRouteTarget =
  | "/events"
  | "/sleep"
  | "/companion"
  | "/plan"
  | "/memory"
  | "/inbox"
  | "/automations"
  | "/smart-home"
  | "/dashboard"
  | "/settings/companion"
  | "/settings/skills";

export type Intent =
  | { kind: "play_track"; slug: string; label: string }
  | { kind: "stop_all" }
  | { kind: "set_timer"; minutes: number }
  | { kind: "save_mix"; name?: string }
  | { kind: "wake_at"; hour: number; minute: number }
  | { kind: "sleep_mode" }
  | { kind: "breathing" }
  | { kind: "goodnight" }
  // Phase 7 — cross-skill
  | { kind: "quiet_mode"; on: boolean }
  | { kind: "show_agenda"; when: "today" | "tomorrow" }
  | { kind: "check_weather"; when: "today" | "tomorrow" }
  | { kind: "check_traffic" }
  | { kind: "add_reminder"; text: string }
  | { kind: "complete_task"; text: string }
  | { kind: "open_route"; to: OpenRouteTarget; label: string }
  | { kind: "cancel" }
  | { kind: "unknown"; alternates?: string[] };

export type ParsedIntent = { intent: Intent; confidence: number; raw: string };

// ---------- track alias table ----------

/** Manual aliases for words people actually say. Lowercase, no punctuation. */
const TRACK_ALIASES: Record<string, string> = {
  rain: "rain",
  rainfall: "rain",
  raining: "rain",
  ocean: "ocean",
  waves: "ocean",
  sea: "ocean",
  river: "river",
  stream: "river",
  creek: "river",
  wind: "wind",
  breeze: "wind",
  "white noise": "white_noise",
  "pink noise": "pink_noise",
  "brown noise": "brown_noise",
  noise: "white_noise",
  fan: "fan",
  fireplace: "fireplace",
  fire: "fireplace",
  forest: "forest",
  woods: "forest",
  thunder: "thunder",
  storm: "thunder",
  "coffee shop": "coffee_shop",
  cafe: "coffee_shop",
  café: "coffee_shop",
  crickets: "crickets",
  "night crickets": "crickets",
  cabin: "cabin",
  // Phase 1 polish — broad "music / sleep sounds / nature" requests map to a
  // calm default so the Companion can fulfil them instead of replying "I can't".
  music: "brown_noise",
  "relaxing music": "brown_noise",
  "sleep music": "brown_noise",
  "calming music": "brown_noise",
  "soft music": "brown_noise",
  "sleep sounds": "brown_noise",
  "sleep sound": "brown_noise",
  "calming sounds": "brown_noise",
  "relaxing sounds": "brown_noise",
  "nature sounds": "forest",
  nature: "forest",
  "something calming": "brown_noise",
  "something relaxing": "brown_noise",
  "something soothing": "brown_noise",
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s:']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveTrack(phrase: string): { slug: string; label: string } | null {
  const raw = normalize(phrase);
  const cleaned = raw.replace(/\b(some|the|a|please|on|now)\b/g, " ").replace(/\s+/g, " ").trim();
  const candidates = Array.from(new Set([raw, cleaned, cleaned.replace(/\b(sound|sounds|noises)\b/g, " ").replace(/\s+/g, " ").trim()]))
    .filter(Boolean);

  const aliasKeys = Object.keys(TRACK_ALIASES).sort((a, b) => b.length - a.length);

  for (const c of candidates) {
    if (TRACK_ALIASES[c]) {
      const t = TRACKS.find((x) => x.slug === TRACK_ALIASES[c]);
      if (t) return { slug: t.slug, label: t.label };
    }
    for (const k of aliasKeys) {
      const re = new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`);
      if (re.test(c)) {
        const t = TRACKS.find((x) => x.slug === TRACK_ALIASES[k]);
        if (t) return { slug: t.slug, label: t.label };
      }
    }
    for (const t of TRACKS) {
      if (c === t.label.toLowerCase()) return { slug: t.slug, label: t.label };
    }
  }
  return null;
}

// ---------- intent patterns ----------

const RE_STOP =
  /^(?:please\s+)?(?:stop|silence|mute|kill|turn\s+off|shut\s+off|end|pause|quiet)\b(?:\s+(?:everything|all|sound|sounds|music|noise|the\s+sound|the\s+music|it))?\s*$/i;

const RE_CANCEL = /^(?:cancel|never\s*mind|nevermind|forget\s+it)\s*$/i;

const RE_TIMER =
  /\b(?:(?:set\s+)?(?:a\s+|the\s+)?(?:sleep\s+)?timer|sleep\s+timer|timer|fade(?:\s+out)?)\s*(?:for|to|at|in)?\s*(\d{1,3})\s*(?:min|mins|minute|minutes|m)\b/i;

const RE_SAVE = /^(?:please\s+)?save\s+(?:this\s+|my\s+|the\s+)?mix(?:\s+as\s+(.+))?$/i;

// Match the verb+object FIRST ("set my smart alarm", "create an alarm",
// "schedule alarm", "wake me up"), then the time. This lets us catch
// every common phrasing without false positives on bare clock mentions.
const RE_WAKE =
  /\b(?:wake\s+(?:me\s+)?(?:up\s+)?|(?:set|create|schedule|make|add|put)\s+(?:up\s+)?(?:my\s+|an?\s+|the\s+)?(?:smart\s+)?alarm)\s*(?:for|at|to)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;

const RE_SLEEP_MODE =
  /^(?:start\s+)?(?:sleep\s+mode|night\s+mode|bedtime\s+mode|bedtime(?:\s+routine)?)\s*$/i;

const RE_BREATHING =
  /^(?:start\s+)?(?:breathing(?:\s+exercise)?|breath(?:ing)?(?:\s+work)?|breathe|box\s+breathing|4\s*7\s*8|four\s+seven\s+eight)\s*$/i;

const RE_GOODNIGHT = /^(?:good\s*night|goodnight|night\s+night|tuck\s+me\s+in)\s*$/i;

// Phase 7 — Quiet Mode
const RE_QUIET_ON =
  /^(?:please\s+)?(?:turn\s+on|enable|start|activate|switch\s+on)\s+(?:quiet\s+mode|do\s+not\s+disturb|dnd)\s*$/i;
const RE_QUIET_OFF =
  /^(?:please\s+)?(?:turn\s+off|disable|stop|deactivate|switch\s+off|end)\s+(?:quiet\s+mode|do\s+not\s+disturb|dnd)\s*$/i;

// Agenda / schedule
const RE_AGENDA =
  /^(?:show|what(?:'s|\s+is)|tell\s+me)\s+(?:me\s+)?(?:my\s+|the\s+)?(?:agenda|schedule|calendar|plan|events?)\s*(?:for\s+)?(today|tomorrow|tonight)?\s*$/i;
const RE_AGENDA_SHORT =
  /^(?:tomorrow'?s?|today'?s?)\s+(?:agenda|schedule|plan|events?)\s*$/i;

// Weather
const RE_WEATHER =
  /^(?:check\s+|what(?:'s|\s+is)\s+|how(?:'s|\s+is)\s+|show\s+(?:me\s+)?)?(?:the\s+)?weather(?:\s+(today|tomorrow|tonight))?\s*$/i;

// Traffic
const RE_TRAFFIC =
  /^(?:check\s+|what(?:'s|\s+is)\s+|how(?:'s|\s+is)\s+|show\s+(?:me\s+)?)?(?:the\s+)?traffic\s*$/i;

// Reminders / tasks
const RE_REMINDER =
  /^(?:please\s+)?(?:add\s+(?:a\s+)?reminder(?:\s+to)?|remind\s+me\s+to|create\s+(?:a\s+)?reminder(?:\s+to)?)\s+(.+?)\s*$/i;
const RE_COMPLETE =
  /^(?:please\s+)?(?:mark|check\s+off|complete|finish)\s+(?:the\s+|my\s+)?(?:task\s+|reminder\s+)?(.+?)\s+(?:as\s+)?(?:complete|completed|done|finished)\s*$/i;

// Open settings / pages
const RE_OPEN_SETTINGS =
  /^(?:open|go\s+to|show)\s+(?:my\s+|the\s+)?(.+?)\s+settings?\s*$/i;
const RE_OPEN_PAGE =
  /^(?:open|go\s+to|show)\s+(?:my\s+|the\s+)?(inbox|memory|automations?|routines?|smart\s*home|dashboard|sleep|companion|events?|plan)\s*$/i;

const RE_PLAY =
  /^(?:please\s+)?(?:play|start|put\s+on|i\s+(?:want|need|would\s+like))\s+(.+?)\s*$/i;

// ---------- main parser ----------

export function parseIntent(input: string): ParsedIntent {
  const raw = (input ?? "").trim();
  const text = normalize(raw);
  if (!text) return { intent: { kind: "unknown" }, confidence: 0, raw };

  if (RE_CANCEL.test(text)) return { intent: { kind: "cancel" }, confidence: 1, raw };
  if (RE_GOODNIGHT.test(text)) return { intent: { kind: "goodnight" }, confidence: 1, raw };

  if (RE_QUIET_ON.test(text)) return { intent: { kind: "quiet_mode", on: true }, confidence: 1, raw };
  if (RE_QUIET_OFF.test(text)) return { intent: { kind: "quiet_mode", on: false }, confidence: 1, raw };

  if (RE_SLEEP_MODE.test(text)) return { intent: { kind: "sleep_mode" }, confidence: 1, raw };
  if (RE_BREATHING.test(text)) return { intent: { kind: "breathing" }, confidence: 1, raw };
  if (RE_STOP.test(text)) return { intent: { kind: "stop_all" }, confidence: 1, raw };

  const mAgenda = text.match(RE_AGENDA) ?? text.match(RE_AGENDA_SHORT);
  if (mAgenda) {
    const w = (mAgenda[1] ?? (RE_AGENDA_SHORT.test(text) && /tomorrow/.test(text) ? "tomorrow" : "today")).toLowerCase();
    const when = w.startsWith("tomorrow") ? "tomorrow" : "today";
    return { intent: { kind: "show_agenda", when }, confidence: 0.95, raw };
  }

  const mWeather = text.match(RE_WEATHER);
  if (mWeather) {
    const w = (mWeather[1] ?? "today").toLowerCase();
    const when = w.startsWith("tomorrow") ? "tomorrow" : "today";
    return { intent: { kind: "check_weather", when }, confidence: 0.9, raw };
  }

  if (RE_TRAFFIC.test(text)) return { intent: { kind: "check_traffic" }, confidence: 0.95, raw };

  // Timer — match BEFORE save so "save my mix for 30 minutes" never wins timer.
  const mTimer = text.match(RE_TIMER);
  if (mTimer) {
    const minutes = clamp(parseInt(mTimer[1], 10), 1, 180);
    return { intent: { kind: "set_timer", minutes }, confidence: 0.95, raw };
  }

  const mSave = text.match(RE_SAVE);
  if (mSave) {
    const name = mSave[1]?.trim();
    return { intent: { kind: "save_mix", name: name || undefined }, confidence: 0.95, raw };
  }

  const mWake = text.match(RE_WAKE);
  if (mWake) {
    let hour = parseInt(mWake[1], 10);
    const minute = mWake[2] ? clamp(parseInt(mWake[2], 10), 0, 59) : 0;
    const ampm = mWake[3]?.toLowerCase();
    if (ampm?.startsWith("p") && hour < 12) hour += 12;
    if (ampm?.startsWith("a") && hour === 12) hour = 0;
    hour = clamp(hour, 0, 23);
    return { intent: { kind: "wake_at", hour, minute }, confidence: 0.9, raw };
  }

  // Complete must match BEFORE reminder (it contains "remind" sometimes).
  const mDone = text.match(RE_COMPLETE);
  if (mDone) {
    const t = mDone[1]?.trim();
    if (t) return { intent: { kind: "complete_task", text: t }, confidence: 0.85, raw };
  }

  const mRem = text.match(RE_REMINDER);
  if (mRem) {
    const t = mRem[1]?.trim();
    if (t) return { intent: { kind: "add_reminder", text: t }, confidence: 0.9, raw };
  }

  const mPage = text.match(RE_OPEN_PAGE);
  if (mPage) {
    const slug = mPage[1].replace(/\s+/g, "").toLowerCase();
    const route = mapPageToRoute(slug);
    if (route) return { intent: { kind: "open_route", to: route.to, label: route.label }, confidence: 0.95, raw };
  }

  const mSet = text.match(RE_OPEN_SETTINGS);
  if (mSet) {
    const slug = mSet[1].trim().toLowerCase();
    if (/companion|voice|brief|morning|evening/.test(slug)) {
      return { intent: { kind: "open_route", to: "/settings/companion", label: "Companion settings" }, confidence: 0.9, raw };
    }
    if (/skill|integration|connection/.test(slug)) {
      return { intent: { kind: "open_route", to: "/settings/skills", label: "Skills" }, confidence: 0.9, raw };
    }
  }

  // Play <track> — explicit play verb is high-confidence regardless of phrasing.
  const mPlay = text.match(RE_PLAY);
  if (mPlay) {
    const phrase = mPlay[1];
    const t = resolveTrack(phrase);
    if (t) return { intent: { kind: "play_track", slug: t.slug, label: t.label }, confidence: 0.95, raw };
    return {
      intent: { kind: "unknown", alternates: suggestTracks(phrase) },
      confidence: 0.3,
      raw,
    };
  }

  // Bare track name ("rain", "ocean sounds") — upgrade to high confidence
  // when the whole utterance unambiguously matches a known sound noun
  // (with optional "sound(s)" / leading filler stripped by normalize()).
  const bare = resolveTrack(text);
  if (bare) {
    const stripped = text.replace(/\b(some|the|a|please|on|now|sound|sounds|noises)\b/g, " ").replace(/\s+/g, " ").trim();
    const shortAndClean = stripped.split(" ").length <= 3;
    return { intent: { kind: "play_track", slug: bare.slug, label: bare.label }, confidence: shortAndClean ? 0.9 : 0.65, raw };
  }

  return { intent: { kind: "unknown" }, confidence: 0, raw };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function mapPageToRoute(slug: string): { to: OpenRouteTarget; label: string } | null {
  switch (slug) {
    case "inbox":
      return { to: "/inbox", label: "Inbox" };
    case "memory":
      return { to: "/memory", label: "My Memory" };
    case "automation":
    case "automations":
    case "routine":
    case "routines":
      return { to: "/automations", label: "Routines" };
    case "smarthome":
      return { to: "/smart-home", label: "Smart Home" };
    case "dashboard":
      return { to: "/dashboard", label: "Dashboard" };
    case "sleep":
      return { to: "/sleep", label: "Sleep" };
    case "companion":
      return { to: "/companion", label: "Companion" };
    case "event":
    case "events":
      return { to: "/events", label: "Events" };
    case "plan":
      return { to: "/plan", label: "Plan" };
    default:
      return null;
  }
}

function suggestTracks(phrase: string): string[] {
  const seed = normalize(phrase);
  const scored = TRACKS.map((t) => {
    const lbl = t.label.toLowerCase();
    let score = 0;
    if (lbl.startsWith(seed[0] ?? "")) score += 1;
    if (lbl.includes(seed.slice(0, 3))) score += 2;
    return { label: t.label, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.label);
}
