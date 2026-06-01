import { createFileRoute } from "@tanstack/react-router";

type Msg = { role: "user" | "assistant" | "system"; content: string };

const SYSTEM_PROMPT = `You are ShiftRest AI's Sleep Coach: an empathetic, professional circadian-rhythm expert helping shift workers (nurses, EMTs, pilots, factory crews, hospitality, security) sleep better despite erratic schedules.

Be concrete and actionable. Cover practical tactics: light exposure timing, blackout setups, caffeine timing, anchor sleep, naps, meal timing, recovery between rotations, commute strategies (amber glasses), and bedroom environment (temperature 65-68°F, sound, darkness).

Keep responses tight (3-6 short paragraphs or a short list). Never give medical advice — for sleep disorders, depression, or medication questions, recommend they consult a healthcare professional. Use plain language, no jargon dumps.`;

export const Route = createFileRoute("/api/coach")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { messages } = (await request.json()) as { messages: Msg[] };
          if (!Array.isArray(messages) || messages.length === 0) {
            return new Response(JSON.stringify({ error: "messages required" }), {
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
            "https://ai.gateway.lovable.dev/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  ...messages.slice(-20),
                ],
                stream: true,
              }),
            },
          );

          if (!upstream.ok) {
            if (upstream.status === 429) {
              return new Response(
                JSON.stringify({ error: "Rate limit reached. Try again in a moment." }),
                { status: 429, headers: { "Content-Type": "application/json" } },
              );
            }
            if (upstream.status === 402) {
              return new Response(
                JSON.stringify({
                  error:
                    "AI credits exhausted. Add funds in Settings > Workspace > Usage.",
                }),
                { status: 402, headers: { "Content-Type": "application/json" } },
              );
            }
            const t = await upstream.text();
            console.error("AI gateway error:", upstream.status, t);
            return new Response(JSON.stringify({ error: "AI gateway error" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(upstream.body, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
            },
          });
        } catch (e) {
          console.error("coach route error:", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
