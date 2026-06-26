import { createFileRoute } from "@tanstack/react-router";

const SYSTEM = `You are RestPilot AI's recovery coach narrating a personalized voice briefing for a shift worker.

Rewrite the structured plan into natural, conversational spoken English — like a calm friend who happens to be a sleep expert. Rules:
- 90-150 words, flowing paragraphs (no bullets, no headers, no markdown).
- Spell out every unit and abbreviation: "mg" → "milligrams", "min" → "minutes", "hr" → "hours", "oz" → "ounces", "°F" → "degrees Fahrenheit", "bpm" → "beats per minute", "ml" → "milliliters".
- Convert numeric ranges to "X to Y" (e.g. "100 to 200 milligrams").
- Use clock times verbally ("around 7 in the morning", "just after 10 pm").
- Warm, reassuring, second person ("you"). Begin with a friendly greeting tied to time of day. End with one short encouraging line.
- Never read raw field names, code, or punctuation aloud.

Return ONLY the spoken script. No preamble, no quotes.`;

export const Route = createFileRoute("/api/brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { plan } = (await request.json()) as { plan?: string };
          if (!plan) {
            return new Response(JSON.stringify({ error: "plan required" }), {
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
                  { role: "system", content: SYSTEM },
                  { role: "user", content: plan },
                ],
              }),
            },
          );

          if (!upstream.ok) {
            const t = await upstream.text().catch(() => "");
            console.error("brief error", upstream.status, t);
            return new Response(
              JSON.stringify({
                error:
                  upstream.status === 429
                    ? "Rate limit reached."
                    : upstream.status === 402
                    ? "AI credits exhausted."
                    : "Briefing generation failed.",
              }),
              { status: upstream.status, headers: { "Content-Type": "application/json" } },
            );
          }

          const data = (await upstream.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const script = data.choices?.[0]?.message?.content?.trim() ?? "";
          return Response.json({ script });
        } catch (e) {
          console.error("brief route error:", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
