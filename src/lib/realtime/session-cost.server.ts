/**
 * Live voice (OpenAI Realtime) cost control. SERVER ONLY.
 *
 * The browser talks to OpenAI directly with an ephemeral token, so the server
 * cannot meter the session itself. The strongest cap available without a proxy:
 *  (1) debit the WORST-CASE dollar cost of one session (see voice-pricing.ts)
 *      against the daily token cap at mint, atomically, refusing when the
 *      remaining budget cannot cover it and when another session is active;
 *  (2) short-lived token, capped context and per-response output;
 *  (3) client heartbeat/finish reports that refund part of the unused debit or
 *      charge overage, bound to the minted session id and idempotent;
 *  (4) the client hangs up at the server-given deadline.
 * Writes go through service-role-only RPCs (claim_voice_session,
 * end_voice_session, charge_voice_overage) that serialise per user. Every
 * failure on the debit path REFUSES the mint; a failed refund grants nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TOKENS_PER_MINUTE,
  VOICE_LIMITS,
  WORST_CASE_DEBIT_TOKENS,
} from "@/lib/realtime/voice-pricing";

export const REALTIME_COST = {
  MAX_SESSION_SECONDS: VOICE_LIMITS.MAX_SESSION_SECONDS,
  /** Slack before a session counts as over and overage starts. */
  GRACE_SECONDS: 30,
  TOKEN_TTL_SECONDS: VOICE_LIMITS.TOKEN_TTL_SECONDS,
  POST_INSTRUCTIONS_TOKENS: VOICE_LIMITS.POST_INSTRUCTIONS_TOKENS,
  MAX_OUTPUT_TOKENS: VOICE_LIMITS.MAX_OUTPUT_TOKENS,
  TOKENS_PER_MINUTE,
  /**
   * Share of the unused debit returned on a clean finish. Below 1 on purpose:
   * the finish call is client-controlled, so a hostile client could "finish"
   * at once and keep talking; the kept share is never refunded.
   */
  REFUND_FRACTION: 0.5,
  /** Overage charged per started step past deadline + grace. */
  OVERAGE_STEP_SECONDS: 30,
} as const;

export const worstCaseTokens = () => WORST_CASE_DEBIT_TOKENS;
export const tokensForSeconds = (seconds: number) =>
  Math.ceil(Math.max(0, seconds) / 60) * TOKENS_PER_MINUTE;

const WINDOW_SECONDS = REALTIME_COST.MAX_SESSION_SECONDS + REALTIME_COST.GRACE_SECONDS;
const RPC_TIMEOUT_MS = 4000;

function newSessionId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** RPC with a timeout; any error/throw/hang => null (caller fails closed). */
async function rpc<T>(
  admin: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${fn} timeout`)), RPC_TIMEOUT_MS);
    });
    const { data, error } = await Promise.race([Promise.resolve(admin.rpc(fn, args)), timeout]);
    if (error) {
      console.error(`[realtime] ${fn} failed`, error);
      return null;
    }
    return (data ?? null) as T | null;
  } catch (e) {
    console.error(`[realtime] ${fn} threw`, e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type StartResult =
  | { ok: true; sessionId: string; deadlineAt: number; maxSessionSeconds: number; debit: number }
  | {
      ok: false;
      code:
        | "voice_disabled"
        | "voice_session_active"
        | "ai_budget_exhausted"
        | "ai_budget_unavailable";
      message: string;
    };

/** Atomic claim: one active session AND worst-case debit fits under the cap. */
export async function startRealtimeSession(
  admin: SupabaseClient,
  userId: string,
  now: number = Date.now(),
): Promise<StartResult> {
  // Defence in depth: the kill switch also guards the debit itself.
  if (process.env.REALTIME_VOICE_ENABLED !== "1") {
    return {
      ok: false,
      code: "voice_disabled",
      message: "Voice is temporarily unavailable.",
    };
  }
  const sid = newSessionId();
  const debit = WORST_CASE_DEBIT_TOKENS;
  const verdict = await rpc<string>(admin, "claim_voice_session", {
    _user_id: userId,
    _sid: sid,
    _debit: debit,
    _window_seconds: WINDOW_SECONDS,
  });
  if (verdict === "ok") {
    return {
      ok: true,
      sessionId: sid,
      deadlineAt: now + REALTIME_COST.MAX_SESSION_SECONDS * 1000,
      maxSessionSeconds: REALTIME_COST.MAX_SESSION_SECONDS,
      debit,
    };
  }
  if (verdict === "active") {
    return {
      ok: false,
      code: "voice_session_active",
      message: "A voice session is already active. End it before starting another.",
    };
  }
  if (verdict === "exhausted") {
    return {
      ok: false,
      code: "ai_budget_exhausted",
      // Rolling 24-hour window (has_ai_budget): no fixed reset time to promise.
      message:
        "Not enough AI allowance left for a voice session. It frees up as your earlier use passes the 24-hour mark.",
    };
  }
  // null (RPC error/timeout) or anything unexpected: fail closed.
  return {
    ok: false,
    code: "ai_budget_unavailable",
    message: "Voice is temporarily unavailable. Please try again in a moment.",
  };
}

/** The provider mint failed after the debit: return everything (no extra, no less). */
export async function abortRealtimeSession(
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
  debit: number,
): Promise<void> {
  await rpc<number>(admin, "end_voice_session", {
    _user_id: userId,
    _sid: sessionId,
    _delta: -Math.abs(Math.round(debit)),
    _status: "aborted",
  });
}

export type ReportResult = {
  /** Client must end the call now. */
  endNow: boolean;
  deadlineAt: number | null;
  refunded: number;
  overage: number;
};

type LedgerRow = { intent: string; prompt_tokens: number; created_at: string };

async function ledger(
  admin: SupabaseClient,
  userId: string,
  sid: string,
): Promise<LedgerRow[] | null> {
  try {
    const { data, error } = await admin
      .from("ai_log")
      .select("intent,prompt_tokens,created_at")
      .eq("user_id", userId)
      .like("intent", `rt-%:${sid}%`);
    if (error || !Array.isArray(data)) return null;
    return data as LedgerRow[];
  } catch {
    return null;
  }
}

/**
 * Heartbeat (final=false) or finish (final=true). The session id must belong to
 * the caller (the ledger is read per user and the RPCs re-check it). The server
 * clock bounds elapsed time: the client figure only counts when larger.
 */
export async function reportRealtimeSession(
  admin: SupabaseClient,
  userId: string,
  input: { sessionId: string; elapsedSeconds: number; final: boolean },
  now: number = Date.now(),
): Promise<ReportResult> {
  const none: ReportResult = { endNow: false, deadlineAt: null, refunded: 0, overage: 0 };
  const rows = await ledger(admin, userId, input.sessionId);
  if (!rows) return none;
  const mint = rows.find((r) => r.intent === `rt-mint:${input.sessionId}`);
  if (!mint) return { ...none, endNow: true };
  if (rows.some((r) => r.intent === `rt-end:${input.sessionId}`)) return { ...none, endNow: true };

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
    const bucket = Math.floor((now - deadlineAt) / (REALTIME_COST.OVERAGE_STEP_SECONDS * 1000));
    const charged = await rpc<boolean>(admin, "charge_voice_overage", {
      _user_id: userId,
      _sid: input.sessionId,
      _bucket: bucket,
      _tokens: step,
    });
    return { endNow: true, deadlineAt, refunded: 0, overage: charged === true ? step : 0 };
  }

  const actual = tokensForSeconds(elapsed);
  const delta =
    actual >= debit
      ? actual - debit
      : -Math.floor((debit - actual) * REALTIME_COST.REFUND_FRACTION);
  const applied = await rpc<number>(admin, "end_voice_session", {
    _user_id: userId,
    _sid: input.sessionId,
    _delta: delta,
    _status: delta > 0 ? "overage" : "ok",
  });
  if (applied === null) return { endNow: true, deadlineAt, refunded: 0, overage: 0 };
  return {
    endNow: true,
    deadlineAt,
    refunded: applied < 0 ? -applied : 0,
    overage: applied > 0 ? applied : 0,
  };
}
