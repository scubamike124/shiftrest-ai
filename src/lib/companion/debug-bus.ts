// Lightweight debug event bus for the Companion screen HUD.
// Frontend-only. No analytics, no network. Emit calls are cheap no-ops
// when the HUD isn't mounted.

export const BUILD_STAMP = "2026-06-29T22:30Z";

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

export type DebugHttpStatus = {
  endpoint: string;
  status: number;
  at: number;
};

const EVT = "companion:debug";
const HTTP_EVT = "companion:http-status";
const LAST_HTTP_KEY = "companion.debug.lastHttpStatus";
let fetchProbeInstalled = false;

function endpointFrom(input: RequestInfo | URL): string {
  try {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw, window.location.origin);
    return `${url.pathname}${url.search}`.slice(0, 160);
  } catch {
    return "unknown";
  }
}

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

export function emitHttpStatus(status: DebugHttpStatus): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(LAST_HTTP_KEY, JSON.stringify(status));
    window.dispatchEvent(new CustomEvent<DebugHttpStatus>(HTTP_EVT, { detail: status }));
  } catch {
    /* noop */
  }
}

export function getLastHttpStatus(): DebugHttpStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(LAST_HTTP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DebugHttpStatus;
    if (!parsed || typeof parsed.endpoint !== "string" || typeof parsed.status !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function onHttpStatus(cb: (p: DebugHttpStatus) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const h = (e: Event) => cb((e as CustomEvent<DebugHttpStatus>).detail);
  window.addEventListener(HTTP_EVT, h as EventListener);
  return () => window.removeEventListener(HTTP_EVT, h as EventListener);
}

export function installDebugNetworkProbe(): void {
  if (typeof window === "undefined" || fetchProbeInstalled || !isDebugEnabled()) return;
  fetchProbeInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const endpoint = endpointFrom(input);
    try {
      const response = await originalFetch(input, init);
      if (!response.ok) {
        emitHttpStatus({ endpoint, status: response.status, at: Date.now() });
      }
      return response;
    } catch (error) {
      emitHttpStatus({ endpoint, status: 0, at: Date.now() });
      throw error;
    }
  };
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
