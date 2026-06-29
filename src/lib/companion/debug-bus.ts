// Lightweight debug event bus for the Companion screen HUD.
// Frontend-only. No analytics, no network. Emit calls are cheap no-ops
// when the HUD isn't mounted.

export const BUILD_STAMP = "2026-06-29T05:10Z";

export type DebugStep =
  | "tap"
  | "mic-start"
  | "mic-stop"
  | "stt-req"
  | "stt-ok"
  | "stt-fail"
  | "ai-req"
  | "ai-first-token"
  | "ai-done"
  | "ai-fail"
  | "tts-req"
  | "tts-play"
  | "tts-end"
  | "tts-fail"
  | "greet-shown"
  | "auth-ok"
  | "auth-wait"
  | "auth-refresh"
  | "auth-missing"
  | "reset";

export type DebugPayload = {
  step: DebugStep;
  at: number;
  info?: string;
};

const EVT = "companion:debug";

export function emitDebug(step: DebugStep, info?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent<DebugPayload>(EVT, {
        detail: { step, at: Date.now(), info },
      }),
    );
  } catch {
    /* noop */
  }
}

export function onDebug(cb: (p: DebugPayload) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const h = (e: Event) => cb((e as CustomEvent<DebugPayload>).detail);
  window.addEventListener(EVT, h as EventListener);
  return () => window.removeEventListener(EVT, h as EventListener);
}

export function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("debug") === "1") return true;
    return window.localStorage.getItem("companion_debug") === "1";
  } catch {
    return false;
  }
}

export function setDebugEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem("companion_debug", "1");
    else window.localStorage.removeItem("companion_debug");
  } catch {
    /* noop */
  }
}
