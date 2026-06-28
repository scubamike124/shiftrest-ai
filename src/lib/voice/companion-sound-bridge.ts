/**
 * Companion → Sleep Sounds bridge.
 *
 * Lets the Companion chat understand the same voice commands the /sleep
 * page supports, without duplicating mixer logic. We reuse the existing
 * deterministic intent router and intent executor. Every sound mutation
 * still flows through the shared `mixer` singleton, so /sleep and the
 * Companion always see the same audio state.
 *
 * Safety rules (Slice 4):
 *  - Only a small, allow-listed set of intents may fire from chat.
 *  - Low-confidence track guesses NEVER fire — we ask for confirmation.
 *  - Save mix, wake alarm, breathing, smart-home are out of scope here.
 */
import { parseIntent, type Intent } from "./intent-router";
import { executeIntent, type ExecutorContext } from "./intent-executor";
import { mixer } from "@/lib/sounds/mixer";

type AllowedKind =
  | "play_track"
  | "stop_all"
  | "set_timer"
  | "sleep_mode"
  | "goodnight";

const ALLOWED: ReadonlySet<AllowedKind> = new Set([
  "play_track",
  "stop_all",
  "set_timer",
  "sleep_mode",
  "goodnight",
]);

function isAllowed(kind: Intent["kind"]): kind is AllowedKind {
  return (ALLOWED as ReadonlySet<string>).has(kind);
}

// Compound "play X for N minutes" detection (separate from the router's
// strict timer regex so we can pair it with a play_track in one phrase).
const FOR_TIMER_RE = /\bfor\s+(\d{1,3})\s*(?:min|mins|minute|minutes|m)\b/i;
const ANY_TIMER_RE = /\b(\d{1,3})\s*(?:min|mins|minute|minutes|m)\b/i;

const YES_RE = /^(?:yes|yeah|yep|sure|ok|okay|please(?:\s+do)?|do it|go ahead|confirm|y)\b/i;
const NO_RE = /^(?:no|nope|nah|cancel|stop|never\s*mind|nevermind)\b/i;

export type BridgeResult =
  | { kind: "handled"; assistant: string }
  | { kind: "confirm"; assistant: string; pendingIntent: Intent }
  | { kind: "miss" };

export function isYes(text: string): boolean {
  return YES_RE.test(text.trim());
}

export function isNo(text: string): boolean {
  return NO_RE.test(text.trim());
}

/**
 * Try to handle a chat message as a sleep-sound command. Returns `miss`
 * if the message isn't a sound command at all (the caller then forwards
 * it to the AI as a normal chat turn).
 */
export async function tryCompanionSoundCommand(
  text: string,
  ctx: ExecutorContext,
): Promise<BridgeResult> {
  const parsed = parseIntent(text);
  if (!isAllowed(parsed.intent.kind)) return { kind: "miss" };

  // Low-confidence track guesses must not fire automatically.
  if (parsed.intent.kind === "play_track" && parsed.confidence < 0.85) {
    return {
      kind: "confirm",
      assistant: `Did you want me to play ${parsed.intent.label}? Say "yes" to start it.`,
      pendingIntent: parsed.intent,
    };
  }

  const result = await executeIntent(parsed.intent, ctx);
  if (!result.ok) return { kind: "handled", assistant: result.message };

  // Compound phrasing: "play rain for 30 minutes" → also start a timer.
  let extra = "";
  if (parsed.intent.kind === "play_track") {
    const m = text.match(FOR_TIMER_RE) ?? text.match(ANY_TIMER_RE);
    if (m) {
      const minutes = Math.max(1, Math.min(180, parseInt(m[1], 10)));
      mixer.setSleepTimer(minutes);
      extra = ` I set a ${minutes}-minute sleep timer.`;
    }
  }

  return { kind: "handled", assistant: phraseFor(parsed.intent) + extra };
}

/** Execute a previously-confirmed pending intent. */
export async function executePending(
  intent: Intent,
  ctx: ExecutorContext,
): Promise<string> {
  if (!isAllowed(intent.kind)) return "Cancelled.";
  const r = await executeIntent(intent, ctx);
  return r.ok ? phraseFor(intent) : r.message;
}

function phraseFor(intent: Intent): string {
  switch (intent.kind) {
    case "play_track":
      return `${intent.label} is playing.`;
    case "stop_all":
      return "All sounds stopped.";
    case "set_timer":
      return `Sleep timer set for ${intent.minutes} minute${intent.minutes === 1 ? "" : "s"}.`;
    case "goodnight":
      return "Goodnight. I started your wind-down mix and I'll fade it out in 45 minutes.";
    case "sleep_mode":
      return "Sleep mode on — wind-down mix, fading out in 45 minutes.";
    default:
      return "Done.";
  }
}
