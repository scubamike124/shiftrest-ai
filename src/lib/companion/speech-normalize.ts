// Normalize assistant text for natural TTS delivery.
//
// Run BEFORE every /api/tts POST. Fixes:
//   • "8:00" → "eight o'clock"  (was: "eight dot zero zero")
//   • markdown leftovers read literally
//   • em-dashes / ellipses / stray symbols
//   • decimals like "7.5 hours" → "seven and a half hours"
//   • unit abbreviations (mg, °F, hrs…) via expandForSpeech()
//
// Conservative on purpose: never rewrites things that aren't clearly clock
// times (e.g. "16:9" aspect ratios, scores) and never strips real apostrophes.

import { expandForSpeech } from "@/lib/voice-rewriter";

const ONES = [
  "zero","one","two","three","four","five","six","seven","eight","nine",
  "ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen",
  "seventeen","eighteen","nineteen",
] as const;
const TENS = ["","","twenty","thirty","forty","fifty"] as const;

function twoDigitWord(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
}

function hour12(h: number): string {
  const n = h % 12 === 0 ? 12 : h % 12;
  return ONES[n] ?? String(n);
}

function isClockSafeContext(before: string, after: string): boolean {
  const ctx = `${before} ${after}`.toLowerCase();
  // Skip aspect ratios, scores, vs comparisons.
  if (/(aspect|ratio|score|vs\.?)/.test(ctx)) return false;
  return true;
}

function normalizeClock(s: string): string {
  // Capture: optional leading word boundary, HH:MM, optional am/pm.
  return s.replace(
    /(\b)([01]?\d|2[0-3]):([0-5]\d)(\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm))?(\b)/gi,
    (match, lead: string, hh: string, mm: string, ampmRaw: string | undefined, trail: string, offset: number, full: string) => {
      const before = full.slice(Math.max(0, offset - 12), offset);
      const after = full.slice(offset + match.length, offset + match.length + 12);
      if (!isClockSafeContext(before, after)) return match;
      const h = parseInt(hh, 10);
      const m = parseInt(mm, 10);
      const ampm = (ampmRaw ?? "").toLowerCase().replace(/\s|\./g, "");
      const isPm = ampm === "pm";
      const isAm = ampm === "am";

      // Special natural cases.
      if ((isPm && h === 12 && m === 0) || (!ampm && h === 12 && m === 0)) {
        return `${lead}noon${trail}`;
      }
      if ((isAm && h === 12 && m === 0) || (!ampm && h === 0 && m === 0)) {
        return `${lead}midnight${trail}`;
      }

      const hourWord = ampm ? hour12(h) : (h <= 12 ? hour12(h) : twoDigitWord(h));
      const suffix = isAm ? " a.m." : isPm ? " p.m." : "";

      let body: string;
      if (m === 0) body = `${hourWord} o'clock`;
      else if (m < 10) body = `${hourWord} oh ${ONES[m]}`;
      else body = `${hourWord} ${twoDigitWord(m)}`;

      return `${lead}${body}${suffix}${trail}`;
    },
  );
}

const HALF_DECIMALS: Record<string, string> = {
  "0.25": "a quarter",
  "0.5":  "a half",
  "0.75": "three quarters",
  "1.25": "one and a quarter",
  "1.5":  "one and a half",
  "1.75": "one and three quarters",
  "2.5":  "two and a half",
  "3.5":  "three and a half",
  "4.5":  "four and a half",
  "5.5":  "five and a half",
  "6.5":  "six and a half",
  "7.5":  "seven and a half",
  "8.5":  "eight and a half",
  "9.5":  "nine and a half",
};

function normalizeDecimals(s: string): string {
  // Only rewrite when followed by a unit word, so we don't mangle "version 1.5".
  return s.replace(
    /\b(\d+(?:\.\d{1,2}))\s+(hours?|hrs?|minutes?|mins?|cups?|liters?|litres?|miles?|grams?|ounces?|oz|lbs?|pounds?|days?|weeks?|months?|years?)\b/gi,
    (m, num: string, unit: string) => {
      const word = HALF_DECIMALS[num];
      return word ? `${word} ${unit}` : m;
    },
  );
}

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^>\s?/gm, "");
}

function tidyPunctuation(s: string): string {
  return s
    .replace(/\.{3,}/g, ", ")
    .replace(/—|–/g, ", ")
    .replace(/[#~|>]/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Pass 2 — Cadence padding. The TTS model honours punctuation density for
 *  breath pacing; we lightly amplify natural pauses without changing wording.
 *    - collapse stacked "!!" → single "!"
 *    - " , " sub-comma after every coordinating conjunction at clause start
 *    - sentence end "?" / "." gets a trailing space we already keep
 *    - sleep mode: insert ellipses between clauses for hushed cadence
 */
function applyCadence(s: string, mode: "normal" | "sleep"): string {
  let out = s
    .replace(/([!?]){2,}/g, "$1")
    .replace(/\b(and|but|so|then)\b\s+/gi, "$1, ");
  if (mode === "sleep") {
    out = out
      .replace(/([.?!])\s+/g, "$1 … ")
      .replace(/,\s+/g, ", … ");
  }
  return out;
}

/**
 * Single entry point. Always returns a non-empty string when given non-empty
 * input; on any failure returns the original text unchanged.
 */
export function normalizeForSpeech(input: string, mode: "normal" | "sleep" = "normal"): string {
  if (!input) return input;
  try {
    let s = input;
    s = stripMarkdown(s);
    s = normalizeClock(s);
    s = normalizeDecimals(s);
    s = expandForSpeech(s);
    s = tidyPunctuation(s);
    s = applyCadence(s, mode);
    if (s && !/[.!?]$/.test(s)) s = `${s}.`;
    return s;
  } catch {
    return input;
  }
}
