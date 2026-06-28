// Phase 5 — Global Quiet Mode.
//
// Quiet Mode is a per-device toggle that:
//   1. Mutes Companion voice replies (speak.ts respects this).
//   2. Pauses non-urgent notifications (notify helpers respect this).
//   3. Causes automations with respect_quiet_hours=true to be skipped.
//
// We never override OS-level Do Not Disturb / Focus — we *defer* to it where
// the platform exposes it. This is an app-layer politeness gate, not a
// privacy bypass.
//
// Pure best-effort; SSR-safe (returns false on server).

const KEY = "restpilot.quietMode.v1";
const EVT = "restpilot:quiet-mode-changed";

export type QuietModeReason = "manual" | "automation" | "scheduled";

export interface QuietModeState {
  on: boolean;
  reason: QuietModeReason;
  since: string | null;
}

const DEFAULT: QuietModeState = { on: false, reason: "manual", since: null };

export function loadQuietMode(): QuietModeState {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<QuietModeState>;
    return { ...DEFAULT, ...parsed };
  } catch {
    return DEFAULT;
  }
}

export function isQuietModeOn(): boolean {
  return loadQuietMode().on;
}

export function setQuietMode(on: boolean, reason: QuietModeReason = "manual"): QuietModeState {
  const next: QuietModeState = {
    on,
    reason,
    since: on ? new Date().toISOString() : null,
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(EVT, { detail: next }));
    } catch {
      /* noop */
    }
  }
  return next;
}

export function onQuietModeChange(cb: (s: QuietModeState) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<QuietModeState>).detail;
    cb(detail ?? loadQuietMode());
  };
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}
