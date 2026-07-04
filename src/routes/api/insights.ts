import { createFileRoute } from "@tanstack/react-router";

// Produces a personalized, proactive briefing the dashboard renders on every open.
// Input: deterministic context string + recent signals (computed client-side).
// Output: JSON { greeting, headline, fatigue_note, top_actions[3], coach_note }.

const SYSTEM = `You are RestPilot AI, a warm and concrete recovery coach.

Given a CONTEXT block describing a shift worker's day, fatigue, recovery, and signals, return a personalized briefing. Be specific — refer to their actual shift times, fatigue level, and pattern. Never generic.

Return ONLY valid JSON matching this exact shape (no markdown, no preamble):
{
  "greeting": "Short warm greeting referencing time of day or pattern (max 10 words)",
  "headline": "One punchy sentence summarizing today's priority (max 16 words)",
  "fatigue_note": "One sentence on why fatigue is what it is today (max 22 words)",
  "top_actions": [
    {"icon": "sun|coffee|moon|water|food|nap|light", "title": "3-5 word title", "detail": "One sentence with exact time/dose."},
    {"icon": "...", "title": "...", "detail": "..."},
    {"icon": "...", "title": "...", "detail": "..."}
  ],
  "coach_note": "One closing line of encouragement or a small win to chase (max 20 words)"
}

Rules:
- Always include exact units spelled fully ("100 milligrams", "30 minutes", "65 degrees Fahrenheit").
- top_actions must be ordered by impact. Avoid duplicates.
- If no shift today, focus on recovery, anchor sleep, and prep for next shift.
- Tone: warm, confident, never preachy.`;

export const Route = createFileRoute("/api/insights")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { requireUser } = await import("@/lib/api/auth.server");
          const auth = await requireUser(request);
          if ("response" in auth) return auth.response;

          {
            const { enforceRateLimit, RATE_LIMITS } = await import("@/lib/api/ratelimit.server");
            const limited = await enforceRateLimit(auth.userId, RATE_LIMITS.ai);
            if (limited) return limited;
          }

          const { context } = (await request.json()) as { context?: string };
          if (!context || typeof context !== "string") {
            return new Response(JSON.stringify({ error: "context required" }), {
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
                  { role: "user", content: context },
                ],
                response_format: { type: "json_object" },
              }),
            },
          );

          if (!upstream.ok) {
            const t = await upstream.text().catch(() => "");
            console.error("insights error", upstream.status, t);
            return new Response(
              JSON.stringify({
                error:
                  upstream.status === 429
                    ? "Rate limit reached."
                    : upstream.status === 402
                    ? "AI credits exhausted."
                    : "Insights unavailable.",
              }),
              { status: upstream.status, headers: { "Content-Type": "application/json" } },
            );
          }

          const data = (await upstream.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const raw = data.choices?.[0]?.message?.content?.trim() ?? "{}";
          // Strip accidental code fences just in case.
          const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
          let parsed: unknown;
          try {
            parsed = JSON.parse(cleaned);
          } catch {
            console.error("insights parse failure", cleaned.slice(0, 200));
            return new Response(JSON.stringify({ error: "Bad AI response" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          return Response.json(parsed);
        } catch (e) {
          console.error("insights route error:", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
