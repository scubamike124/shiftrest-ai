// Phase-1 launch flags. Flip these back on when the corresponding
// feature is promoted from Phase 2.
//
// SMART_ALARM_ENABLED — hides the Smart Alarm UI (dashboard card, /events
// mount, marketing sections, quick actions, morning brief slot, settings
// toggle, features/pricing copy). Server-side dispatch code, push
// enrollment, DB, and the QA harness stay in place so Phase 2 = flip
// this flag back to true.
export const SMART_ALARM_ENABLED = false;

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

// ENABLE_REALTIME_PILOT — Phase 0 kill-switch for the next-gen OpenAI
// Realtime + LiveKit voice pipeline. Default OFF. Reads
// `import.meta.env.VITE_ENABLE_REALTIME_PILOT === "true"` so we can flip
// it per-environment without code changes. When false, all clients use
// the existing OpenAI TTS + Whisper pipeline (no behavior change).
// No route, UI, or server endpoint reads this yet — Phase 1 wires it in.
export const ENABLE_REALTIME_PILOT =
  import.meta.env.VITE_ENABLE_REALTIME_PILOT === "true";
