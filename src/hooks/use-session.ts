// Lightweight session hook — gates UI on a *hydrated* Supabase session, not
// a stale "signedIn" prop. Prevents first-paint races where a protected
// serverFn fires before the SDK has loaded the access token from storage.

import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ensureWelcomeEmailFn } from "@/lib/welcome-email.functions";

function emitAuthStatus(session: Session | null, source: string) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("companion:auth-status", {
        detail: {
          hasSession: Boolean(session?.user?.id),
          hasToken: Boolean(session?.access_token),
          userId: session?.user?.id ?? null,
          source,
        },
      }),
    );
  } catch {
    /* noop */
  }
}

function waitForAuthEvent(timeoutMs: number): Promise<Session | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: (() => void) | null = null;
    const finish = (session: Session | null) => {
      if (done) return;
      done = true;
      try { unsubscribe?.(); } catch { /* noop */ }
      window.clearTimeout(timer);
      resolve(session);
    };
    const sub = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.access_token) finish(nextSession);
    });
    unsubscribe = () => sub.data.subscription.unsubscribe();
    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const welcomeTriedRef = useRef(false);

  useEffect(() => {
    if (!ready || !session?.user?.id || welcomeTriedRef.current) return;
    welcomeTriedRef.current = true;
    // Fire-and-forget; idempotent server-side via profiles.welcomed_at.
    void ensureWelcomeEmailFn().catch(() => {
      /* swallow — no user-visible failure if welcome email can't send */
    });
  }, [ready, session?.user?.id]);

  useEffect(() => {
    let mounted = true;
    async function hydrate() {
      let nextSession: Session | null = null;
      let source = "session-local";
      try {
        const { data } = await supabase.auth.getSession();
        nextSession = data.session ?? null;
      } catch {
        nextSession = null;
      }

      if (!nextSession?.access_token) {
        const waited = await waitForAuthEvent(700);
        if (waited?.access_token) {
          nextSession = waited;
          source = "auth-wait";
        }
      }

      if (!nextSession?.access_token) {
        try {
          const { data } = await supabase.auth.refreshSession();
          if (data.session?.access_token) {
            nextSession = data.session;
            source = "auth-refresh";
          }
        } catch {
          /* noop */
        }
      }

      if (!mounted) return;
      setSession(nextSession);
      emitAuthStatus(nextSession, source);
      setReady(true);
    }
    void hydrate();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      if (!mounted) return;
      setSession(s ?? null);
      emitAuthStatus(s ?? null, "auth-event");
      setReady(true);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    ready,
    hasSession: Boolean(session),
    hasAccessToken: Boolean(session?.access_token),
  };
}
