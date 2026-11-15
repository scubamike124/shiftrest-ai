// Session instructions for the live voice Companion (OpenAI Realtime).
// Client-safe and pure so tests can build the exact string that is sent.
import { SAFETY_AND_CARE } from "@/lib/ai/guardrails";
import { buildInstructions, type VoiceProfile } from "@/lib/voice/profile";

// Reply-shape system prompt — keeps answers conversational and short so
// audio starts fast and there are no long paragraph gaps between sentences.
export const REPLY_SHAPE = [
  "You are {{NAME}}, a warm and calm sleep and rest companion from RestPilot.",
  "Speak like a person on a phone call: one or two short sentences at a time.",
  "Use plain, natural conversational language. No lists, no headings, no long paragraphs.",
  "Give the shortest useful answer first. If there's more to share or you want the user to continue, end with a clear, inviting question like 'Want me to walk you through it step by step?' or 'Should I continue?' — never trail off or ask a soft, easy-to-miss question.",
  "Pause after a beat so the user can respond. Never lecture.",
].join(" ");

/** A saved custom-instructions override is cut to this many characters. */
export const MAX_OVERRIDE_CHARS = 1500;
/** Upper bound for the whole instructions string (well inside the model's context). */
export const MAX_REALTIME_INSTRUCTIONS_CHARS = 8000;

/**
 * Speed on the Realtime API only changes playback rate — the model doesn't
 * self-adjust its cadence. Per OpenAI guidance, pair the speed multiplier
 * with an instruction so the delivery also feels paced correctly.
 */
export function pacingHint(speed: number): string {
  if (speed < 0.95) return "Pace yourself calmly and unhurried, with soft breath between thoughts.";
  if (speed > 1.05) return "Keep a brisk, energetic pace without rushing the words.";
  return "Speak at a measured, natural pace.";
}

/**
 * Reply-shape rules + personality/accent/language (or the user's custom
 * override, length-capped) + pacing hint, then the shared safety-and-care
 * rules last so they outrank everything before them.
 */
export function buildRealtimeInstructions(
  profile: Pick<
    VoiceProfile,
    "personality" | "accent" | "language" | "instructionsOverride" | "speed"
  >,
  name: string,
): string {
  const personalityBlock = buildInstructions(
    {
      personality: profile.personality,
      accent: profile.accent ? profile.accent.slice(0, 80) : null,
      language: profile.language,
      instructionsOverride: profile.instructionsOverride
        ? profile.instructionsOverride.slice(0, MAX_OVERRIDE_CHARS)
        : null,
    },
    "normal",
  );
  const shape = REPLY_SHAPE.replace("{{NAME}}", name.trim().slice(0, 40) || "RestPilot");
  return `${[shape, personalityBlock, pacingHint(profile.speed)].join(" ")}\n\n${SAFETY_AND_CARE}`;
}
