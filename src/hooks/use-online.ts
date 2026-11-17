/**
 * `useOnline()` — reactive `navigator.onLine` with cross-tab + transition
 * callback support.
 *
 * Why not just `navigator.onLine`?
 * ────────────────────────────────
 * - It's a *snapshot*, not reactive. Components need re-render on change.
 * - The 'online' event is the cheapest reliable signal that connectivity
 *   was actually restored (browser-internal heuristic, not a ping). Good
 *   enough for "show banner / hide banner" UX.
 * - We expose `useOnlineTransition(onReconnect)` separately so the sync
 *   side-effect can run once per offline→online edge without re-firing
 *   on every render the way a `useEffect([online])` pattern can if the
 *   caller forgets to gate it.
 */
import { useEffect, useRef, useState } from "react";
import { createReconnectRetry } from "@/lib/offline-retry";

function initial(): boolean {
  if (typeof navigator === "undefined") return true; // SSR: assume online
  return navigator.onLine !== false;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(initial);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    // Reconcile in case the event fired before mount.
    setOnline(navigator.onLine !== false);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/**
 * Fires `onReconnect` exactly once per offline→online edge.
 * The callback identity is captured in a ref so callers don't need useCallback.
 */
export function useOnlineTransition(onReconnect: () => void): void {
  const cbRef = useRef(onReconnect);
  cbRef.current = onReconnect;
  const wasOnlineRef = useRef<boolean>(initial());
  const online = useOnline();
  useEffect(() => {
    if (!wasOnlineRef.current && online) {
      try {
        cbRef.current();
      } catch (e) {
        console.warn("reconnect handler threw", e);
      }
    }
    wasOnlineRef.current = online;
  }, [online]);
}

/** Wait after "online" before retrying, so a flapping connection does not fire a burst. */
export const RECONNECT_RETRY_DEBOUNCE_MS = 1500;

/**
 * For a card that can show the offline failure: retries ONCE per offline→online cycle
 * (debounced, never on a timer, never for provider errors). `offlineFailed` must be true
 * only while the card shows the offline failure. See src/lib/offline-retry.ts.
 */
export function useRetryOnReconnect(offlineFailed: boolean, retry: () => void): void {
  const failedRef = useRef(offlineFailed);
  failedRef.current = offlineFailed;
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const ctlRef = useRef<ReturnType<typeof createReconnectRetry> | null>(null);

  useEffect(() => {
    const ctl = createReconnectRetry({
      debounceMs: RECONNECT_RETRY_DEBOUNCE_MS,
      isOnline: () => navigator.onLine !== false,
      shouldRetry: () => failedRef.current,
      retry: () => retryRef.current(),
    });
    ctlRef.current = ctl;
    window.addEventListener("online", ctl.onOnline);
    window.addEventListener("offline", ctl.onOffline);
    return () => {
      window.removeEventListener("online", ctl.onOnline);
      window.removeEventListener("offline", ctl.onOffline);
      ctl.dispose();
      ctlRef.current = null;
    };
  }, []);

  useEffect(() => {
    // The card just failed offline: if the connection is already back, schedule.
    ctlRef.current?.onStateChange();
  }, [offlineFailed]);
}
