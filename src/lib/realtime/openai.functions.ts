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
import { loadTrialUsageState } from "@/lib/realtime/trial-usage.functions";
import { buildRealtimeInstructions } from "@/lib/realtime/instructions";
import {
  VOICE_OPTIONS,
  DEFAULT_VOICE_PROFILE,
  type PersonalityKey,
  type VoiceProfile,
} from "@/lib/voice/profile";

export type RealtimeSessionResult = {
  clientSecret: string;
  expiresAt: number; // epoch ms
  /** Server-issued id the client echoes in heartbeat/finish reports. */
  sessionId: string;
  /** Epoch ms by which the client MUST end the call (hard timer). */
  deadlineAt: number;
  maxSessionSeconds: number;
  model: string;
  voice: string;
  /** First name / preferred name for the greeting; empty if unknown. */
  greetingName: string;
  /** "Good morning" | "Good afternoon" | "Good evening"; "Hi" if unknown. */
  greetingLabel: string;
  /**
   * Trial state at mint time. Consumers can show a countdown or upgrade CTA.
   * When `isTrial=false` the caller is a paying subscriber (or non-payments
   * build) and has no cap.
   */
  trial: {
    isTrial: boolean;
    remainingSeconds: number;
    capSeconds: number;
  };
};

export type MintRealtimeSessionInput = {
  localTime?: string | null;
  timezone?: string | null;
  /** Which Stripe env the browser is on — 'sandbox' in preview, 'live' in prod. */
  environment?: "sandbox" | "live";
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
    // Explicit permission to share data with third-party AI (Guideline
    // 5.1.2(i)): no OpenAI session is minted without it.
    const { assertAIConsent } = await import("@/lib/ai/consent.server");
    await assertAIConsent(context.userId);

    // Per-user mint rate limit: each mint opens a paid realtime session.
    {
      const { enforceRateLimit, RATE_LIMITS } = await import("@/lib/api/ratelimit.server");
      const limited = await enforceRateLimit(context.userId, RATE_LIMITS.realtime);
      if (limited) throw new Error("rate_limited: Too many voice sessions. Try again in a moment.");
    }

    // Daily token cap, fail closed (retryable). Voice minting is a paid call.
    // The local crisis card / crisis guardrail never go through this function.
    {
      const { requireAIBudget } = await import("@/lib/ai/log.server");
      const over = await requireAIBudget(context.userId);
      if (over) {
        const b = (await over.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          `${over.status === 429 ? "ai_budget_exhausted" : "ai_budget_unavailable"}: ${b.error ?? "AI is temporarily unavailable."}`,
        );
      }
    }


    // Trial gate: hard-block minting once the trial voice cap is exhausted.
    // Paying subscribers pass through with isTrial=false / cap=0.
    const env = input.environment === "live" ? "live" : "sandbox";
    const trialState = await loadTrialUsageState(context.userId, env);
    if (trialState.isTrial && trialState.limitReached) {
      throw new Error(
        "trial_limit_reached: You've used your trial voice minutes. Upgrade to keep talking to Pilot.",
      );
    }

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

    // Reply-shape rules + personality/accent/language (or the user's custom
    // override) + pacing hint, then the shared SAFETY_AND_CARE rules last so
    // the live voice surface has the same safety guardrail as text and TTS.
    const instructions = buildRealtimeInstructions(voiceProfile);

    // Debit the WORST-CASE session cost against the daily cap now (refused if
    // the remaining budget cannot cover it) and enforce one active session.
    // See src/lib/realtime/session-cost.server.ts for the cost model.
    const costMod = await import("@/lib/realtime/session-cost.server");
    const { supabaseAdmin: costAdmin } = await import("@/integrations/supabase/client.server");
    const started = await costMod.startRealtimeSession(costAdmin, context.userId);
    if (!started.ok) throw new Error(`${started.code}: ${started.message}`);
    const refundAndThrow = async (msg: string): Promise<never> => {
      await costMod.abortRealtimeSession(costAdmin, context.userId, started.sessionId, started.debit);
      throw new Error(msg);
    };

    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Short-lived token: it only has to survive the SDP handshake.
        expires_after: { anchor: "created_at", seconds: costMod.REALTIME_COST.TOKEN_TTL_SECONDS },
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
          max_output_tokens: costMod.REALTIME_COST.MAX_OUTPUT_TOKENS,
        },
      }),
      });
    } catch (e) {
      return refundAndThrow(e instanceof Error ? e.message : "Failed to mint realtime client secret");
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[realtime/openai] client_secret_mint_fail status=${res.status} body=${detail.slice(0, 240)}`,
      );
      if (res.status === 429) return refundAndThrow("OpenAI rate limit reached");
      if (res.status === 401) return refundAndThrow("OpenAI key rejected");
      return refundAndThrow("Failed to mint realtime client secret");
    }

    // POST /v1/realtime/client_secrets returns:
    //   { value: "ek_…", expires_at: <epoch seconds>, session: {...} }
    const data = (await res.json()) as {
      value?: string;
      expires_at?: number;
      session?: { model?: string; audio?: { output?: { voice?: string } } };
    };
    const value = data.value;
    if (!value) return refundAndThrow("Missing client_secret value in mint response");

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
      sessionId: started.sessionId,
      deadlineAt: started.deadlineAt,
      maxSessionSeconds: started.maxSessionSeconds,
      model: data.session?.model ?? DEFAULT_MODEL,
      voice: data.session?.audio?.output?.voice ?? voiceProfile.voiceId,
      greetingName,
      greetingLabel,
      trial: {
        isTrial: trialState.isTrial,
        remainingSeconds: trialState.remainingSeconds,
        capSeconds: trialState.capSeconds,
      },
    };

  });
