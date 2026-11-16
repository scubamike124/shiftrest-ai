import { aiApiKey, aiEndpoint, aiAudioModel } from "@/lib/ai/provider.server";
import { buildChatBody, modelForTask, reasoningForTask } from "@/lib/ai/models.server";
import { DATA_HONESTY } from "@/lib/ai/guardrails";
import { normalizeSwap } from "@/lib/ai/intent-schemas";
import { readAIJson } from "@/lib/ai/request.server";
import { requireAIAdmission, type AIRefundHandle } from "@/lib/ai/admission.server";
import { providerFailure, providerFailureResponse } from "@/lib/ai/refusal";
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
- Be specific to the proposed shift and current week — never generic.

${DATA_HONESTY}`;

export const Route = createFileRoute("/api/swap")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { requireUser } = await import("@/lib/api/auth.server");
          const auth = await requireUser(request);
          if ("response" in auth) return auth.response;
          // Explicit permission to share data with third-party AI (Guideline 5.1.2(i)).
          // Before admission, so a refusal never uses up the user's AI allowance.
          {
            const { requireAIConsent } = await import("@/lib/ai/consent.server");
            const refused = await requireAIConsent(auth.userId);
            if (refused) return refused;
          }
          // The handle gives this request back if the provider fails it (below).
          const refund: AIRefundHandle = {};
          const admission = await requireAIAdmission(auth.userId, refund);
        if (admission) return admission;
        const input = await readAIJson(request);
        if ("response" in input) return input.response;


          {
            const { enforceRateLimit, RATE_LIMITS } = await import("@/lib/api/ratelimit.server");
            const limited = await enforceRateLimit(auth.userId, RATE_LIMITS.ai);
            if (limited) return limited;
          }

          const { context } = (input.body) as { context?: string };
          if (!context) {
            return new Response(JSON.stringify({ error: "context required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const apiKey = aiApiKey();
          if (!apiKey || !process.env.AI_CHAT_MODEL) {
            return new Response(JSON.stringify({ error: "AI not configured" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          let upstream: Response;
          try {
            upstream = await fetch(aiEndpoint("chat/completions"), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(
                buildChatBody({
                  model: modelForTask("structured") ?? "not-configured",
                  maxTokens: 2048,
                  messages: [
                    { role: "system", content: SYSTEM },
                    { role: "user", content: context },
                  ],
                  jsonMode: true,
                  reasoningEffort: reasoningForTask("structured"),
                }),
              ),
            });
          } catch (e) {
            // The provider could not be reached: a retryable 503 with a provider code,
            // never a bare 500 carrying the raw error text.
            console.error("swap network error", e instanceof Error ? e.message : String(e));
            const { notifyOwnerAsync } = await import("@/lib/ops/alert.server");
            notifyOwnerAsync({
              severity: "error",
              service: "swap",
              message: "network_error",
              meta: { error: e instanceof Error ? e.message : String(e) },
            });
            await refund.refundProviderFailure?.(null, request.signal);
            const failure = providerFailure(null);
            return Response.json(
              { error: failure.message, code: failure.code, retryable: true },
              {
                status: failure.status,
                headers: { "Retry-After": String(failure.retryAfterSeconds) },
              },
            );
          }

          if (!upstream.ok) {
            const t = await upstream.text().catch(() => "");
            console.error("swap error", upstream.status, t);
            if (upstream.status !== 429 && upstream.status !== 402) {
              const { notifyOwnerAsync } = await import("@/lib/ops/alert.server");
              notifyOwnerAsync({
                severity: "high",
                service: "swap",
                message: `AI gateway upstream ${upstream.status}`,
                meta: { snippet: t.slice(0, 240) },
              });
            }
            // Never pass the provider's status through: its 429 is not this user's
            // limit, its 401 is not the user's session. Retryable 503 (502 for a
            // rejected request) with an ai_provider_* code.
            await refund.refundProviderFailure?.(upstream.status, request.signal);
            return providerFailureResponse(upstream.status);
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
          const normalized = normalizeSwap(parsed);
          if (!normalized.ok) {
            console.error("swap output rejected", normalized.reason);
            return new Response(JSON.stringify({ error: "Bad AI response" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          return Response.json(normalized.value);
        } catch (e) {
          console.error("swap route error:", e);
          const { notifyOwnerAsync } = await import("@/lib/ops/alert.server");
          notifyOwnerAsync({
            severity: "high",
            service: "swap",
            message: `Unhandled route error: ${e instanceof Error ? e.message : String(e)}`,
          });
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
