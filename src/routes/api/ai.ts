/**
 * /api/ai — single orchestrator for every AI intent.
 *
 * Why one endpoint:
 * - Shared auth, budget check, context build, logging in one place
 * - New intents (Bundle 2 calendar/commute, Bundle 3 universal search) are
 *   additive — no new routes, no duplicated boilerplate.
 *
 * Intents:
 *   "coach"          — streaming chat (SSE passthrough, OpenAI-compatible)
 *   "brief"          — non-streaming voice-friendly rewrite of a plan
 *   "memory_extract" — internal background call (no external triggers)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  AIError,
  DEFAULT_CHAT_MODEL,
  chatJSON,
  chatStream,
  mapUpstreamError,
  type ChatMsg,
} from "@/lib/ai/gateway.server";
import {
  buildSystemPrompt,
  loadAssistantProfile,
} from "@/lib/ai/context.server";
import { checkAIBudget, logAIRequest } from "@/lib/ai/log.server";
import { extractAndStoreMemories } from "@/lib/ai/memory-extractor.server";

type Body =
  | { intent: "coach"; messages: ChatMsg[]; context?: string }
  | { intent: "brief"; plan: string }
  | { intent: "daily_plan"; horizon?: "24h" | "72h"; context?: string }
  | { intent: "smart_alarm"; targetWakeIso: string; windowMin: number; context?: string }
  | { intent: "commute"; shiftStartIso: string; travelMin: number; prepMin?: number; context?: string }
  | { intent: "coach_tip"; context?: string }
  | { intent: "right_now"; context?: string }
  | { intent: "adjust_plan"; observation: string; context?: string };

const BRIEF_SYSTEM = `You are RestPilot AI's recovery coach narrating a personalized voice briefing for a shift worker.

Rewrite the structured plan into natural, conversational spoken English — like a calm friend who happens to be a sleep expert. Rules:
- 90-150 words, flowing paragraphs (no bullets, no headers, no markdown).
- Spell out every unit and abbreviation: "mg" → "milligrams", "min" → "minutes", "hr" → "hours", "oz" → "ounces", "°F" → "degrees Fahrenheit", "bpm" → "beats per minute", "ml" → "milliliters".
- Convert numeric ranges to "X to Y" (e.g. "100 to 200 milligrams").
- Use clock times verbally ("around 7 in the morning", "just after 10 pm").
- Warm, reassuring, second person ("you"). Begin with a friendly greeting tied to time of day. End with one short encouraging line.
- Never read raw field names, code, or punctuation aloud.

Return ONLY the spoken script. No preamble, no quotes.`;

const DAILY_PLAN_SYSTEM = `You are RestPilot AI's personal sleep & recovery strategist.
Given the user's circadian context, produce a tight JSON action plan for the requested horizon.
Return ONLY valid JSON matching: {"headline": string (<=70 chars), "riskLevel": "low"|"medium"|"high", "actions": [{"id": string, "title": string (<=60 chars), "detail": string (<=140 chars), "category": "sleep"|"light"|"caffeine"|"movement"|"recovery"|"nutrition", "priority": 1|2|3, "when": string}]}
Provide 3-5 actions, highest priority first. Be specific with times. No markdown, no commentary.`;

const SMART_ALARM_SYSTEM = `You are RestPilot AI's smart alarm engine.
Given the target wake time and a ± window (minutes), the user's circadian context, and any wearable signals, choose the optimal wake moment inside the window that is most likely to land near the end of a sleep cycle (~90-min cycles from estimated sleep onset).
Return ONLY valid JSON: {"wakeAt": ISO string inside the window, "reason": string (<=110 chars, explain WHY this time — e.g. "Moved 18 min later because you'll wake near the end of a REM cycle"), "cyclePosition": "rem_end"|"light_sleep"|"deep_avoid"|"natural", "confidence": "low"|"medium"|"high", "message": string (<=80 chars, warm one-liner shown when alarm fires)}.`;

const COMMUTE_SYSTEM = `You are RestPilot AI's commute & prep coach.
Given a shift start time (ISO), travel minutes, and optional prep minutes, return ONLY valid JSON:
{"leaveAt": ISO, "prepStartAt": ISO, "advice": string (<=140 chars, concrete pre-shift prep tip tailored to the user's fatigue + light context)}.
leaveAt = shiftStart - travelMin. prepStartAt = leaveAt - (prepMin ?? 25).`;

const COACH_TIP_SYSTEM = `You are RestPilot AI's productivity & recovery coach.
Produce ONE short, fresh, contextual tip for the user right now — different from generic advice. Use their circadian + fatigue + schedule context.
Return ONLY valid JSON: {"tip": string (<=160 chars, second person, no emoji-spam, max one emoji), "generatedAt": ISO string of now}.`;

const RIGHT_NOW_SYSTEM = `You are RestPilot AI's in-the-moment decision engine. The user just opened the app — answer the only three questions that matter:
1) What should I do RIGHT NOW (next 15-60 min)?
2) Why?
3) What happens if I ignore it?

Pick the single highest-leverage action based on their circadian context, current time, next shift, fatigue, and wearable signals. Be specific (exact minute, exact action). Speak in second person, plain English, no jargon.

Return ONLY valid JSON: {"action": string (<=70 chars, imperative — e.g. "Get 10 min of bright light before 9:30am"), "why": string (<=130 chars, the circadian/fatigue reason), "ignoreCost": string (<=120 chars, concrete consequence — e.g. "Tonight's sleep onset slides 25 min later and tomorrow's REM drops"), "urgency": "now"|"soon"|"later", "ctaLabel": string (<=22 chars, e.g. "See full plan"), "ctaRoute": "/plan"|"/events"|"/coach"|"/dashboard"}.`;

const ADJUST_PLAN_SYSTEM = `You are RestPilot AI adapting tomorrow's plan in response to a user-confirmed observation. Suggest 2-3 concrete adjustments.
Return ONLY valid JSON: {"summary": string (<=110 chars, what you're changing and why), "changes": [{"label": string (<=50 chars), "from": string (<=30 chars), "to": string (<=30 chars), "reason": string (<=90 chars)}]}.`;

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new AIError(500, "Backend not configured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUserIdFromAuthHeader(
  admin: ReturnType<typeof getAdminClient>,
  authHeader: string | null,
): Promise<string | null> {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export const Route = createFileRoute("/api/ai")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return jsonError(400, "Invalid JSON body");
        }
        if (!body || !("intent" in body)) {
          return jsonError(400, "intent required");
        }

        let admin;
        try {
          admin = getAdminClient();
        } catch (e) {
          const msg = e instanceof AIError ? e.message : "Backend error";
          return jsonError(500, msg);
        }

        const userId = await getUserIdFromAuthHeader(
          admin,
          request.headers.get("authorization"),
        );

        // Budget gate (only when we know who you are)
        if (userId) {
          const ok = await checkAIBudget(admin, userId);
          if (!ok) {
            return jsonError(
              429,
              "Daily AI limit reached. It resets in 24 hours.",
            );
          }
        }

        try {
          if (body.intent === "coach") {
            if (!Array.isArray(body.messages) || body.messages.length === 0) {
              return jsonError(400, "messages required");
            }

            const profile = userId
              ? await loadAssistantProfile(admin, userId)
              : { name: "RestPilot", mode: "coach" as const, memoryEnabled: false };

            const system = await buildSystemPrompt({
              admin,
              userId,
              profile,
              liveContext: body.context,
            });

            const trimmed = body.messages.slice(-20);
            const upstream = await chatStream({
              model: DEFAULT_CHAT_MODEL,
              messages: [{ role: "system", content: system }, ...trimmed],
            });

            // Tee the stream so we can extract memories + log usage after.
            const [forClient, forCapture] = upstream.body!.tee();

            // Fire-and-forget capture
            if (userId) {
              const lastUser = [...trimmed].reverse().find((m) => m.role === "user");
              captureAndExtract({
                admin,
                userId,
                userTurn: lastUser?.content ?? "",
                memoryEnabled: profile.memoryEnabled,
                stream: forCapture,
                started,
              }).catch((e) => console.error("capture failed", e));
            } else {
              // Still drain to free the buffer
              forCapture.cancel().catch(() => {});
            }

            return new Response(forClient, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
              },
            });
          }

          if (body.intent === "brief") {
            if (!body.plan) return jsonError(400, "plan required");
            const result = await chatJSON({
              messages: [
                { role: "system", content: BRIEF_SYSTEM },
                { role: "user", content: body.plan },
              ],
            });
            if (userId) {
              await logAIRequest(admin, {
                user_id: userId,
                intent: "brief",
                model: DEFAULT_CHAT_MODEL,
                prompt_tokens: result.promptTokens,
                completion_tokens: result.completionTokens,
                latency_ms: Date.now() - started,
                status: "ok",
              });
            }
            return Response.json({ script: result.text });
          }

          // ---------- JSON intents (Bundle 2) ----------
          const jsonIntents = ["daily_plan", "smart_alarm", "commute", "coach_tip"] as const;
          type JsonIntent = (typeof jsonIntents)[number];
          if (jsonIntents.includes(body.intent as JsonIntent)) {
            const profile = userId
              ? await loadAssistantProfile(admin, userId)
              : { name: "RestPilot", mode: "coach" as const, memoryEnabled: false };
            const ctxString = "context" in body ? body.context : undefined;
            const system = await buildSystemPrompt({
              admin,
              userId,
              profile,
              liveContext: ctxString,
            });

            let intentSystem = "";
            let userPayload = "";
            switch (body.intent) {
              case "daily_plan":
                intentSystem = DAILY_PLAN_SYSTEM;
                userPayload = JSON.stringify({ horizon: body.horizon ?? "24h" });
                break;
              case "smart_alarm":
                intentSystem = SMART_ALARM_SYSTEM;
                userPayload = JSON.stringify({
                  targetWakeIso: body.targetWakeIso,
                  windowMin: body.windowMin,
                  nowIso: new Date().toISOString(),
                });
                break;
              case "commute":
                intentSystem = COMMUTE_SYSTEM;
                userPayload = JSON.stringify({
                  shiftStartIso: body.shiftStartIso,
                  travelMin: body.travelMin,
                  prepMin: body.prepMin ?? 25,
                });
                break;
              case "coach_tip":
                intentSystem = COACH_TIP_SYSTEM;
                userPayload = JSON.stringify({ nowIso: new Date().toISOString() });
                break;
            }

            const result = await chatJSON({
              messages: [
                { role: "system", content: `${system}\n\n${intentSystem}` },
                { role: "user", content: userPayload },
              ],
            });
            if (userId) {
              await logAIRequest(admin, {
                user_id: userId,
                intent: body.intent,
                model: DEFAULT_CHAT_MODEL,
                prompt_tokens: result.promptTokens,
                completion_tokens: result.completionTokens,
                latency_ms: Date.now() - started,
                status: "ok",
              });
            }
            // Parse defensively — strip code fences if the model wrapped them.
            const raw = result.text.trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              return jsonError(502, "AI returned malformed JSON");
            }
            return Response.json(parsed);
          }

          return jsonError(400, "Unknown intent");
        } catch (e) {
          const status = e instanceof AIError ? e.status : 500;
          const msg = e instanceof AIError ? e.message : mapUpstreamError(status);
          if (userId) {
            await logAIRequest(admin, {
              user_id: userId,
              intent: (body as { intent?: string }).intent ?? "unknown",
              model: DEFAULT_CHAT_MODEL,
              prompt_tokens: 0,
              completion_tokens: 0,
              latency_ms: Date.now() - started,
              status: "error",
              error: msg,
            });
          }
          return jsonError(status, msg);
        }
      },
    },
  },
});

/**
 * Drain the cloned SSE stream to reconstruct the assistant turn,
 * then trigger memory extraction + usage logging.
 */
async function captureAndExtract(opts: {
  admin: ReturnType<typeof getAdminClient>;
  userId: string;
  userTurn: string;
  memoryEnabled: boolean;
  stream: ReadableStream<Uint8Array>;
  started: number;
}): Promise<void> {
  const reader = opts.stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let assistant = "";
  let usage: { p: number; c: number } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const parsed = JSON.parse(json) as {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) assistant += chunk;
        if (parsed.usage) {
          usage = {
            p: parsed.usage.prompt_tokens ?? 0,
            c: parsed.usage.completion_tokens ?? 0,
          };
        }
      } catch {
        // ignore partial frames
      }
    }
  }

  await logAIRequest(opts.admin, {
    user_id: opts.userId,
    intent: "coach",
    model: DEFAULT_CHAT_MODEL,
    prompt_tokens: usage?.p ?? 0,
    completion_tokens: usage?.c ?? 0,
    latency_ms: Date.now() - opts.started,
    status: "ok",
  });

  if (opts.memoryEnabled && opts.userTurn && assistant) {
    await extractAndStoreMemories({
      admin: opts.admin,
      userId: opts.userId,
      userTurn: opts.userTurn,
      assistantTurn: assistant,
    });
  }
}
