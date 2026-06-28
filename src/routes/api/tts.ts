import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  DEFAULT_VOICE_PROFILE,
  buildInstructions,
  clampSpeed,
  VOICE_OPTIONS,
  type PersonalityKey,
  type VoiceProfile,
} from "@/lib/voice/profile";

type Fallback = {
  fallback: true;
  reason: "credits" | "rate_limit" | "unavailable" | "config";
  message: string;
};

function fallback(reason: Fallback["reason"], message: string): Response {
  return Response.json({ fallback: true, reason, message } satisfies Fallback);
}

function messageFromReason(reason: Fallback["reason"]): string {
  switch (reason) {
    case "credits":    return "Voice playback is paused — AI credits are exhausted.";
    case "rate_limit": return "Voice playback is busy. Try again in a moment.";
    case "config":     return "Voice playback isn't configured on the server yet.";
    default:           return "Voice playback is temporarily unavailable.";
  }
}

const VALID_VOICE_IDS = new Set(VOICE_OPTIONS.map((v) => v.id));
const VALID_PERSONALITIES = new Set<PersonalityKey>([
  "calm","friendly","professional","motivational","companion","coach","energetic",
]);

async function loadUserVoiceProfile(authHeader: string | null): Promise<VoiceProfile> {
  if (!authHeader?.startsWith("Bearer ")) return DEFAULT_VOICE_PROFILE;
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) return DEFAULT_VOICE_PROFILE;
  try {
    const supa = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userRes } = await supa.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return DEFAULT_VOICE_PROFILE;
    const { data } = await supa
      .from("user_prefs")
      .select("voice_id, voice_language, voice_accent, voice_personality, voice_speed, voice_instructions")
      .eq("user_id", uid)
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
      voiceId: VALID_VOICE_IDS.has(row.voice_id ?? "") ? (row.voice_id as string) : DEFAULT_VOICE_PROFILE.voiceId,
      language: row.voice_language || DEFAULT_VOICE_PROFILE.language,
      accent: row.voice_accent || null,
      personality: VALID_PERSONALITIES.has(row.voice_personality as PersonalityKey)
        ? (row.voice_personality as PersonalityKey)
        : DEFAULT_VOICE_PROFILE.personality,
      speed: clampSpeed(row.voice_speed),
      instructionsOverride: row.voice_instructions || null,
    };
  } catch (e) {
    console.warn("[tts] profile load failed", e);
    return DEFAULT_VOICE_PROFILE;
  }
}

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            text?: string;
            // Optional overrides (used by the in-settings preview):
            voice?: string;
            language?: string;
            accent?: string | null;
            personality?: PersonalityKey;
            speed?: number;
            instructions?: string;
          };
          const text = body.text;
          if (!text || typeof text !== "string") {
            return new Response(JSON.stringify({ error: "text required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            console.error("[tts] LOVABLE_API_KEY missing");
            return fallback("config", messageFromReason("config"));
          }

          const profile = await loadUserVoiceProfile(request.headers.get("authorization"));

          const merged: VoiceProfile = {
            voiceId: body.voice && VALID_VOICE_IDS.has(body.voice) ? body.voice : profile.voiceId,
            language: body.language || profile.language,
            accent: body.accent !== undefined ? body.accent : profile.accent,
            personality:
              body.personality && VALID_PERSONALITIES.has(body.personality)
                ? body.personality
                : profile.personality,
            speed: body.speed !== undefined ? clampSpeed(body.speed) : profile.speed,
            instructionsOverride: body.instructions ?? profile.instructionsOverride,
          };

          const instructions = buildInstructions(merged);

          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "openai/gpt-4o-mini-tts",
              input: text.slice(0, 4000),
              voice: merged.voiceId,
              response_format: "mp3",
              speed: merged.speed,
              instructions,
            }),
          });

          if (!upstream.ok) {
            const t = await upstream.text().catch(() => "");
            console.error("[tts] upstream failed", upstream.status, t);
            const reason: Fallback["reason"] =
              upstream.status === 402 ? "credits"
              : upstream.status === 429 ? "rate_limit"
              : "unavailable";
            return fallback(reason, messageFromReason(reason));
          }

          return new Response(upstream.body, {
            headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
          });
        } catch (e) {
          console.error("[tts] route error", e);
          return fallback("unavailable", messageFromReason("unavailable"));
        }
      },
    },
  },
});
