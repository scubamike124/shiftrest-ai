// Slice 10 — Centralized companion analytics. Thin, side-effect-free wrapper
// that fans events out to the global Lovable error reporter (when present)
// and a window CustomEvent that product analytics can subscribe to.
// No network, no storage. Safe to call from SSR (no-op).

export type CompanionEvent =
  | { event: "brief_opened"; period: "morning" | "afternoon" | "evening" }
  | { event: "brief_refresh_failed"; period: "morning" | "afternoon" | "evening"; reason?: string }
  | { event: "action_started"; kind: string; destructive?: boolean }
  | { event: "action_completed"; kind: string }
  | { event: "action_failed"; kind: string; reason?: string }
  | { event: "action_cancelled"; kind: string }
  | { event: "voice_played"; chars: number }
  | { event: "voice_skipped"; reason: "disabled" | "quiet_hours" | "empty" | "superseded" | "tts_error" }
  | { event: "memory_created" }
  | { event: "memory_removed" }
  | { event: "settings_changed"; surface: "companion-sheet" | "companion-settings-page" }
  | { event: "error_encountered"; where: string; message?: string };

export function track(evt: CompanionEvent): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("companion:analytics", { detail: evt }));
  } catch {
    /* noop */
  }
}
