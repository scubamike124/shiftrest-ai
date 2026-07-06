// Phase-1 launch flags. Flip these back on when the corresponding
// feature is promoted from Phase 2.
//
// SMART_ALARM_ENABLED — hides the Smart Alarm UI (dashboard card, /events
// mount, marketing sections, quick actions, morning brief slot, settings
// toggle, features/pricing copy). Server-side dispatch code, push
// enrollment, DB, and the QA harness stay in place so Phase 2 = flip
// this flag back to true.
// TEMPORARY: enabled on preview builds only for on-device verification test.
// Production stays hard-off. Revert to `false` after the test.
// Preview host pattern: id-preview--*.lovable.app
export const SMART_ALARM_ENABLED =
  typeof window !== "undefined" &&
  (window.location.hostname.startsWith("id-preview--") ||
    window.location.hostname.startsWith("preview--") ||
    window.location.hostname === "localhost");

// HIDE_COMING_SOON_SKILLS — filters skills whose status === "coming_soon" out
// of the /settings/skills catalog for Phase 1. All descriptor definitions,
// conditional-render guards, and the "Coming soon" Badge remain in code;
// flip this flag to `false` to restore Phase 2 previews with zero code
// changes.
export const HIDE_COMING_SOON_SKILLS = true;

// HIDE_PLANNED_PROVIDERS_ON_HEALTH — hides the "Planned providers" roadmap
// cards (Apple Health, Garmin, Whoop) on /health for Phase 1. The
// PLANNED_PROVIDERS array and the rendering code remain intact; flip this
// flag to `false` to restore the section for Phase 2.
export const HIDE_PLANNED_PROVIDERS_ON_HEALTH = true;

// ENABLE_REALTIME_PILOT — kill-switch for the OpenAI Realtime WebRTC voice
// pilot. Default OFF. Reads `import.meta.env.VITE_ENABLE_REALTIME_PILOT ===
// "true"` so we can flip it per-environment. When false, /lab/pilot-realtime
// 404s and production voice is unchanged.
export const ENABLE_REALTIME_PILOT =
  import.meta.env.VITE_ENABLE_REALTIME_PILOT === "true";
