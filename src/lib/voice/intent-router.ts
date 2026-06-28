/**
 * Deterministic intent parser for /sleep voice commands.
 *
 * Pure / side-effect free so it can be unit-tested and reused. The router
 * NEVER guesses — every supported intent has a strict pattern and a high
 * confidence. Ambiguous phrases return `{ kind: "unknown", alternates }`
 * so the UI can ask for confirmation rather than firing the wrong action.
 */
import { TRACKS } from "@/lib/sounds/catalog";

export type Intent =
  | { kind: "play_track"; slug: string; label: string }
  | { kind: "stop_all" }
  | { kind: "set_timer"; minutes: number }
  | { kind: "save_mix"; name?: string }
  | { kind: "wake_at"; hour: number; minute: number }
  | { kind: "sleep_mode" }
  | { kind: "breathing" }
  | { kind: "goodnight" }
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
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s:]/gu, " ")
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
    // 1. Exact alias.
    if (TRACK_ALIASES[c]) {
      const t = TRACKS.find((x) => x.slug === TRACK_ALIASES[c]);
      if (t) return { slug: t.slug, label: t.label };
    }
    // 2. Longest-substring alias match.
    for (const k of aliasKeys) {
      const re = new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`);
      if (re.test(c)) {
        const t = TRACKS.find((x) => x.slug === TRACK_ALIASES[k]);
        if (t) return { slug: t.slug, label: t.label };
      }
    }
    // 3. Direct label match.
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

const RE_WAKE =
  /\bwake\s+(?:me\s+)?(?:up\s+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;

const RE_SLEEP_MODE = /^(?:start\s+)?(?:sleep\s+mode|night\s+mode|bedtime\s+mode)\s*$/i;

const RE_BREATHING =
  /^(?:start\s+)?(?:breathing(?:\s+exercise)?|breath(?:ing)?(?:\s+work)?|breathe|box\s+breathing|4\s*7\s*8|four\s+seven\s+eight)\s*$/i;

const RE_GOODNIGHT = /^(?:good\s*night|goodnight|night\s+night|tuck\s+me\s+in)\s*$/i;

const RE_PLAY =
  /^(?:please\s+)?(?:play|start|put\s+on|i\s+(?:want|need|would\s+like))\s+(.+?)\s*$/i;

// ---------- main parser ----------

export function parseIntent(input: string): ParsedIntent {
  const raw = (input ?? "").trim();
  const text = normalize(raw);
  if (!text) return { intent: { kind: "unknown" }, confidence: 0, raw };

  if (RE_CANCEL.test(text)) return { intent: { kind: "cancel" }, confidence: 1, raw };

  if (RE_GOODNIGHT.test(text)) return { intent: { kind: "goodnight" }, confidence: 1, raw };

  if (RE_SLEEP_MODE.test(text)) return { intent: { kind: "sleep_mode" }, confidence: 1, raw };

  if (RE_BREATHING.test(text)) return { intent: { kind: "breathing" }, confidence: 1, raw };

  if (RE_STOP.test(text)) return { intent: { kind: "stop_all" }, confidence: 1, raw };

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

  // Play <track>
  const mPlay = text.match(RE_PLAY);
  if (mPlay) {
    const phrase = mPlay[1];
    const t = resolveTrack(phrase);
    if (t) return { intent: { kind: "play_track", slug: t.slug, label: t.label }, confidence: 0.95, raw };
    // Unrecognized track — propose alternates instead of guessing.
    return {
      intent: { kind: "unknown", alternates: suggestTracks(phrase) },
      confidence: 0.3,
      raw,
    };
  }

  // Bare track name ("rain") — only acceptable as a low-confidence play hint.
  const bare = resolveTrack(text);
  if (bare && text.split(" ").length <= 3) {
    return { intent: { kind: "play_track", slug: bare.slug, label: bare.label }, confidence: 0.6, raw };
  }

  return { intent: { kind: "unknown" }, confidence: 0, raw };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
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
