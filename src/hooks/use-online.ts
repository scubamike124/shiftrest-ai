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
