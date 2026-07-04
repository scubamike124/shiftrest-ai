// Per-user server-side rate limiting for AI/TTS/STT endpoints.
//
// Backed by the `rate_limit_counter` Postgres table + `rate_limit_hit` RPC
// (see migration). Fixed-window counter, resolution `windowSec`. Uses the
// Supabase service role so the counter is authoritative and cannot be
// bypassed by the client.
//
// Failure mode: any DB/config error is logged but NEVER blocks the request.
// This limiter is a safety net on top of `has_ai_budget`, not a hard gate —
// if the counter itself fails we prefer to serve the user.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;
function admin(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export interface RateLimitOptions {
  /** Bucket namespace, e.g. "ai", "tts", "stt". */
  bucket: string;
  /** Max requests allowed inside the window. */
  limit: number;
  /** Window size in seconds. */
  windowSec: number;
}

/**
 * Check + increment. If the caller has exceeded `limit` within `windowSec`,
 * returns a 429 Response the caller MUST return immediately. Otherwise
 * returns null and the request proceeds.
 *
 * `identifier` should be the authenticated user id; for anonymous endpoints
 * pass the client IP or a similar stable per-caller key.
 */
export async function enforceRateLimit(
  identifier: string,
  opts: RateLimitOptions,
): Promise<Response | null> {
  const supa = admin();
  if (!supa) return null; // fail-open on config gap

  const now = Date.now();
  const windowMs = opts.windowSec * 1000;
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const windowStartIso = new Date(windowStartMs).toISOString();
  const bucketKey = `${opts.bucket}:${identifier}`;

  let count: number;
  try {
    const { data, error } = await supa.rpc("rate_limit_hit", {
      _bucket_key: bucketKey,
      _window_start: windowStartIso,
      _increment: 1,
    });
    if (error) {
      console.warn("[ratelimit] rpc error", opts.bucket, error.message);
      return null;
    }
    count = typeof data === "number" ? data : Number(data);
  } catch (e) {
    console.warn("[ratelimit] rpc threw", opts.bucket, e);
    return null;
  }

  if (!Number.isFinite(count) || count <= opts.limit) return null;

  const resetInSec = Math.max(1, Math.ceil((windowStartMs + windowMs - now) / 1000));
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      message: "Too many requests. Try again in a moment.",
      retry_after_seconds: resetInSec,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(resetInSec),
        "X-RateLimit-Limit": String(opts.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.floor((windowStartMs + windowMs) / 1000)),
      },
    },
  );
}

/** Default limits keyed by endpoint family. Tuned to be generous for normal
 *  interactive use (a few requests per action, bursty typing) while stopping
 *  runaway automation that would burn the AI gateway budget. */
export const RATE_LIMITS = {
  ai: { bucket: "ai", limit: 20, windowSec: 60 } as const,
  tts: { bucket: "tts", limit: 30, windowSec: 60 } as const,
  stt: { bucket: "stt", limit: 30, windowSec: 60 } as const,
} satisfies Record<string, RateLimitOptions>;
