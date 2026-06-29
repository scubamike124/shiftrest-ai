// Lab-only: ElevenLabs Flash v2.5 TTS for the Simli POC. Returns MP3.
// Mirrors /api/tts-elevenlabs but locks the model to eleven_flash_v2_5 for
// minimum-latency conversational testing.

import { createFileRoute } from "@tanstack/react-router";

const DEFAULT_VOICE = "EXAVITQu4vr4xnSDxMaL"; // Sarah

export const Route = createFileRoute("/api/lab/simli/speak")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          return Response.json({ error: "ELEVENLABS_API_KEY missing" }, { status: 500 });
        }
        const body = (await request.json().catch(() => ({}))) as {
          text?: string;
          voice?: string;
        };
        const text = body.text?.trim();
        if (!text) return Response.json({ error: "text required" }, { status: 400 });
        const voiceId =
          body.voice && /^[a-zA-Z0-9]+$/.test(body.voice) ? body.voice : DEFAULT_VOICE;

        const t0 = Date.now();
        const upstream = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              text: text.slice(0, 4000),
              model_id: "eleven_flash_v2_5",
              voice_settings: {
                stability: 0.45,
                similarity_boost: 0.78,
                style: 0.35,
                use_speaker_boost: true,
                speed: 1.0,
              },
            }),
          },
        );
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          console.error(
            `[lab/simli/speak] tts_fail status=${upstream.status} ms=${Date.now() - t0} body=${detail.slice(0, 240)}`,
          );
          return Response.json(
            { error: "TTS failed", status: upstream.status },
            { status: 502 },
          );
        }
        return new Response(upstream.body, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
            "X-TTS-Ms": String(Date.now() - t0),
          },
        });
      },
    },
  },
});
