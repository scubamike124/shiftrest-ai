// Slice 11 — First-launch Companion intro flag (per-device, additive).
// SSR-safe: all reads/writes guard `window`. No DB migration required.

const KEY = "restpilot.companion.introSeen.v1";
const DISMISS_PREFIX = "restpilot.companion.promptDismiss.v1:";

export function hasSeenCompanionIntro(): boolean {
  if (typeof window === "undefined") return true; // never trigger during SSR
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

export function markCompanionIntroSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    /* noop */
  }
}

/** Returns ms since dismissal, or null if never dismissed. */
export function promptDismissedAgo(key: string): number | null {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(DISMISS_PREFIX + key);
    if (!raw) return null;
    const t = Number(raw);
    if (!Number.isFinite(t)) return null;
    return Date.now() - t;
  } catch {
    return null;
  }
}

export function dismissPrompt(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_PREFIX + key, String(Date.now()));
  } catch {
    /* noop */
  }
}

/** Has the dismissal expired (default 6 h)? */
export function isPromptFresh(key: string, windowMs = 6 * 60 * 60 * 1000): boolean {
  const ago = promptDismissedAgo(key);
  return ago == null ? true : ago > windowMs;
}
