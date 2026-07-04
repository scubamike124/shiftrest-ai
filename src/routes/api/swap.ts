import { createFileRoute } from "@tanstack/react-router";

const SYSTEM = `You are RestPilot AI's recovery analyst. Evaluate whether a shift worker should accept a proposed extra shift, weighing it against their current week and recovery state.

Return ONLY valid JSON in this exact shape:
{
  "verdict": "take_it" | "take_with_caveats" | "skip_it",
  "verdict_label": "Take it" | "Take it — with caveats" | "Skip it",
  "cost": "low" | "medium" | "high",
  "cost_reason": "One sentence (max 20 words) on why.",
  "risks": ["Risk 1 (max 12 words)", "Risk 2", "Risk 3"],
  "naps": [
    {"time": "HH:MM", "duration_min": 20, "why": "Why this nap (max 14 words)"}
  ],
  "summary": "Two sentences of warm coach guidance, second person."
}

Rules:
- Always spell units fully in summary ("milligrams", "minutes", "hours").
- Use 24h times in nap "time".
- 0–3 risks. 0–2 naps. Always at least one entry in risks.
- Be specific to the proposed shift and current week — never generic.`;

export const Route = createFileRoute("/api/swap")({
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
          if (!context) {
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
            console.error("swap error", upstream.status, t);
            return new Response(
              JSON.stringify({
                error:
                  upstream.status === 429
                    ? "Rate limit reached."
                    : upstream.status === 402
                    ? "AI credits exhausted."
                    : "Analysis unavailable.",
              }),
              { status: upstream.status, headers: { "Content-Type": "application/json" } },
            );
          }

          const data = (await upstream.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const raw = data.choices?.[0]?.message?.content?.trim() ?? "{}";
          const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
          let parsed: unknown;
          try {
            parsed = JSON.parse(cleaned);
          } catch {
            return new Response(JSON.stringify({ error: "Bad AI response" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          return Response.json(parsed);
        } catch (e) {
          console.error("swap route error:", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
