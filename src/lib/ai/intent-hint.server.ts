/**
 * Lightweight keyword classifier for the user's latest coach turn.
 * Server-only. No model call — pure regex/keyword matching.
 *
 * Returns one of a small fixed set of intent tags used by the reasoning
 * layer to rank PERSONAL SIGNALS in the system prompt.
 */

export type IntentHint =
  | "caffeine"
  | "sleep"
  | "recovery"
  | "shift"
  | "wind_down"
  | "nap"
  | "general";

// Ordered from most specific → least specific. First match wins so more
// narrowly-scoped intents (wind_down, nap) beat their broader parents (sleep).
const RULES: { tag: Exclude<IntentHint, "general">; patterns: RegExp[] }[] = [
  {
    tag: "caffeine",
    patterns: [/\bcaffeine\b/i, /\bcoffee\b/i, /\bespresso\b/i, /\btea\b/i, /\benergy drink/i, /\bpre-?workout\b/i, /\bmatcha\b/i],
  },
  {
    tag: "nap",
    patterns: [/\bnap(s|ping|ped)?\b/i, /\bpower ?nap\b/i, /\bsiesta\b/i, /\bshut ?eye\b/i],
  },
  {
    tag: "wind_down",
    patterns: [/\bwind[- ]?down\b/i, /\bbedtime routine\b/i, /\brelax before bed\b/i, /\bevening routine\b/i, /\bmelatonin\b/i, /\bdim (the )?lights?\b/i],
  },
  {
    tag: "shift",
    patterns: [/\bshift(s|work|worker)?\b/i, /\bnight shift\b/i, /\bday shift\b/i, /\brotation\b/i, /\bon-?call\b/i, /\bwork tomorrow\b/i, /\bwork tonight\b/i, /\btomorrow'?s?\s+(shift|work)\b/i],
  },
  {
    tag: "recovery",
    patterns: [/\brecover(y|ing)?\b/i, /\bhrv\b/i, /\bresting (heart|hr)\b/i, /\breadiness\b/i, /\bfatigue(d)?\b/i, /\bburn(ed|t)? out\b/i, /\brun down\b/i, /\bexhaust(ed|ion)\b/i, /\bhow am i doing\b/i],
  },
  {
    tag: "sleep",
    patterns: [/\bsleep(ing|y)?\b/i, /\bbed( time)?\b/i, /\brest\b/i, /\btired\b/i, /\binsomnia\b/i, /\bfall(ing)? asleep\b/i, /\bstay(ing)? asleep\b/i, /\bsleep better\b/i, /\bwake( up)?\b/i, /\bREM\b/i, /\bdeep sleep\b/i],
  },
];

export function classifyIntent(text: string | null | undefined): IntentHint {
  if (!text) return "general";
  const t = text.trim();
  if (!t) return "general";
  for (const { tag, patterns } of RULES) {
    if (patterns.some((p) => p.test(t))) return tag;
  }
  return "general";
}
