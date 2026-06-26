import { createFileRoute } from "@tanstack/react-router";

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
            return new Response(JSON.stringify({ error: "AI not configured" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
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
            const status = upstream.status;
            const msg =
              status === 429
                ? "Rate limit reached. Try again shortly."
                : status === 402
                ? "AI credits exhausted."
                : `Voice generation failed (${status}).`;
            console.error("tts error", status, t);
            return new Response(JSON.stringify({ error: msg }), {
              status,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(upstream.body, {
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "no-store",
            },
          });
        } catch (e) {
          console.error("tts route error:", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
