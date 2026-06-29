// Pass 1 — Viseme mapper.
// Turns the upcoming speech text into a sequence of mouth shapes the Avatar
// rig can blend through. We don't do real phoneme alignment — instead we
// rotate visemes by character index at a steady cadence while audio plays.
// Amplitude scales openness; the viseme picks the *shape*.

export type VisemeKey = "REST" | "MBP" | "FV" | "AI" | "O" | "EE" | "LTH";

export type VisemeShape = {
  /** 0..1 base openness (multiplied by live amplitude) */
  open: number;
  /** corner stretch: <1 rounds, >1 widens */
  wide: number;
  /** corner lift bias -1..+1 (smile pull) */
  corner: number;
  /** inner-mouth darkness 0..1 */
  inner: number;
};

export const VISEMES: Record<VisemeKey, VisemeShape> = {
  REST: { open: 0.05, wide: 1.00, corner: 0.05, inner: 0.05 },
  MBP:  { open: 0.00, wide: 0.95, corner: 0.00, inner: 0.00 },
  FV:   { open: 0.12, wide: 1.00, corner: 0.00, inner: 0.10 },
  AI:   { open: 0.85, wide: 1.05, corner: 0.10, inner: 0.55 },
  O:    { open: 0.55, wide: 0.68, corner: -0.05, inner: 0.45 },
  EE:   { open: 0.25, wide: 1.30, corner: 0.30, inner: 0.20 },
  LTH:  { open: 0.40, wide: 1.00, corner: 0.05, inner: 0.30 },
};

/** Map a single character → viseme. Vowels win; common consonants tagged. */
export function charToViseme(ch: string): VisemeKey {
  const c = ch.toLowerCase();
  if (c === "m" || c === "b" || c === "p") return "MBP";
  if (c === "f" || c === "v") return "FV";
  if (c === "o" || c === "u" || c === "w") return "O";
  if (c === "e" || c === "i" || c === "y") return "EE";
  if (c === "a") return "AI";
  if (c === "l" || c === "t" || c === "h" || c === "d" || c === "n" || c === "s" || c === "z") return "LTH";
  return "REST";
}

/** Build a viseme sequence from a sentence. Punctuation and whitespace → REST. */
export function textToVisemeSequence(text: string): VisemeKey[] {
  const out: VisemeKey[] = [];
  let lastVowel: VisemeKey | null = null;
  for (const ch of text) {
    if (/\s/.test(ch)) {
      out.push("REST");
      lastVowel = null;
      continue;
    }
    if (/[.,!?;:…—–]/.test(ch)) {
      out.push("REST");
      out.push("REST");
      lastVowel = null;
      continue;
    }
    const v = charToViseme(ch);
    // Sustain vowels longer for natural feel.
    if (v === "AI" || v === "O" || v === "EE") {
      out.push(v);
      if (lastVowel !== v) out.push(v);
      lastVowel = v;
    } else {
      out.push(v);
      lastVowel = null;
    }
  }
  if (out.length === 0) out.push("REST");
  return out;
}

/** Linear blend between two viseme shapes. */
export function blendVisemes(a: VisemeShape, b: VisemeShape, t: number): VisemeShape {
  const k = Math.max(0, Math.min(1, t));
  const lerp = (x: number, y: number) => x + (y - x) * k;
  return {
    open:   lerp(a.open,   b.open),
    wide:   lerp(a.wide,   b.wide),
    corner: lerp(a.corner, b.corner),
    inner:  lerp(a.inner,  b.inner),
  };
}
