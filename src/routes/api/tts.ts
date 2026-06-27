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
    case "credits":
      return "Voice playback is paused — AI credits are exhausted.";
    case "rate_limit":
      return "Voice playback is busy. Try again in a moment.";
    case "config":
      return "Voice playback isn't configured on the server yet.";
    default:
      return "Voice playback is temporarily unavailable.";
  }
}

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { text, voice } = (await request.json()) as {
            text?: string;
            voice?: string;
          };
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

          const upstream = await fetch(
            "https://ai.gateway.lovable.dev/v1/audio/speech",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "openai/gpt-4o-mini-tts",
                input: text.slice(0, 4000),
                voice: voice || "sage",
                response_format: "mp3",
                instructions:
                  "Speak in a calm, warm, conversational tone — like a trusted recovery coach. Natural pacing, gentle confidence, never robotic.",
              }),
            },
          );

          if (!upstream.ok) {
            const t = await upstream.text().catch(() => "");
            console.error("[tts] upstream failed", upstream.status, t);
            const reason: Fallback["reason"] =
              upstream.status === 402
                ? "credits"
                : upstream.status === 429
                ? "rate_limit"
                : "unavailable";
            return fallback(reason, messageFromReason(reason));
          }

          return new Response(upstream.body, {
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "no-store",
            },
          });
        } catch (e) {
          console.error("[tts] route error", e);
          return fallback("unavailable", messageFromReason("unavailable"));
        }
      },
    },
  },
});
