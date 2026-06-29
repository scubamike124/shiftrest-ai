// Hardened replacement for the auto-generated auth-attacher.
// Why: on iPhone Safari (and any cold-start), the Supabase JS client may not
// have hydrated the session from localStorage by the time the first protected
// serverFn fires. The stock attacher calls getSession() once and attaches
// nothing on miss → server throws "Unauthorized: No authorization header
// provided" and the Companion brief surfaces a hard error.
//
// This version:
//   1. Tries getSession() first.
//   2. If empty, waits up to ~600ms for INITIAL_SESSION / SIGNED_IN.
//   3. Falls back to refreshSession() (uses the refresh token in storage).
//   4. Emits `companion:auth-status` for the Debug HUD. Never logs the token.
//   5. Always returns next(...) — surfacing 401 cleanly instead of throwing
//      in the client middleware chain.

import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

type AuthStatusDetail = {
  hasSession: boolean;
  hasToken: boolean;
  userId: string | null;
  source: "session" | "wait" | "refresh" | "none";
};

function emitStatus(detail: AuthStatusDetail) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent<AuthStatusDetail>("companion:auth-status", { detail }),
    );
  } catch {
    /* noop */
  }
}

async function waitForSession(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (token: string | null) => {
      if (done) return;
      done = true;
      try { sub.subscription.unsubscribe(); } catch { /* noop */ }
      window.clearTimeout(timer);
      resolve(token);
    };
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.access_token ?? null;
      if (token) finish(token);
    });
    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    // Pass 1 — what's already in memory.
    let token: string | null = null;
    let userId: string | null = null;
    let source: AuthStatusDetail["source"] = "none";

    try {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token ?? null;
      userId = data.session?.user?.id ?? null;
      if (token) source = "session";
    } catch {
      /* noop */
    }

    // Pass 2 — race a short window for the SDK to hydrate from storage.
    if (!token && typeof window !== "undefined") {
      const waited = await waitForSession(600);
      if (waited) {
        token = waited;
        try {
          const { data } = await supabase.auth.getSession();
          userId = data.session?.user?.id ?? null;
        } catch { /* noop */ }
        source = "wait";
      }
    }

    // Pass 3 — last-ditch refresh.
    if (!token) {
      try {
        const { data } = await supabase.auth.refreshSession();
        token = data.session?.access_token ?? null;
        userId = data.session?.user?.id ?? null;
        if (token) source = "refresh";
      } catch {
        /* noop */
      }
    }

    emitStatus({
      hasSession: Boolean(userId),
      hasToken: Boolean(token),
      userId,
      source,
    });

    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);
