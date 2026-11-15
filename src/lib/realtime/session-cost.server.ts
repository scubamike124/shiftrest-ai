/**
 * Live voice (OpenAI Realtime) cost control. SERVER ONLY.
 *
 * The browser talks to OpenAI directly with an ephemeral token, so the server
 * cannot meter the session itself. The strongest cap available without a proxy
 * is therefore: (1) debit the WORST-CASE cost of one session against the daily
 * token cap at mint, refusing the mint when the remaining budget cannot cover
 * it; (2) short-lived tokens and per-response limits; (3) one active session
 * per user; (4) a client heartbeat/finish report that refunds part of the
 * unused debit or charges overage; (5) the client ends the call at the
 * server-given deadline.
 *
 * Everything is stored in ai_log (service-role writes only; the daily cap sums
 * its total_tokens), so no new table or RPC is needed:
 *   intent "rt-mint:<sid>"  prompt_tokens = +worst-case debit
 *   intent "rt-end:<sid>"   prompt_tokens = -refund (or +overage), written once
 *   intent "rt-over:<sid>"  prompt_tokens = +overage step per late heartbeat
 *
 * COST MODEL (all constants here, tune together):
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkAIBudget, logAIRequest } from "@/lib/ai/log.server";

export const REALTIME_COST = {
  /** Longest session the client is told it may run. It must end the call here. */
  MAX_SESSION_SECONDS: 300,
  /** Server-side slack before a session is considered over / overage starts. */
  GRACE_SECONDS: 30,
  /** Ephemeral token lifetime. It only has to survive the SDP handshake. */
  TOKEN_TTL_SECONDS: 60,
  /**
   * Token-equivalents per minute of live audio. Full duplex worst case:
   * input audio ~10 tokens/s (600/min) + output audio ~20 tokens/s (1200/min)
   * = 1800/min, rounded up to 2000. This is an estimate, not an invoice.
   */
  TOKENS_PER_MINUTE: 2000,
  /** Share of the unused debit returned on a clean finish (see residuals). */
  REFUND_FRACTION: 0.5,
  /** Per-response output token ceiling set on the session. */
  MAX_OUTPUT_TOKENS: 1000,
  /** Overage charged per heartbeat received after the deadline + grace. */
  OVERAGE_STEP_SECONDS: 30,
} as const;

export const worstCaseTokens = () =>
  Math.ceil(REALTIME_COST.MAX_SESSION_SECONDS / 60) * REALTIME_COST.TOKENS_PER_MINUTE;
export const tokensForSeconds = (seconds: number) =>
  Math.ceil(Math.max(0, seconds) / 60) * REALTIME_COST.TOKENS_PER_MINUTE;

const WINDOW_MS = (REALTIME_COST.MAX_SESSION_SECONDS + REALTIME_COST.GRACE_SECONDS) * 1000;
const MODEL = "gpt-realtime";

function newSessionId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function row(
  admin: SupabaseClient,
  userId: string,
  intent: string,
  tokens: number,
  status = "ok",
) {
  await logAIRequest(admin, {
    user_id: userId,
    intent,
    model: MODEL,
    prompt_tokens: Math.round(tokens),
    completion_tokens: 0,
    latency_ms: 0,
    status,
  });
}

type LogRow = { intent: string; prompt_tokens: number; created_at: string };

async function recentSessionRows(
  admin: SupabaseClient,
  userId: string,
  now: number,
): Promise<LogRow[] | null> {
  try {
    const since = new Date(now - 2 * WINDOW_MS).toISOString();
    const { data, error } = await admin
      .from("ai_log")
      .select("intent,prompt_tokens,created_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .like("intent", "rt-%");
    if (error || !Array.isArray(data)) return null;
    return data as LogRow[];
  } catch {
    return null;
  }
}

/** Sessions minted within the window that have not been finished. */
function activeSessions(rows: LogRow[], now: number) {
  const ended = new Set(
    rows.filter((r) => r.intent.startsWith("rt-end:")).map((r) => r.intent.slice(7)),
  );
  return rows
    .filter((r) => r.intent.startsWith("rt-mint:"))
    .map((r) => ({ sid: r.intent.slice(8), at: Date.parse(r.created_at), debit: r.prompt_tokens }))
    .filter((s) => !ended.has(s.sid) && now - s.at < WINDOW_MS);
}

export type StartResult =
  | { ok: true; sessionId: string; deadlineAt: number; maxSessionSeconds: number; debit: number }
  | { ok: false; code: "voice_session_active" | "ai_budget_exhausted" | "ai_budget_unavailable"; message: string };

/**
 * Debit the worst case, then ask the existing has_ai_budget gate whether the
 * user is still under the cap WITH the debit counted (used < cap), so a mint is
 * refused exactly when the remaining budget cannot cover the worst case.
 */
export async function startRealtimeSession(
  admin: SupabaseClient,
  userId: string,
  now: number = Date.now(),
): Promise<StartResult> {
  const unavailable: StartResult = {
    ok: false,
    code: "ai_budget_unavailable",
    message: "Voice is temporarily unavailable. Please try again in a moment.",
  };
  const before = await recentSessionRows(admin, userId, now);
  if (!before) return unavailable;
  if (activeSessions(before, now).length > 0) {
    return {
      ok: false,
      code: "voice_session_active",
      message: "A voice session is already active. End it before starting another.",
    };
  }

  const sid = newSessionId();
  const debit = worstCaseTokens();
  await row(admin, userId, `rt-mint:${sid}`, debit);

  const undo = async () => {
    await row(admin, userId, `rt-end:${sid}`, -debit, "refused");
  };

  const budget = await checkAIBudget(admin, userId);
  if (budget !== "ok") {
    await undo();
    return budget === "exhausted"
      ? {
          ok: false,
          code: "ai_budget_exhausted",
          message: "Not enough daily AI allowance left for a voice session. It resets in 24 hours.",
        }
      : unavailable;
  }

  // Race guard: two mints at once both see "none active". Re-check after our
  // debit and back off if another session (not ours) is live. Both back off if
  // both raced; failing safe is intended.
  const after = await recentSessionRows(admin, userId, now);
  if (!after || activeSessions(after, now).some((s) => s.sid !== sid)) {
    await undo();
    return after
      ? {
          ok: false,
          code: "voice_session_active",
          message: "A voice session is already active. End it before starting another.",
        }
      : unavailable;
  }

  return {
    ok: true,
    sessionId: sid,
    deadlineAt: now + REALTIME_COST.MAX_SESSION_SECONDS * 1000,
    maxSessionSeconds: REALTIME_COST.MAX_SESSION_SECONDS,
    debit,
  };
}

/** The provider mint failed after the debit: return everything. */
export async function abortRealtimeSession(
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
  debit: number,
): Promise<void> {
  try {
    await row(admin, userId, `rt-end:${sessionId}`, -debit, "aborted");
  } catch (e) {
    console.error("[realtime] abort refund failed", e);
  }
}

export type ReportResult = {
  /** Client must end the call now. */
  endNow: boolean;
  deadlineAt: number | null;
  refunded: number;
  overage: number;
};

/**
 * Heartbeat (final=false) or finish (final=true) from the client.
 * - heartbeat after deadline+grace: charge an overage step and tell it to end;
 * - finish: write the single rt-end row: refund REFUND_FRACTION of the unused
 *   debit, or charge overage when the session ran past the worst case.
 * The server's own clock bounds the elapsed time; the client figure is only
 * used when it is larger (it can never reduce the charge below server time).
 */
export async function reportRealtimeSession(
  admin: SupabaseClient,
  userId: string,
  input: { sessionId: string; elapsedSeconds: number; final: boolean },
  now: number = Date.now(),
): Promise<ReportResult> {
  const none: ReportResult = { endNow: false, deadlineAt: null, refunded: 0, overage: 0 };
  const rows = await recentSessionRows(admin, userId, now);
  if (!rows) return none;
  const mint = rows.find((r) => r.intent === `rt-mint:${input.sessionId}`);
  if (!mint) return { ...none, endNow: true };
  if (rows.some((r) => r.intent === `rt-end:${input.sessionId}`)) {
    return { ...none, endNow: true };
  }
  const mintedAt = Date.parse(mint.created_at);
  const deadlineAt = mintedAt + REALTIME_COST.MAX_SESSION_SECONDS * 1000;
  const serverElapsed = Math.max(0, (now - mintedAt) / 1000);
  const clientElapsed = Math.max(0, Math.min(86_400, Number(input.elapsedSeconds) || 0));
  const elapsed = Math.max(serverElapsed, clientElapsed);
  const debit = mint.prompt_tokens;
  const late = now > deadlineAt + REALTIME_COST.GRACE_SECONDS * 1000;

  if (!input.final) {
    if (!late) return { ...none, deadlineAt };
    const step = tokensForSeconds(REALTIME_COST.OVERAGE_STEP_SECONDS);
    await row(admin, userId, `rt-over:${input.sessionId}`, step, "overage");
    return { endNow: true, deadlineAt, refunded: 0, overage: step };
  }

  const actual = tokensForSeconds(elapsed);
  if (actual >= debit) {
    const overage = actual - debit;
    await row(admin, userId, `rt-end:${input.sessionId}`, overage, overage ? "overage" : "ok");
    return { endNow: true, deadlineAt, refunded: 0, overage };
  }
  const refund = Math.floor((debit - actual) * REALTIME_COST.REFUND_FRACTION);
  await row(admin, userId, `rt-end:${input.sessionId}`, -refund, "ok");
  return { endNow: true, deadlineAt, refunded: refund, overage: 0 };
}
