// ElevenLabs TTS route — mirrors /api/tts contract (text + voice + mode → MP3)
// so speak.ts can swap providers behind a flag without UI changes.

import { createFileRoute } from "@tanstack/react-router";

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

          // Per-mode prosody presets (Phase 1 voice system).
          const preset =
            mode === "sleep"        ? { stability: 0.65, similarity: 0.80, style: 0.15, speed: 0.92, prefix: "[whisper] [soft] " }
          : mode === "encouraging"  ? { stability: 0.40, similarity: 0.78, style: 0.55, speed: 1.02, prefix: "" }
          : mode === "thinking"     ? { stability: 0.55, similarity: 0.75, style: 0.20, speed: 0.98, prefix: "" }
                                    : { stability: 0.45, similarity: 0.78, style: 0.35, speed: 1.00, prefix: "" };

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
                  use_speaker_boost: true,
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
