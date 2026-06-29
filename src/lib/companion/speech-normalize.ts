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

/** "85%" → "85 percent", "12.5%" → "12.5 percent". Numbers are left as
 *  digits so the TTS model speaks them naturally ("twelve point five"). */
function normalizePercents(s: string): string {
  return s.replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 percent");
}

/** "72°F" → "72 degrees Fahrenheit", "21 °C" → "21 degrees Celsius",
 *  bare "72°" → "72 degrees". voice-rewriter handles °F/°C with a digit
 *  prefix; this catches the bare-degree case and unspaced "72F". */
function normalizeTemps(s: string): string {
  return s
    .replace(/(\d)\s*°\s*(?![FCfc])/g, "$1 degrees ")
    .replace(/(\d)\s*°\s*F\b/gi, "$1 degrees Fahrenheit")
    .replace(/(\d)\s*°\s*C\b/gi, "$1 degrees Celsius")
    // Bare "72F" / "72C" only when surrounded by spaces and clearly a temp
    // (the previous token looks like a temperature context).
    .replace(/\b(\d{1,3})F\b(?=\s|[.,!?;:]|$)/g, (m, n) =>
      /(temp|degrees|outside|today|tomorrow|high|low)/i.test(s.slice(0, s.indexOf(m)))
        ? `${n} degrees Fahrenheit` : m,
    );
}

/** "https://example.com/path" → "the link example.com". Keep it short — the
 *  full URL spelled letter-by-letter is unlistenable. Email addresses are
 *  preserved as "user at example dot com" only when clearly an email. */
function normalizeUrls(s: string): string {
  let out = s.replace(
    /\bhttps?:\/\/(?:www\.)?([^\s)>\]]+)/gi,
    (_m, rest: string) => {
      const host = rest.split("/")[0].replace(/[.,;:!?]+$/, "");
      return `the link ${host}`;
    },
  );
  // Bare domains like "example.com/path" with a path — also collapse.
  out = out.replace(
    /\b([a-z0-9-]+\.[a-z]{2,})(\/[^\s)>\]]*)/gi,
    (_m, host: string) => `the link ${host}`,
  );
  // Emails: "a@b.co" → "a at b dot co"
  out = out.replace(
    /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    (_m, user: string, dom: string) => `${user} at ${dom.replace(/\./g, " dot ")}`,
  );
  return out;
}

/** ISO dates "2026-06-29" → "June twenty-ninth, twenty twenty-six".
 *  US dates "6/29/2026" → same. Leaves "Jun 29" alone (already natural). */
const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
] as const;
function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${twoDigitWord(n)}th`;
  const last = n % 10;
  const base = twoDigitWord(n);
  if (last === 1) return base.endsWith("one") ? base.replace(/one$/, "first") : `${base}-first`;
  if (last === 2) return base.endsWith("two") ? base.replace(/two$/, "second") : `${base}-second`;
  if (last === 3) return base.endsWith("three") ? base.replace(/three$/, "third") : `${base}-third`;
  return `${base}th`;
}
function yearWords(y: number): string {
  if (y >= 2000 && y < 2010) return `two thousand${y === 2000 ? "" : ` ${ONES[y - 2000]}`}`;
  if (y >= 2010 && y < 2100) {
    const a = Math.floor(y / 100);
    const b = y % 100;
    return `${twoDigitWord(a)} ${b < 10 ? `oh ${ONES[b]}` : twoDigitWord(b)}`;
  }
  return String(y);
}
function normalizeDates(s: string): string {
  // ISO YYYY-MM-DD
  let out = s.replace(
    /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g,
    (_m, y: string, mm: string, dd: string) => {
      const monthIdx = parseInt(mm, 10) - 1;
      return `${MONTHS[monthIdx]} ${ordinal(parseInt(dd, 10))}, ${yearWords(parseInt(y, 10))}`;
    },
  );
  // US M/D or M/D/YYYY (year optional). Skip fractions like "1/2 cup".
  out = out.replace(
    /\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])(?:\/(\d{2,4}))?\b/g,
    (m, mm: string, dd: string, y: string | undefined, offset: number, full: string) => {
      // Skip fraction context like "1/2 cup", "3/4 mile".
      const after = full.slice(offset + m.length, offset + m.length + 8).toLowerCase();
      if (/^\s*(cup|tsp|tbsp|teaspoon|tablespoon|mile|inch|hour)/.test(after)) return m;
      const monthIdx = parseInt(mm, 10) - 1;
      const day = ordinal(parseInt(dd, 10));
      if (!y) return `${MONTHS[monthIdx]} ${day}`;
      const yy = parseInt(y, 10);
      const fullYear = yy < 100 ? 2000 + yy : yy;
      return `${MONTHS[monthIdx]} ${day}, ${yearWords(fullYear)}`;
    },
  );
  return out;
}

/** Common abbreviations beyond what voice-rewriter handles. Conservative —
 *  only fires when followed by a capital letter or end-of-sentence so we
 *  don't mangle prose. */
function normalizeAbbreviations(s: string): string {
  return s
    .replace(/\bDr\.\s+(?=[A-Z])/g, "Doctor ")
    .replace(/\bMr\.\s+(?=[A-Z])/g, "Mister ")
    .replace(/\bMrs\.\s+(?=[A-Z])/g, "Missus ")
    .replace(/\bMs\.\s+(?=[A-Z])/g, "Miss ")
    .replace(/\bSt\.\s+(?=[A-Z])/g, "Saint ")
    .replace(/\bAve\.?\b/g, "Avenue")
    .replace(/\bBlvd\.?\b/g, "Boulevard")
    .replace(/\bRd\.?\b/g, "Road")
    // Standalone "AM"/"PM" not already glued to a clock time → "a.m."/"p.m."
    .replace(/\b([AP])\.?\s*M\.?\b/g, (_m, c: string) => (c === "A" ? "a.m." : "p.m."));
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
  // Only add a sub-comma when the conjunction actually starts a clause,
  // i.e. preceded by sentence-ending punctuation. Avoids breaking natural
  // phrases like "seven and a half hours" or "rock and roll".
  let out = s
    .replace(/([!?]){2,}/g, "$1")
    .replace(/([.!?;:])\s+(and|but|so|then)\b\s+/gi, "$1 $2, ");
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
    // URLs first so date/clock rules don't try to parse path segments.
    s = normalizeUrls(s);
    s = normalizeDates(s);
    s = normalizeClock(s);
    s = normalizeDecimals(s);
    s = normalizePercents(s);
    s = normalizeTemps(s);
    s = normalizeAbbreviations(s);
    s = expandForSpeech(s);
    s = tidyPunctuation(s);
    s = applyCadence(s, mode);
    if (s && !/[.!?]$/.test(s)) s = `${s}.`;
    return s;
  } catch {
    return input;
  }
}

