// Pass 3 — Companion Emotion Engine.
//
// Lightweight event bus. The Avatar subscribes and remaps its idle weights:
// brow lift, eyelid open %, mouth-corner bias, cheek lift, gaze, breath rate,
// blink interval. Sleep mode is a first-class emotion (deepest preset).
//
// Use:
//   setEmotion('happy')            // immediate
//   setEmotion('sleep', { hold })  // pin for N ms then revert to 'neutral'
//   inferFromText(replyText)       // heuristic auto-pick from assistant text

export type Emotion =
  | "neutral"
  | "happy"
  | "thinking"
  | "listening"
  | "encouraging"
  | "sleep"
  | "concerned";

export type EmotionWeights = {
  /** -1..+1, brow vertical bias (negative = lowered) */
  brow: number;
  /** 0..1 eyelid open ratio (1 = wide open) */
  lidOpen: number;
  /** -1..+1, mouth-corner lift */
  corners: number;
  /** 0..1 cheek-lift opacity */
  cheeks: number;
  /** gaze offset percent of face width/height */
  gaze: { x: number; y: number };
  /** breaths per minute */
  breathBpm: number;
  /** blink min / max ms */
  blink: { min: number; max: number };
  /** overall idle motion speed multiplier */
  speed: number;
};

export const EMOTION_PRESETS: Record<Emotion, EmotionWeights> = {
  neutral:     { brow:  0.0, lidOpen: 1.00, corners:  0.05, cheeks: 0.00, gaze: { x:  0,   y:  0   }, breathBpm: 14, blink: { min: 3000, max: 8000 }, speed: 1.0 },
  happy:       { brow:  0.3, lidOpen: 0.92, corners:  0.55, cheeks: 0.35, gaze: { x:  0,   y:  0   }, breathBpm: 16, blink: { min: 2800, max: 7000 }, speed: 1.05 },
  thinking:    { brow:  0.2, lidOpen: 1.00, corners:  0.00, cheeks: 0.00, gaze: { x: -1.5, y: -1.5 }, breathBpm: 13, blink: { min: 3500, max: 9000 }, speed: 0.95 },
  listening:   { brow:  0.1, lidOpen: 1.00, corners:  0.10, cheeks: 0.05, gaze: { x:  0,   y: -0.3 }, breathBpm: 14, blink: { min: 3200, max: 8000 }, speed: 1.0 },
  encouraging: { brow:  0.4, lidOpen: 0.95, corners:  0.45, cheeks: 0.28, gaze: { x:  0,   y:  0   }, breathBpm: 15, blink: { min: 3000, max: 7500 }, speed: 1.05 },
  sleep:       { brow: -0.2, lidOpen: 0.55, corners:  0.15, cheeks: 0.10, gaze: { x:  0,   y:  0.6 }, breathBpm: 9,  blink: { min: 5500, max: 11000 }, speed: 0.55 },
  concerned:   { brow: -0.3, lidOpen: 1.00, corners: -0.20, cheeks: 0.00, gaze: { x: -1.0, y:  0.5 }, breathBpm: 14, blink: { min: 3000, max: 7500 }, speed: 0.95 },
};

let current: Emotion = "neutral";
let holdTimer: number | undefined;

export function getEmotion(): Emotion {
  return current;
}

export function setEmotion(next: Emotion, opts: { hold?: number } = {}): void {
  if (current === next && !opts.hold) return;
  current = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("companion:emotion", { detail: { emotion: next } }));
  }
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  }
  if (opts.hold && next !== "neutral" && typeof window !== "undefined") {
    holdTimer = window.setTimeout(() => setEmotion("neutral"), opts.hold);
  }
}

/** Cheap text heuristic — fires on `companion:turn-ended`. */
export function inferFromText(text: string | undefined | null): Emotion {
  if (!text) return "neutral";
  const t = text.toLowerCase();
  if (/(good\s*night|sleep\s*tight|wind[- ]down|relax|breathe|calm|hush)/.test(t)) return "sleep";
  if (/(\?|let me think|hmm|consider|maybe|perhaps)/.test(t)) return "thinking";
  if (/(great|nice|love that|wonderful|you('| a)?re doing|proud|amazing|fantastic)/.test(t)) return "encouraging";
  if (/(sorry|hard|tough|i hear you|that('s| is) rough|difficult)/.test(t)) return "concerned";
  if (/(yes|sure|okay|of course|happy to|sounds good)/.test(t)) return "happy";
  return "neutral";
}
