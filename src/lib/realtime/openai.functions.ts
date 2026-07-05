/**
 * OpenAI Realtime — ephemeral client_secret mint.
 *
 * Server-only. Exchanges the server-side OpenAI API key for a short-lived
 * ephemeral token (`ek_…`) that the browser uses to open a WebRTC session
 * directly against OpenAI Realtime via POST /v1/realtime/calls. The API
 * key never leaves the server.
 *
 * Uses the newer POST /v1/realtime/client_secrets endpoint (replaces the
 * deprecated /v1/realtime/sessions flow).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildTimeDirective } from "@/lib/ai/time-directive";
import {
  VOICE_OPTIONS,
  DEFAULT_VOICE_PROFILE,
  buildInstructions,
  type PersonalityKey,
  type VoiceProfile,
} from "@/lib/voice/profile";

export type RealtimeSessionResult = {
  clientSecret: string;
  expiresAt: number; // epoch ms
  model: string;
  voice: string;
  /** First name / preferred name for the greeting; empty if unknown. */
  greetingName: string;
  /** "Good morning" | "Good afternoon" | "Good evening"; "Hi" if unknown. */
  greetingLabel: string;
};

export type MintRealtimeSessionInput = {
  localTime?: string | null;
  timezone?: string | null;
};


const DEFAULT_MODEL = "gpt-realtime";
// OpenAI's own recommended Realtime voices for best natural quality.
const DEFAULT_VOICE = "marin";

const VALID_VOICE_IDS = new Set(VOICE_OPTIONS.map((v) => v.id));
const VALID_PERSONALITIES = new Set<PersonalityKey>([
  "calm", "friendly", "professional", "motivational", "companion", "coach", "energetic",
]);

// Realtime API speed range (per OpenAI docs). Broader than the TTS clamp,
// so we clamp here instead of reusing `clampSpeed` from voice/profile.
function clampRealtimeSpeed(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 1.0;
  return Math.min(1.5, Math.max(0.25, v));
}

// Reply-shape system prompt — keeps answers conversational and short so
// audio starts fast and there are no long paragraph gaps between sentences.
const REPLY_SHAPE = [
  "You are RestPilot, a warm and calm sleep and rest companion.",
  "Speak like a person on a phone call: one or two short sentences at a time.",
  "Use plain, natural conversational language. No lists, no headings, no long paragraphs.",
  "Give the shortest useful answer first. If there's more to share or you want the user to continue, end with a clear, inviting question like 'Want me to walk you through it step by step?' or 'Should I continue?' — never trail off or ask a soft, easy-to-miss question.",
  "Pause after a beat so the user can respond. Never lecture.",
].join(" ");

/**
 * Speed on the Realtime API only changes playback rate — the model doesn't
 * self-adjust its cadence. Per OpenAI guidance, pair the speed multiplier
 * with an instruction so the delivery also feels paced correctly.
 */
function pacingHint(speed: number): string {
  if (speed < 0.95) return "Pace yourself calmly and unhurried, with soft breath between thoughts.";
  if (speed > 1.05) return "Keep a brisk, energetic pace without rushing the words.";
  return "Speak at a measured, natural pace.";
}

async function loadUserVoiceProfileServer(userId: string): Promise<VoiceProfile> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_prefs")
      .select("voice_id, voice_language, voice_accent, voice_personality, voice_speed, voice_instructions")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return DEFAULT_VOICE_PROFILE;
    const row = data as {
      voice_id: string | null;
      voice_language: string | null;
      voice_accent: string | null;
      voice_personality: string | null;
      voice_speed: number | string | null;
      voice_instructions: string | null;
    };
    return {
      voiceId: VALID_VOICE_IDS.has(row.voice_id ?? "")
        ? (row.voice_id as string)
        : DEFAULT_VOICE,
      language: row.voice_language || DEFAULT_VOICE_PROFILE.language,
      accent: row.voice_accent || null,
      personality: VALID_PERSONALITIES.has(row.voice_personality as PersonalityKey)
        ? (row.voice_personality as PersonalityKey)
        : DEFAULT_VOICE_PROFILE.personality,
      speed: clampRealtimeSpeed(row.voice_speed),
      instructionsOverride: row.voice_instructions || null,
    };
  } catch (e) {
    console.warn("[realtime/openai] voice-profile-load-failed", e);
    return { ...DEFAULT_VOICE_PROFILE, voiceId: DEFAULT_VOICE };
  }
}

export const mintRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: MintRealtimeSessionInput | undefined) => input ?? {})
  .handler(async ({ data: input, context }): Promise<RealtimeSessionResult> => {


    // Reuse the existing OPENAI_REALTIME_API_KEY (previously used by the
    // LiveKit worker); fall back to OPENAI_API_KEY if defined. Either works —
    // both are standard OpenAI keys.
    const apiKey =
      process.env.OPENAI_API_KEY || process.env.OPENAI_REALTIME_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI Realtime is not configured");
    }

    // Load the user's saved voice profile (voice, personality, accent, language,
    // speed, optional custom instructions override) so Profile settings actually
    // shape the live session.
    const voiceProfile = await loadUserVoiceProfileServer(context.userId);

    // Resolve greeting name (preferred_name → display_name first token).
    // Same personalization source the welcome email uses. Never falls back
    // to email prefix.
    let greetingName = "";
    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const { loadPreferredNameServer } = await import(
        "@/lib/user/display-name.server"
      );
      const preferred = await loadPreferredNameServer(
        supabaseAdmin,
        context.userId,
      );
      let name = preferred;
      if (!name) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("display_name, email")
          .eq("id", context.userId)
          .maybeSingle();
        const display = (profile?.display_name ?? "").trim();
        const emailPrefix = (profile?.email ?? "").split("@")[0];
        if (display && display.toLowerCase() !== emailPrefix.toLowerCase()) {
          name = display;
        }
      }
      greetingName = (name.split(/\s+/)[0] ?? "").trim();
    } catch (e) {
      console.warn("[realtime/openai] greeting-name-lookup-failed", e);
    }

    // Compose instructions: reply-shape rules + personality/accent/language
    // from buildInstructions() + pacing hint keyed to speed tier.
    // If the user set a custom instructions override, buildInstructions()
    // returns it verbatim and we still prepend the reply-shape rules so the
    // conversation contract holds.
    const personalityBlock = buildInstructions(
      {
        personality: voiceProfile.personality,
        accent: voiceProfile.accent,
        language: voiceProfile.language,
        instructionsOverride: voiceProfile.instructionsOverride,
      },
      "normal",
    );
    const instructions = [
      REPLY_SHAPE,
      personalityBlock,
      pacingHint(voiceProfile.speed),
    ].join(" ");

    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: DEFAULT_MODEL,
          audio: {
            output: {
              voice: voiceProfile.voiceId,
              speed: voiceProfile.speed,
            },
            input: {
              transcription: { model: "whisper-1" },
              // semantic_vad with `auto` eagerness: end-of-turn is detected
              // in ~500ms after natural pauses instead of the multi-second
              // wait `low` imposes. Still tolerates mid-sentence pauses
              // because semantic VAD scores intent, not silence length.
              turn_detection: {
                type: "semantic_vad",
                eagerness: "auto",
                create_response: true,
                interrupt_response: true,
              },
            },
          },
          instructions,
          // Give longer answers enough room to finish, while the system
          // prompt still keeps the model conversational and concise.
          max_output_tokens: 2000,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[realtime/openai] client_secret_mint_fail status=${res.status} body=${detail.slice(0, 240)}`,
      );
      if (res.status === 429) throw new Error("OpenAI rate limit reached");
      if (res.status === 401) throw new Error("OpenAI key rejected");
      throw new Error("Failed to mint realtime client secret");
    }

    // POST /v1/realtime/client_secrets returns:
    //   { value: "ek_…", expires_at: <epoch seconds>, session: {...} }
    const data = (await res.json()) as {
      value?: string;
      expires_at?: number;
      session?: { model?: string; audio?: { output?: { voice?: string } } };
    };
    const value = data.value;
    if (!value) throw new Error("Missing client_secret value in mint response");

    const expiresAt =
      typeof data.expires_at === "number"
        ? data.expires_at * 1000
        : Date.now() + 55_000;

    // Time-of-day greeting label derived from the caller's local clock so
    // the opener matches every other greeting surface in the app.
    // buildTimeDirective collapses "night" → "Good evening".
    const { greeting } = buildTimeDirective({
      localTime: input.localTime ?? null,
      timezone: input.timezone ?? null,
    });
    const greetingLabel = greeting ?? "Hi";


    return {
      clientSecret: value,
      expiresAt,
      model: data.session?.model ?? DEFAULT_MODEL,
      voice: data.session?.audio?.output?.voice ?? voiceProfile.voiceId,
      greetingName,
      greetingLabel,
    };

  });
