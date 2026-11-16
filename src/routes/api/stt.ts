/**
 * POST /api/stt — Forward audio to Lovable AI Gateway transcription.
 * Multipart in (file, optional language), JSON out ({ text }).
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { logAIRequest } from "@/lib/ai/log.server";

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function userIdFromAuth(
  admin: ReturnType<typeof getAdmin>,
  authHeader: string | null,
): Promise<string | null> {
  if (!admin || !authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/stt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();

        // Require authenticated user — STT calls a paid provider.
        const { requireUser } = await import("@/lib/api/auth.server");
        const authed = await requireUser(request);
        if ("response" in authed) return authed.response;

        // Explicit permission to share data with third-party AI (Guideline 5.1.2(i)).
        {
          const { requireAIConsent } = await import("@/lib/ai/consent.server");
          const refused = await requireAIConsent(authed.userId);
          if (refused) return refused;
        }

        {
          const { enforceRateLimit, RATE_LIMITS } = await import("@/lib/api/ratelimit.server");
          const limited = await enforceRateLimit(authed.userId, RATE_LIMITS.stt);
          if (limited) return limited;
        }

        {
          const { requireAIBudget } = await import("@/lib/ai/log.server");
          const overBudget = await requireAIBudget(authed.userId);
          if (overBudget) return overBudget;
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "STT not configured" },
            { status: 500 },
          );
        }

        let inbound: FormData;
        try {
          inbound = await request.formData();
        } catch {
          return Response.json({ error: "multipart required" }, { status: 400 });
        }
        const file = inbound.get("file");
        if (!(file instanceof Blob) || file.size === 0) {
          return Response.json({ error: "empty audio" }, { status: 400 });
        }
        if (file.size > 24 * 1024 * 1024) {
          return Response.json({ error: "audio too large" }, { status: 413 });
        }
        const language = inbound.get("language");

        const upstreamForm = new FormData();
        upstreamForm.append("model", "openai/gpt-4o-mini-transcribe");
        upstreamForm.append("file", file, "recording.wav");
        if (typeof language === "string" && language) {
          upstreamForm.append("language", language);
        }

        let upstream: Response;
        try {
          upstream = await fetch(
            "https://ai.gateway.lovable.dev/v1/audio/transcriptions",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}` },
              body: upstreamForm,
            },
          );
        } catch (e) {
          // The provider could not be reached: a retryable 503 with a provider
          // code instead of an unhandled error. Nothing is debited.
          console.error("[stt] network error", e instanceof Error ? e.message : String(e));
          const { notifyOwnerAsync } = await import("@/lib/ops/alert.server");
          notifyOwnerAsync({
            severity: "error",
            service: "stt",
            message: "network_error",
            meta: { error: e instanceof Error ? e.message : String(e) },
          });
          const { providerFailure } = await import("@/lib/ai/refusal");
          const failure = providerFailure(null);
          return Response.json(
            { error: "Voice is temporarily unavailable. Try again.", code: failure.code, retryable: true },
            { status: failure.status },
          );
        }

        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          console.error("[stt] upstream", upstream.status, detail);
          const { notifyOwnerAsync } = await import("@/lib/ops/alert.server");
          notifyOwnerAsync({
            severity: upstream.status === 402 ? "critical" : "error",
            service: "stt",
            message:
              upstream.status === 402
                ? "STT upstream 402 — AI credits exhausted"
                : `STT upstream ${upstream.status}`,
            meta: { status: upstream.status, detail: detail.slice(0, 500) },
          });
          const msg =
            upstream.status === 402
              ? "Voice is temporarily unavailable. Try again later."
              : upstream.status === 429
                ? "Voice is busy. Try again."
                : "Couldn't transcribe that — try again.";
          // Never pass the provider's status through (its 402/429 is not this
          // user's limit): 503 retryable, or 502 for audio the provider rejected.
          const { providerFailure } = await import("@/lib/ai/refusal");
          const failure = providerFailure(upstream.status);
          return Response.json(
            { error: msg, code: failure.code, retryable: failure.retryable },
            { status: failure.status },
          );
        }

        let payload: { text?: string; usage?: { input_tokens?: number; output_tokens?: number } } = {};
        try {
          payload = await upstream.json();
        } catch {
          /* leave empty */
        }
        const text = (payload.text ?? "").trim();

        // Accrue against the daily cap: provider tokens when reported, never
        // less than the audio-size estimate.
        {
          const { recordAIUsage, estimateSttTokens } = await import("@/lib/ai/log.server");
          const estimate = estimateSttTokens(file.size);
          const inTok = payload.usage?.input_tokens ?? 0;
          const outTok = payload.usage?.output_tokens ?? 0;
          await recordAIUsage(authed.userId, {
            intent: "stt",
            model: "openai/gpt-4o-mini-transcribe",
            promptTokens: Math.max(inTok, estimate - outTok),
            completionTokens: outTok,
            startedAt: started,
          });
        }

        return Response.json({ text });
      },
    },
  },
});
