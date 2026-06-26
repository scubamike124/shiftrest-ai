// Expands abbreviations + numerics so TTS never spells things letter-by-letter.
// Used before sending any text to /api/tts.

const UNIT_MAP: Array<[RegExp, string]> = [
  [/(\d)\s*°\s*F\b/gi, "$1 degrees Fahrenheit"],
  [/(\d)\s*°\s*C\b/gi, "$1 degrees Celsius"],
  [/(\d)\s*mg\b/gi, "$1 milligrams"],
  [/(\d)\s*mcg\b/gi, "$1 micrograms"],
  [/(\d)\s*ml\b/gi, "$1 milliliters"],
  [/(\d)\s*l\b/gi, "$1 liters"],
  [/(\d)\s*kg\b/gi, "$1 kilograms"],
  [/(\d)\s*g\b/gi, "$1 grams"],
  [/(\d)\s*lbs?\b/gi, "$1 pounds"],
  [/(\d)\s*oz\b/gi, "$1 ounces"],
  [/(\d)\s*bpm\b/gi, "$1 beats per minute"],
  [/(\d)\s*mph\b/gi, "$1 miles per hour"],
  [/(\d)\s*km\b/gi, "$1 kilometers"],
  [/(\d)\s*mi\b/gi, "$1 miles"],
  [/(\d)\s*ft\b/gi, "$1 feet"],
  [/(\d)\s*mins?\b/gi, "$1 minutes"],
  [/(\d)\s*secs?\b/gi, "$1 seconds"],
];

const WORD_MAP: Array<[RegExp, string]> = [
  [/\bw\/\b/gi, "with"],
  [/\bw\/o\b/gi, "without"],
  [/\b&\b/g, "and"],
  [/\bvs\.?\b/gi, "versus"],
  [/\be\.g\.?/gi, "for example"],
  [/\bi\.e\.?/gi, "that is"],
  [/\betc\.?/gi, "et cetera"],
  [/\bapprox\.?/gi, "approximately"],
];

export function expandForSpeech(input: string): string {
  let out = input;
  // Range: "100-200" -> "100 to 200"
  out = out.replace(/(\d)\s*[–-]\s*(\d)/g, "$1 to $2");
  // Handle "hr/hrs" with correct pluralization: 1 hr -> 1 hour, 2 hrs -> 2 hours.
  out = out.replace(/\b(\d+)\s*hrs?\b/gi, (_m, n) => `${n} hour${Number(n) === 1 ? "" : "s"}`);
  for (const [re, rep] of UNIT_MAP) out = out.replace(re, rep);
  for (const [re, rep] of WORD_MAP) out = out.replace(re, rep);
  // Collapse repeated whitespace
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

// Voice catalog for Bundle A (OpenAI gpt-4o-mini-tts voices).
export type VoiceId = "alloy" | "sage" | "verse" | "coral" | "ash";
export const VOICES: { id: VoiceId; label: string; tone: string }[] = [
  { id: "sage", label: "Calm Female", tone: "Warm and reassuring" },
  { id: "ash", label: "Calm Male", tone: "Steady and grounded" },
  { id: "coral", label: "Friendly", tone: "Bright and conversational" },
  { id: "alloy", label: "Professional", tone: "Neutral, clear" },
  { id: "verse", label: "Energetic", tone: "Upbeat coach" },
];
