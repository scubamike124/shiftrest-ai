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
  | { event: "error_encountered"; where: string; message?: string }
  // Slice 11 — Avatar home integration
  | { event: "avatar_viewed"; surface: "dashboard-hero" | "dashboard-header" }
  | { event: "avatar_tapped"; surface: "dashboard-hero" | "dashboard-header" }
  | { event: "companion_opened_from_dashboard"; via: "hero-cta" | "header-chip" | "quick-ask" }
  | { event: "intro_viewed"; step: number }
  | { event: "intro_completed"; skipped?: boolean }
  | { event: "memory_explainer_viewed"; surface: "intro-sheet" | "memory-page" }
  | { event: "prompt_dismissed"; key: string }
  | { event: "prompt_accepted"; key: string }
  | { event: "companion_settings_opened"; from: "hero" | "intro" | "header" }
  // Slice 12 — Companion Skills foundation
  | { event: "skills_flag_toggled"; on: boolean }
  | { event: "skill_viewed"; skill: string }
  | { event: "skill_connect_started"; skill: string }
  | { event: "skill_connect_completed"; skill: string }
  | { event: "skill_connect_failed"; skill: string; reason?: string }
  | { event: "skill_disconnected"; skill: string }
  | { event: "skill_status_changed"; skill: string; status: "connected" | "disabled" | "disconnected" }
  | { event: "skill_invoked"; skill: string; action: string }
  | { event: "calendar_agenda_viewed"; period: "morning" | "afternoon" | "evening"; count: number }
  | { event: "personal_plan_viewed"; period: "morning" | "afternoon" | "evening"; topCount: number }
  | { event: "companion_greeting_shown"; trigger: "url" | "auto" }
  | { event: "mic_permission_denied" }
  | { event: "mic_error" }
  | { event: "voice_turn_empty_audio" }
  | { event: "voice_turn_empty_transcript" }
  | { event: "voice_turn_transcribed"; chars: number }
  | { event: "voice_turn_failed"; stage: "stt" | "ai" | "tts" }
  | { event: "avatar_tap_to_talk"; result: "started" | "stopped" | "denied" | "fallback" };

export function track(evt: CompanionEvent): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("companion:analytics", { detail: evt }));
  } catch {
    /* noop */
  }
}
