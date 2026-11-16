// Why an AI request was refused, as a stable machine-readable `code`.
//
// Shared by the server (which sets the code) and the client (which chooses
// what to tell the user from the code, never from the HTTP status). Nothing in
// this file touches the network, the database or the DOM.
//
// Three unrelated things used to reach the browser as a bare HTTP 429 and were
// all shown as "You've reached today's AI limit" with an upgrade prompt:
//   - the user's own usage allowance (has_ai_budget)        -> daily_limit
//   - the per-user request rate limiter (20 requests/min)   -> rate_limited
//   - the AI provider's rate limit, credits or an outage    -> ai_provider_*
// Only the first one is the user's allowance, and only the first one may ever
// carry an upgrade prompt (never inside the native app, Guideline 3.1.1).

export const AI_REFUSAL = {
  /** The user's own allowance over the rolling window is used up. HTTP 429. */
  DAILY_LIMIT: "daily_limit",
  /** Too many requests in a minute from this user. HTTP 429 + retry_after_seconds. */
  RATE_LIMITED: "rate_limited",
  /** The AI provider rate-limited RestPilot. Not the user's limit. HTTP 503. */
  PROVIDER_BUSY: "ai_provider_busy",
  /** Provider credits, auth, outage or network failure. Not the user's limit. HTTP 503. */
  PROVIDER_UNAVAILABLE: "ai_provider_unavailable",
  /** The provider rejected this request (other 4xx). Not the user's limit. HTTP 502. */
  PROVIDER_ERROR: "ai_provider_error",
  /** The allowance could not be checked (fail closed). Retryable. HTTP 503. */
  BUDGET_UNAVAILABLE: "ai_budget_unavailable",
} as const;

export type AIRefusalCode = (typeof AI_REFUSAL)[keyof typeof AI_REFUSAL];

/**
 * The allowance is summed over a ROLLING window (has_ai_budget: ai_log rows
 * newer than now() - 24 hours). It does not reset at midnight: each piece of
 * usage stops counting 24 hours after it happened.
 */
export const AI_USAGE_WINDOW_HOURS = 24;

export const DAILY_LIMIT_MESSAGE =
  "You've used your AI allowance for the last 24 hours. It doesn't reset at midnight: it frees up as your earlier use passes the 24-hour mark.";
export const RATE_LIMITED_MESSAGE = "Too many requests. Try again in a moment.";
export const PROVIDER_BUSY_MESSAGE =
  "The AI service is busy right now. This is not your limit. Please try again in a moment.";
export const PROVIDER_UNAVAILABLE_MESSAGE =
  "The AI service is temporarily unavailable. This is not your limit. Please try again shortly.";
export const PROVIDER_ERROR_MESSAGE =
  "The AI service couldn't handle that request. This is not your limit.";

/** JSON body of the allowance refusal (HTTP 429). */
export function dailyLimitBody() {
  return {
    error: DAILY_LIMIT_MESSAGE,
    code: AI_REFUSAL.DAILY_LIMIT,
    window_hours: AI_USAGE_WINDOW_HOURS,
  };
}

export type ProviderFailure = {
  status: 502 | 503;
  code: AIRefusalCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
};

/**
 * What the browser is told when the AI provider (or the gateway in front of
 * it) fails. `upstreamStatus` is the provider's HTTP status, or null for a
 * network error / anything that is not a provider response. The provider's own
 * 429 / 402 / 401 / 403 / 5xx are never passed through: a 429 from here would
 * be read as the user's limit and a 401 as the user's session.
 */
export function providerFailure(upstreamStatus: number | null): ProviderFailure {
  if (upstreamStatus === 429) {
    return {
      status: 503,
      code: AI_REFUSAL.PROVIDER_BUSY,
      message: PROVIDER_BUSY_MESSAGE,
      retryable: true,
      retryAfterSeconds: 10,
    };
  }
  const rejected =
    upstreamStatus !== null &&
    upstreamStatus >= 400 &&
    upstreamStatus < 500 &&
    upstreamStatus !== 401 &&
    upstreamStatus !== 402 &&
    upstreamStatus !== 403 &&
    upstreamStatus !== 408;
  if (rejected) {
    return {
      status: 502,
      code: AI_REFUSAL.PROVIDER_ERROR,
      message: PROVIDER_ERROR_MESSAGE,
      retryable: false,
      retryAfterSeconds: null,
    };
  }
  return {
    status: 503,
    code: AI_REFUSAL.PROVIDER_UNAVAILABLE,
    message: PROVIDER_UNAVAILABLE_MESSAGE,
    retryable: true,
    retryAfterSeconds: 30,
  };
}

/** The Response for a provider failure. See providerFailure(). */
export function providerFailureResponse(upstreamStatus: number | null): Response {
  const f = providerFailure(upstreamStatus);
  return new Response(JSON.stringify({ error: f.message, code: f.code, retryable: f.retryable }), {
    status: f.status,
    headers: {
      "Content-Type": "application/json",
      ...(f.retryAfterSeconds ? { "Retry-After": String(f.retryAfterSeconds) } : {}),
    },
  });
}

// ---------------------------------------------------------------- client side

export type AIRefusalKind =
  | "daily_limit"
  | "rate_limited"
  | "provider_busy"
  | "provider_unavailable"
  | "request_rejected"
  | "other";

export type AIRefusal = {
  kind: AIRefusalKind;
  /** The server's code, when it sent one. */
  code: string | null;
  /** Short line for a toast. */
  title: string;
  /** Optional second line for a toast. */
  description: string | null;
  /** Full sentence(s) for an in-conversation assistant message. */
  chatMessage: string;
  /** Seconds to wait (rate limit / provider busy), when known. */
  retryAfterSeconds: number | null;
  /**
   * True ONLY for the user's own allowance, and never inside the native app
   * (App Store Guideline 3.1.1). No other refusal may show an upgrade prompt.
   */
  offerUpgrade: boolean;
  /** The server's own error text, for refusals this helper has no copy for. */
  serverMessage: string | null;
};

const SAVED = "I saved what you said here";

function seconds(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(3600, Math.ceil(n)) : null;
}

const plural = (n: number) => `${n} second${n === 1 ? "" : "s"}`;

/**
 * Turn a refused AI response into what the user should be told. The choice is
 * made by `code`. The HTTP status is only a fallback for responses without a
 * code, and a bare 429 is then NOT assumed to be the user's allowance: it gets
 * neutral "busy, try again" copy and no upgrade prompt.
 */
export function describeAIRefusal(
  status: number,
  body: unknown,
  opts: { native: boolean; retryAfterHeader?: string | null },
): AIRefusal {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const code = typeof b.code === "string" ? b.code : null;
  const rawError = typeof b.error === "string" ? b.error : null;
  const rawMessage = typeof b.message === "string" ? b.message : null;
  const retryAfterSeconds = seconds(b.retry_after_seconds) ?? seconds(opts.retryAfterHeader);

  let kind: AIRefusalKind = "other";
  if (code === AI_REFUSAL.DAILY_LIMIT) kind = "daily_limit";
  else if (code === AI_REFUSAL.RATE_LIMITED) kind = "rate_limited";
  else if (code === AI_REFUSAL.PROVIDER_BUSY) kind = "provider_busy";
  else if (code === AI_REFUSAL.PROVIDER_ERROR) kind = "request_rejected";
  else if (code === AI_REFUSAL.PROVIDER_UNAVAILABLE || code === AI_REFUSAL.BUDGET_UNAVAILABLE)
    kind = "provider_unavailable";
  else if (code === null) {
    // Responses from before codes existed (an older server during a rollout).
    if (rawError === "rate_limited") kind = "rate_limited";
    else if (status === 429 && /daily ai limit/i.test(rawError ?? "")) kind = "daily_limit";
    else if (status === 429) kind = "provider_busy";
    else if (status === 402 || status === 503 || status === 504) kind = "provider_unavailable";
  }

  const base = { code, retryAfterSeconds, serverMessage: rawMessage ?? rawError };

  switch (kind) {
    case "daily_limit": {
      const offerUpgrade = !opts.native;
      return {
        ...base,
        kind,
        retryAfterSeconds: null,
        title: "You've used your AI allowance for now.",
        description: offerUpgrade
          ? "It frees up over the next 24 hours. Upgrade for a higher limit."
          : "It frees up over the next 24 hours.",
        chatMessage:
          `You've used your AI allowance for the last 24 hours. It doesn't reset at midnight: it frees up as your earlier use passes the 24-hour mark. ${SAVED}, and you can keep typing` +
          (offerUpgrade ? " or upgrade for a higher limit." : "."),
        offerUpgrade,
      };
    }
    case "rate_limited": {
      const wait = retryAfterSeconds
        ? `Wait ${plural(retryAfterSeconds)} and try again.`
        : "Wait a moment and try again.";
      return {
        ...base,
        kind,
        title: "You're sending messages too quickly.",
        description: wait,
        chatMessage: `That was a lot of requests in a short time. ${wait} This is a short pause, not your AI allowance. ${SAVED}.`,
        offerUpgrade: false,
      };
    }
    case "provider_busy":
      return {
        ...base,
        kind,
        title: "The AI service is busy right now.",
        description: "This isn't your limit. Try again in a moment.",
        chatMessage: `The AI service is busy right now. This isn't your limit. ${SAVED}: try again in a moment.`,
        offerUpgrade: false,
      };
    case "provider_unavailable":
      return {
        ...base,
        kind,
        title: "The AI service is temporarily unavailable.",
        description: "This isn't your limit. Try again shortly.",
        chatMessage: `The AI service is temporarily unavailable. This isn't your limit. ${SAVED}: try again shortly.`,
        offerUpgrade: false,
      };
    case "request_rejected":
      return {
        ...base,
        kind,
        retryAfterSeconds: null,
        title: "The AI service couldn't handle that request.",
        description: "This isn't your limit. Try rephrasing or shortening it.",
        chatMessage: `The AI service couldn't handle that request. This isn't your limit. ${SAVED}: try rephrasing or shortening it.`,
        offerUpgrade: false,
      };
    default:
      return {
        ...base,
        kind,
        title: base.serverMessage ?? "",
        description: null,
        chatMessage: "",
        offerUpgrade: false,
      };
  }
}
