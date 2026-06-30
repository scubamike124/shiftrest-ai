/**
 * POST /api/brief — rewrite a structured plan into a conversational voice script.
 *
 * Always returns 200 to the client. Real failures are logged server-side and
 * surfaced to the UI as a structured fallback envelope so VoicePlayer can show
 * a friendly toast instead of a runtime crash screen.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { AIError, DEFAULT_CHAT_MODEL, chatJSON } from "@/lib/ai/gateway.server";
import { logAIRequest } from "@/lib/ai/log.server";
import { BRIEF_SYSTEM, languageDirective } from "@/lib/ai/prompts.server";
import { buildTimeDirective } from "@/lib/ai/time-directive";


type Fallback = {
  fallback: true;
  reason: "credits" | "rate_limit" | "unavailable" | "config";
  message: string;
};

function fallback(reason: Fallback["reason"], message: string): Response {
  return Response.json({ fallback: true, reason, message } satisfies Fallback);
}

function reasonFromStatus(status: number): Fallback["reason"] {
  if (status === 402) return "credits";
  if (status === 429) return "rate_limit";
  if (status === 500 && false) return "config"; // placeholder
  return "unavailable";
}

function messageFromReason(reason: Fallback["reason"]): string {
  switch (reason) {
    case "credits":
      return "Voice briefing is paused — AI credits are exhausted. Try again later.";
    case "rate_limit":
      return "Voice briefing is busy right now. Give it a moment and try again.";
    case "config":
      return "Voice briefing isn't configured on the server yet.";
    default:
      return "Voice briefing is temporarily unavailable. Please try again shortly.";
  }
}

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

export const Route = createFileRoute("/api/brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();

        let plan: string | undefined;
        let localTime: string | undefined;
        let timezone: string | undefined;
        try {
          const body = (await request.json()) as {
            plan?: string;
            localTime?: string;
            timezone?: string;
          };
          plan = typeof body?.plan === "string" ? body.plan.trim() : undefined;
          localTime = typeof body?.localTime === "string" ? body.localTime : undefined;
          timezone = typeof body?.timezone === "string" ? body.timezone : undefined;
        } catch {
          return new Response(
            JSON.stringify({ error: "Invalid JSON body" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }
        if (!plan) {
          return new Response(
            JSON.stringify({ error: "plan required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        if (!process.env.LOVABLE_API_KEY) {
          console.error("[brief] LOVABLE_API_KEY missing");
          return fallback("config", messageFromReason("config"));
        }

        // Pin the greeting and clock to the user's actual local time so we
        // never greet "Good evening" at 9 AM. Shared helper used by every
        // conversational surface.
        const timeDirective = buildTimeDirective({ localTime, timezone }).directive;

        try {
          // Load language pref up front so the briefing is generated directly in
          // the user's chosen language (no English-first then translate).
          const admin = getAdmin();
          const userId = await userIdFromAuth(
            admin,
            request.headers.get("authorization"),
          );
          let language = "en-US";
          let accent: string | null = null;
          if (admin && userId) {
            const { data } = await admin
              .from("user_prefs")
              .select("voice_language, voice_accent")
              .eq("user_id", userId)
              .maybeSingle();
            const row = data as { voice_language?: string | null; voice_accent?: string | null } | null;
            language = row?.voice_language || "en-US";
            accent = row?.voice_accent || null;
          }
          const system = languageDirective(language, accent) + BRIEF_SYSTEM + timeDirective;

          const result = await chatJSON({
            messages: [
              { role: "system", content: system },
              { role: "user", content: plan },
            ],
          });


          if (!result.text) {
            console.error("[brief] empty model response");
            return fallback("unavailable", messageFromReason("unavailable"));
          }

          // Best-effort usage log; never block the response on it.
          // (admin + userId already resolved above.)

          if (admin && userId) {
            logAIRequest(admin, {
              user_id: userId,
              intent: "brief",
              model: DEFAULT_CHAT_MODEL,
              prompt_tokens: result.promptTokens,
              completion_tokens: result.completionTokens,
              latency_ms: Date.now() - started,
              status: "ok",
            }).catch((e) => console.error("[brief] log failed", e));
          }

          return Response.json({ script: result.text });
        } catch (e) {
          const status = e instanceof AIError ? e.status : 500;
          const message = e instanceof Error ? e.message : String(e);
          console.error("[brief] upstream failed", { status, message });
          const reason = reasonFromStatus(status);
          return fallback(reason, messageFromReason(reason));
        }
      },
    },
  },
});
