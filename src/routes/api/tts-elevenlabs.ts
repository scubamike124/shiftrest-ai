// ElevenLabs TTS route — mirrors /api/tts contract (text + voice + mode → MP3)
// so speak.ts can swap providers behind a flag without UI changes.

import { createFileRoute } from "@tanstack/react-router";

type Fallback = {
  fallback: true;
  reason: "credits" | "rate_limit" | "unavailable" | "config";
  message: string;
};

function fallback(reason: Fallback["reason"], message: string): Response {
  // Return non-2xx so the client's `!resp.ok` fallback branch kicks in and
  // routes to OpenAI instead of treating this JSON envelope as audio bytes.
  const status = reason === "credits" ? 402 : reason === "rate_limit" ? 429 : 502;
  return Response.json(
    { fallback: true, reason, message } satisfies Fallback,
    { status, headers: { "x-tts-provider": "elevenlabs", "x-tts-reason": reason } },
  );
}

function messageFromReason(reason: Fallback["reason"]): string {
  switch (reason) {
    case "credits":    return "Voice playback is paused — provider credits exhausted.";
    case "rate_limit": return "ElevenLabs is rate-limiting. Try again in a moment.";
    case "config":     return "ElevenLabs isn't configured on the server yet.";
    default:           return "ElevenLabs voice is temporarily unavailable.";
  }
}

const DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"; // Sarah

export const Route = createFileRoute("/api/tts-elevenlabs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const t0 = Date.now();

        // Require authenticated user — ElevenLabs is a paid provider call.
        const { requireUser } = await import("@/lib/api/auth.server");
        const auth = await requireUser(request);
        if ("response" in auth) return auth.response;

        try {
          const reqBody = (await request.json()) as {
            text?: string;
            voice?: string;
            mode?: "normal" | "sleep" | "encouraging" | "thinking";
          };
          const text = reqBody.text;
          if (!text || typeof text !== "string") {
            console.warn("[tts-elevenlabs] bad_request reason=missing_text");
            return new Response(JSON.stringify({ error: "text required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const apiKey = process.env.ELEVENLABS_API_KEY;
          if (!apiKey) {
            console.error("[tts-elevenlabs] provider_failure reason=config_missing ELEVENLABS_API_KEY not set");
            return fallback("config", messageFromReason("config"));
          }

          const voiceId = reqBody.voice && /^[a-zA-Z0-9]+$/.test(reqBody.voice) ? reqBody.voice : DEFAULT_VOICE;
          const mode = reqBody.mode ?? "normal";
          const textLen = text.length;

          // Per-mode prosody presets (Final polish — bedtime tuning).
          // - normal: slower (0.88), softer (style 0.05), more stable (0.72),
          //   speaker_boost OFF so loudness stays flat turn-to-turn.
          // - sleep: drops [soft] (caused volume dropouts vs normal); keeps [slowly].
          // - encouraging: keeps speaker_boost for clarity in louder moments.
          // - thinking: same flat profile as normal.
          const preset =
            mode === "sleep"        ? { stability: 0.78, similarity: 0.82, style: 0.05, speed: 0.86, prefix: "[slowly] ", boost: false }
          : mode === "encouraging"  ? { stability: 0.50, similarity: 0.80, style: 0.40, speed: 1.00, prefix: "[warm] ",   boost: true  }
          : mode === "thinking"     ? { stability: 0.70, similarity: 0.80, style: 0.08, speed: 0.92, prefix: "",          boost: false }
                                    : { stability: 0.72, similarity: 0.80, style: 0.05, speed: 0.88, prefix: "",          boost: false };

          const upstream = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
            {
              method: "POST",
              headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                text: (preset.prefix + text).slice(0, 4000),
                model_id: "eleven_turbo_v2_5",
                voice_settings: {
                  stability: preset.stability,
                  similarity_boost: preset.similarity,
                  style: preset.style,
                  use_speaker_boost: preset.boost,
                  speed: preset.speed,
                },
              }),
            },
          );

          if (!upstream.ok) {
            const upstreamBody = await upstream.text().catch(() => "");
            // Server-side log = PROVIDER failures only. Browser/autoplay
            // failures never reach this route — they happen client-side
            // after the 200 response is already on the wire.
            const reason: Fallback["reason"] =
              upstream.status === 402 ? "credits"
              : upstream.status === 429 ? "rate_limit"
              : "unavailable";
            console.error(
              `[tts-elevenlabs] provider_failure reason=${reason} status=${upstream.status} voice=${voiceId} mode=${mode} textLen=${textLen} ms=${Date.now() - t0} body=${upstreamBody.slice(0, 240)}`,
            );
            return fallback(reason, messageFromReason(reason));
          }

          console.log(
            `[tts-elevenlabs] provider_ok voice=${voiceId} mode=${mode} textLen=${textLen} ms=${Date.now() - t0}`,
          );
          return new Response(upstream.body, {
            headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
          });
        } catch (e) {
          console.error(
            `[tts-elevenlabs] provider_failure reason=network ms=${Date.now() - t0} err=${e instanceof Error ? e.message : String(e)}`,
          );
          return fallback("unavailable", messageFromReason("unavailable"));
        }
      },
    },
  },
});
