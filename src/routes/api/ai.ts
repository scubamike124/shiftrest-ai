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
  DEFAULT_ASSISTANT_PROFILE,
} from "@/lib/ai/context.server";
import { checkAIBudget, logAIRequest } from "@/lib/ai/log.server";
import { extractAndStoreMemories } from "@/lib/ai/memory-extractor.server";
import { notifyOwnerAsync } from "@/lib/ops/alert.server";
import { persistRecommendation } from "@/lib/ai/recommendations.server";
import { BRIEF_SYSTEM as SHARED_BRIEF_SYSTEM, languageDirective } from "@/lib/ai/prompts.server";
import { buildTimeDirective } from "@/lib/ai/time-directive";
import { classifyIntent } from "@/lib/ai/intent-hint.server";


type Body =
  ({ localTime?: string; timezone?: string } & (
    | { intent: "coach"; messages: ChatMsg[]; context?: string; surface?: "voice" | "text"; expand?: boolean }
    | { intent: "brief"; plan: string }
    | { intent: "daily_plan"; horizon?: "24h" | "72h"; context?: string }
    | { intent: "smart_alarm"; targetWakeIso: string; windowMin: number; context?: string }
    | { intent: "commute"; shiftStartIso: string; travelMin: number; prepMin?: number; context?: string }
    | { intent: "coach_tip"; context?: string }
    | { intent: "right_now"; context?: string }
    | { intent: "adjust_plan"; observation: string; context?: string }
    | { intent: "tomorrow_preview"; context?: string }
    | { intent: "daily_review"; context?: string }
    | { intent: "pattern_alert"; patternKey: string; severity: number; signals: Record<string, unknown>; context?: string }
    | { intent: "jetlag_plan"; tripId?: string; phase?: "pre" | "arrival" | "post"; context?: string }
  ));

// Shared voice contract — every JSON intent inherits this tone so the AI
// sounds like the same trusted coach, not a stack of disconnected widgets.
const COACH_VOICE = `VOICE & TRUST CONTRACT (applies to every field you write):
- Sound like a trusted human coach who genuinely knows this person's life — calm, confident, second person, never robotic.
- Avoid hype, never use exclamation marks, never use emoji unless explicitly allowed in a field.
- Reference the user's real situation when possible ("after last night's short sleep", "with another night shift tonight"). Never invent data you weren't given.
- When you're uncertain, say so plainly ("I'm working with limited wearable data today") instead of pretending confidence.
- Every recommendation must implicitly answer: what changed, why, what happens if they follow it, what happens if they don't.
- TIME-ZONE BASIS: When TZ STATE shows the user's home and current time zones differ, every time you cite a clock time name which clock it's on — say "local time" or use body-clock phrasing ("your body still thinks it's roughly 3 in the morning"). When they match, no qualifier is needed. Never silently mix the two.`;

// Shared impact contract — appended to every JSON intent so each recommendation
// emits the same predicted-impact triple. Stored as predicted_impact_json and
// rendered in the Trust Layer detail sheet.
const IMPACT_CONTRACT = `IMPACT CONTRACT (REQUIRED — every JSON response):
In addition to the schema below, ALWAYS include a top-level field:
"impact": {
  "today":    string (<=110 chars, concrete effect on the rest of today if they follow this),
  "tomorrow": string (<=110 chars, concrete effect on tomorrow's energy/sleep/readiness),
  "week":     string (<=110 chars, concrete effect over the next 5-7 days if they keep doing it)
}
Be specific and grounded — name a number, a window, or a body-clock outcome where possible. No hype, no emoji.`;

const BRIEF_SYSTEM = SHARED_BRIEF_SYSTEM;

const DAILY_PLAN_SYSTEM = `${COACH_VOICE}

You are RestPilot AI's personal sleep & recovery strategist.
Given the user's circadian context, produce a tight JSON action plan for the requested horizon.
Return ONLY valid JSON matching: {"headline": string (<=70 chars, written as the coach speaking to them, e.g. "Tonight's shift needs a longer wind-down"), "riskLevel": "low"|"medium"|"high", "actions": [{"id": string, "title": string (<=60 chars), "detail": string (<=140 chars, explain WHY plus the benefit of doing it), "category": "sleep"|"light"|"caffeine"|"movement"|"recovery"|"nutrition", "priority": 1|2|3, "when": string}]}
Provide 3-5 actions, highest priority first. Be specific with times. No markdown, no commentary.`;

const SMART_ALARM_SYSTEM = `${COACH_VOICE}

You are RestPilot AI's smart alarm engine.
This is ONLY used after the user explicitly enables Smart Adjustment. Given the target wake time (ISO) and a maximum adjustment window (minutes), the user's circadian context, and any wearable signals, choose the optimal wake moment inside the allowed window that is most likely to land near the end of a sleep cycle (~90-min cycles from estimated sleep onset).

CRITICAL: When windowMin > 0 you MUST move the alarm by at least 1 minute away from the target (earlier OR later) — even with weak evidence pick the nearest light-sleep moment within ±windowMin. Returning the exact target time when windowMin > 0 is forbidden.

Hard safety rule: never move the alarm outside ±windowMin from the target. If windowMin is 0, return the exact target wake time.

Return ONLY valid JSON:
{
  "wakeAt": ISO string strictly inside [target - windowMin, target + windowMin],
  "reason": string (<=110 chars, coach voice explaining the move — e.g. "I nudged you 18 minutes later so you wake near the end of a REM cycle instead of mid-deep sleep"),
  "cyclePosition": "rem_end"|"light_sleep"|"deep_avoid"|"natural",
  "confidence": "low"|"medium"|"high",
  "confidenceReason": string (<=120 chars, name the evidence — e.g. "High confidence: 3 nights of Oura data with a consistent sleep-onset window"),
  "message": string (<=80 chars, warm one-liner shown when the alarm fires — e.g. "Morning. You're at the lightest moment of your cycle — easy start.")
}`;

const COMMUTE_SYSTEM = `${COACH_VOICE}

You are RestPilot AI's commute & prep coach.
Given a shift start time (ISO), travel minutes, and optional prep minutes, return ONLY valid JSON:
{"leaveAt": ISO, "prepStartAt": ISO, "advice": string (<=140 chars, concrete pre-shift prep tip written as the coach speaking to them, anchored to their fatigue + light context)}.
leaveAt = shiftStart - travelMin. prepStartAt = leaveAt - (prepMin ?? 25).`;

const COACH_TIP_SYSTEM = `${COACH_VOICE}

You are RestPilot AI's productivity & recovery coach.
Produce ONE short, fresh, contextual tip for the user right now — different from generic advice. Use their circadian + fatigue + schedule context.
Return ONLY valid JSON: {"tip": string (<=160 chars, second person, warm coach voice, max one emoji), "generatedAt": ISO string of now}.`;

const RIGHT_NOW_SYSTEM = `${COACH_VOICE}

You are RestPilot AI's in-the-moment decision engine. The user just opened the app. Answer the four trust questions in every response:
1) What should I do RIGHT NOW (next 15-60 min)?
2) Why? (the circadian/fatigue/wearable reason)
3) What do I gain if I follow it?
4) What does it cost me if I ignore it?

Pick the single highest-leverage action based on their context. Be specific (exact minute, exact action). Sound like a trusted coach, never a chatbot.

Return ONLY valid JSON:
{
  "action": string (<=70 chars, imperative — e.g. "Get 10 min of bright light before 9:30am"),
  "why": string (<=140 chars, the circadian/fatigue reason, references their real signal when possible),
  "followBenefit": string (<=120 chars, concrete upside — e.g. "Locks in tonight's sleep onset and protects 90 min of deep sleep"),
  "ignoreCost": string (<=120 chars, concrete consequence — e.g. "Tonight's sleep onset slides 25 min later and tomorrow's REM drops"),
  "confidence": "low"|"medium"|"high",
  "confidenceReason": string (<=120 chars, what the confidence is based on — e.g. "Medium confidence: no wearable data today, working from your schedule alone"),
  "urgency": "now"|"soon"|"later",
  "timeWindow": { "startIso": ISO string, "endIso": ISO string } (the recommended action window, inside the next 6 hours),
  "ctaLabel": string (<=22 chars, e.g. "See full plan"),
  "ctaRoute": "/plan"|"/events"|"/coach"|"/dashboard"
}`;

const ADJUST_PLAN_SYSTEM = `${COACH_VOICE}

You are RestPilot AI adapting tomorrow's plan in response to a user-confirmed observation. Suggest 2-3 concrete adjustments, written as the coach speaking directly to them.

Return ONLY valid JSON:
{
  "summary": string (<=130 chars, coach voice — e.g. "Your body's asking for more recovery. I've already shifted tomorrow's plan to protect your deep sleep."),
  "confidence": "low"|"medium"|"high",
  "ifIgnored": string (<=120 chars, plain consequence if they don't apply the changes),
  "changes": [{"label": string (<=50 chars), "from": string (<=30 chars), "to": string (<=30 chars), "reason": string (<=110 chars, why this specific change helps)}]
}`;

const TOMORROW_PREVIEW_SYSTEM = `${COACH_VOICE}

You are RestPilot AI building TOMORROW'S PLAN before the user wakes. Treat patterns and last night's recovery as the leading evidence.
Return ONLY valid JSON:
{
  "headline": string (<=80 chars, coach-voice, e.g. "Tomorrow's a recovery day — light morning, early wind-down"),
  "summary": string (<=180 chars, two sentences max),
  "confidence": "low"|"medium"|"high",
  "blocks": [
    {"kind": "sleep"|"alarm"|"light"|"caffeine"|"commute"|"winddown"|"recovery", "title": string (<=50 chars), "when": string (<=30 chars, e.g. "06:40am" or "tonight 9pm"), "detail": string (<=140 chars, why this and what it earns them)}
  ]
}
Provide 4-6 blocks ordered chronologically.`;

const DAILY_REVIEW_SYSTEM = `${COACH_VOICE}

You are RestPilot AI writing TODAY'S RECAP — encouraging, never judgmental.
Return ONLY valid JSON:
{
  "headline": string (<=80 chars, warm, e.g. "Solid recovery day — small win on caffeine timing"),
  "wins": [string (<=110 chars, each)],
  "drains": [string (<=110 chars, each — frame as data not failure)],
  "metrics": {"sleepRecoveredMin": number|null, "readinessDelta": number|null, "recoveryTrend": "up"|"flat"|"down"|"unknown"},
  "tomorrowFocus": string (<=130 chars, one small improvement to try)
}
1-3 items per list. Skip a metric (null) if you don't have the data.`;

const PATTERN_ALERT_SYSTEM = `${COACH_VOICE}

You are RestPilot AI explaining a detected PATTERN to the user in plain language.
You receive {pattern_key, severity, signals}. Return ONLY valid JSON:
{
  "headline": string (<=70 chars, what's happening),
  "why": string (<=140 chars, what the signals show — name at least one number),
  "action": string (<=120 chars, one concrete step today),
  "confidence": "low"|"medium"|"high"
}`;

const JETLAG_PLAN_SYSTEM = `${COACH_VOICE}

You are RestPilot AI's jet-lag strategist. The TZ STATE block above tells you the user's home tz, current tz, body-clock offset, and any active/upcoming trip. The "phase" input narrows the focus:
- "pre"      → before departure: pre-adapt sleep/light/caffeine by 30–60 min/day toward the destination
- "arrival" → first 72h after landing: anchor light and meals to local clock, protect a recovery nap
- "post"     → 4–10 days after return home: re-entrain to home clock without crashing on day 1

Every time you cite a clock time, name which clock — say "destination local time", "home time", or use body-clock phrasing. If the trip crosses the international date line, say so. If the offset is half-hour (e.g. IST, NPT), keep the half-hour in the recommendation. Account for direction (east is harder for most people).

Return ONLY valid JSON:
{
  "headline": string (<=80 chars, coach voice, e.g. "Three days out — start nudging your wind-down 45 min earlier"),
  "summary": string (<=180 chars, two sentences max, names the offset + direction + phase),
  "phase": "pre"|"arrival"|"post",
  "directionEast": boolean,
  "clockBasis": "destination_local"|"home"|"mixed",
  "confidence": "low"|"medium"|"high",
  "blocks": [
    {"day": string (<=20 chars, e.g. "Day −3", "Arrival day", "Day +2"), "kind": "light"|"sleep"|"caffeine"|"meal"|"melatonin"|"movement"|"hydration", "title": string (<=60 chars), "when": string (<=40 chars, INCLUDE clock basis), "detail": string (<=160 chars, why this earns recovery)}
  ],
  "ifIgnored": string (<=140 chars, plain consequence — fragmented sleep, weeklong fog, etc.)
}
Provide 4-7 blocks ordered chronologically across the relevant window.`;


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
          notifyOwnerAsync({
            severity: "critical",
            service: "ai",
            message: "config_missing: admin client init failed",
            meta: { error: msg },
          });
          return jsonError(500, msg);
        }

        const userId = await getUserIdFromAuthHeader(
          admin,
          request.headers.get("authorization"),
        );

        // Require authentication — anonymous callers were previously
        // able to invoke intents that skipped the AI budget gate.
        if (!userId) {
          return jsonError(401, "Sign in required");
        }

        // Budget gate
        const ok = await checkAIBudget(admin, userId);
        if (!ok) {
          return jsonError(
            429,
            "Daily AI limit reached. It resets in 24 hours.",
          );
        }

        try {
          if (body.intent === "coach") {
            if (!Array.isArray(body.messages) || body.messages.length === 0) {
              return jsonError(400, "messages required");
            }

            const profile = userId
              ? await loadAssistantProfile(admin, userId)
              : DEFAULT_ASSISTANT_PROFILE;
            const timeDirective = buildTimeDirective({
              localTime: body.localTime,
              timezone: body.timezone,
            }).directive;

            const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
            const intentHint = classifyIntent(lastUserMsg?.content);

            const system = await buildSystemPrompt({
              admin,
              userId,
              profile,
              liveContext: body.context,
              intent: "coach",
              surface: body.surface ?? "text",
              expand: body.expand ?? false,
              intentHint,
            });
            const systemWithTime = system + timeDirective;

            const trimmed = body.messages.slice(-20);
            const isVoice = (body.surface ?? "text") === "voice";
            const upstream = await chatStream({
              model: DEFAULT_CHAT_MODEL,
              messages: [{ role: "system", content: systemWithTime }, ...trimmed],
              maxTokens: isVoice && !body.expand ? 180 : undefined,
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
            const briefProfile = userId
              ? await loadAssistantProfile(admin, userId)
              : DEFAULT_ASSISTANT_PROFILE;
            const briefSystem =
              languageDirective(briefProfile.language, briefProfile.accent) + BRIEF_SYSTEM + buildTimeDirective({
                localTime: body.localTime,
                timezone: body.timezone,
              }).directive;
            const result = await chatJSON({
              messages: [
                { role: "system", content: briefSystem },
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

          // ---------- JSON intents (Bundle 2 + AI Coach hero) ----------
          const jsonIntents = ["daily_plan", "smart_alarm", "commute", "coach_tip", "right_now", "adjust_plan", "tomorrow_preview", "daily_review", "pattern_alert", "jetlag_plan"] as const;
          type JsonIntent = (typeof jsonIntents)[number];
          if (jsonIntents.includes(body.intent as JsonIntent)) {
            const profile = userId
              ? await loadAssistantProfile(admin, userId)
              : DEFAULT_ASSISTANT_PROFILE;
            const ctxString = "context" in body ? body.context : undefined;
            const system = await buildSystemPrompt({
              admin,
              userId,
              profile,
              liveContext: ctxString,
              intent: body.intent,
            });
            const timeDirective = buildTimeDirective({
              localTime: body.localTime,
              timezone: body.timezone,
            }).directive;

            let intentSystem = "";
            let userPayload = "";
            let patternId: string | null = null;
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
                  maxAdjustmentMin: body.windowMin,
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
              case "right_now":
                intentSystem = RIGHT_NOW_SYSTEM;
                userPayload = JSON.stringify({ nowIso: new Date().toISOString() });
                break;
              case "adjust_plan":
                intentSystem = ADJUST_PLAN_SYSTEM;
                userPayload = JSON.stringify({
                  observation: body.observation,
                  nowIso: new Date().toISOString(),
                });
                break;
              case "tomorrow_preview":
                intentSystem = TOMORROW_PREVIEW_SYSTEM;
                userPayload = JSON.stringify({ nowIso: new Date().toISOString() });
                break;
              case "daily_review":
                intentSystem = DAILY_REVIEW_SYSTEM;
                userPayload = JSON.stringify({ nowIso: new Date().toISOString() });
                break;
              case "pattern_alert": {
                intentSystem = PATTERN_ALERT_SYSTEM;
                userPayload = JSON.stringify({
                  pattern_key: body.patternKey,
                  severity: body.severity,
                  signals: body.signals,
                });
                if (userId) {
                  const { data: pat } = await admin
                    .from("ai_patterns")
                    .select("id")
                    .eq("user_id", userId)
                    .eq("pattern_key", body.patternKey)
                    .maybeSingle();
                  patternId = (pat as { id: string } | null)?.id ?? null;
                }
                break;
              }
              case "jetlag_plan": {
                intentSystem = JETLAG_PLAN_SYSTEM;
                let trip: Record<string, unknown> | null = null;
                if (userId) {
                  // Pick the named trip, else the next planned/active leg.
                  let q = admin
                    .from("trips")
                    .select("id, label, origin_tz, dest_tz, dest_label, depart_utc, arrive_utc, status")
                    .eq("user_id", userId);
                  if (body.tripId) {
                    q = q.eq("id", body.tripId);
                  } else {
                    q = q.in("status", ["planned", "active"]).order("arrive_utc", { ascending: true }).limit(1);
                  }
                  const { data: t } = await q.maybeSingle();
                  trip = (t as Record<string, unknown> | null) ?? null;
                }
                userPayload = JSON.stringify({
                  phase: body.phase ?? "pre",
                  trip,
                  nowIso: new Date().toISOString(),
                });
                break;
              }
            }

            const result = await chatJSON({
              messages: [
                { role: "system", content: `${system}${timeDirective}\n\n${intentSystem}\n\n${IMPACT_CONTRACT}` },
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
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              return jsonError(502, "AI returned malformed JSON");
            }

            // Smart-alarm safety net: if the model returned the exact target
            // time (or an out-of-window time) when windowMin > 0, snap to the
            // nearest 90-min cycle boundary clamped to ±windowMin so Smart
            // Adjustment is never a silent no-op.
            if (body.intent === "smart_alarm" && body.windowMin > 0) {
              const targetMs = Date.parse(body.targetWakeIso);
              const wakeMs = Date.parse(String(parsed.wakeAt ?? ""));
              const windowMs = body.windowMin * 60_000;
              const cycleMs = 90 * 60_000;
              // Fire whenever the model failed to meaningfully move the alarm
              // (out of window, or within 60s of target). The previous check
              // only caught wakeMs === targetMs, so models that echoed the
              // target offset by a few seconds slipped through unmodified.
              const driftMs = Number.isFinite(wakeMs) ? Math.abs(wakeMs - targetMs) : Infinity;
              if (!Number.isFinite(wakeMs) || driftMs > windowMs || driftMs < 60_000) {
                // Cap the magnitude by the smaller of the user window or a
                // quarter-cycle so ±5 picks ±5 but ±30 picks ±22.5.
                const offsetCap = Math.min(windowMs, cycleMs * 0.25);
                const magnitude = Math.max(60_000, offsetCap);
                // Pick a direction with an actual signal instead of always
                // biasing earlier. Priority:
                //   1. If the model returned a wake time within the window
                //      but too close to target, honor the sign it chose.
                //   2. Otherwise alternate deterministically per calendar day
                //      of the target (hash) so it isn't perpetually earlier.
                let sign = 0;
                if (Number.isFinite(wakeMs) && driftMs <= windowMs) {
                  sign = wakeMs >= targetMs ? 1 : -1;
                }
                if (sign === 0) {
                  const d = new Date(targetMs);
                  const dayKey = d.getUTCFullYear() * 372 + (d.getUTCMonth() + 1) * 31 + d.getUTCDate();
                  sign = dayKey % 2 === 0 ? 1 : -1;
                }
                const pick = targetMs + sign * magnitude;
                parsed.wakeAt = new Date(pick).toISOString();
                const deltaMin = Math.round((pick - targetMs) / 60_000);
                parsed.reason = `Adjusted ${Math.abs(deltaMin)} min ${deltaMin > 0 ? "later" : "earlier"} to land closer to a light-sleep boundary in your cycle.`;
                if (!parsed.cyclePosition) parsed.cyclePosition = "light_sleep";
                if (!parsed.confidence) parsed.confidence = "low";
                if (!parsed.confidenceReason) parsed.confidenceReason = "Low confidence: using a 90-min cycle estimate (no recent wearable data).";
                if (!parsed.message) parsed.message = "Good morning. Easing you out of a light moment in your cycle.";
              }
            }


            // Persist as ai_recommendations so feedback can target it.
            let recommendationId: string | null = null;
            if (userId) {
              recommendationId = await persistRecommendation(admin, {
                userId,
                intent: body.intent,
                payload: parsed,
                patternId,
              });
            }
            return Response.json({ ...parsed, recommendationId });
          }


          return jsonError(400, "Unknown intent");
        } catch (e) {
          const status = e instanceof AIError ? e.status : 500;
          const msg = e instanceof AIError ? e.message : mapUpstreamError(status);
          // Alert owner ONLY on genuine infra failures — never on user
          // validation (400) or auth (401/403) errors surfaced upstream.
          const intent = (body as { intent?: string }).intent ?? "unknown";
          if (status >= 500) {
            notifyOwnerAsync({
              severity: "error",
              service: "ai",
              message: "upstream_5xx",
              meta: { status, intent, error: msg },
            });
          } else if (status === 402) {
            notifyOwnerAsync({
              severity: "critical",
              service: "ai",
              message: "credits_exhausted",
              meta: { intent },
            });
          } else if (status === 429) {
            notifyOwnerAsync({
              severity: "warning",
              service: "ai",
              message: "rate_limited",
              meta: { intent },
            });
          } else if (status === 401 || status === 403) {
            // Upstream auth against Lovable AI gateway — our key rotated/revoked.
            notifyOwnerAsync({
              severity: "critical",
              service: "ai",
              message: "upstream_auth_failed",
              meta: { status, intent },
            });
          }
          if (userId) {
            await logAIRequest(admin, {
              user_id: userId,
              intent,
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
