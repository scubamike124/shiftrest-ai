// Phase-1 launch flags. Flip these back on when the corresponding
// feature is promoted from Phase 2.
//
// SMART_ALARM_ENABLED — hides the Smart Alarm UI (dashboard card, /events
// mount, marketing sections, quick actions, morning brief slot, settings
// toggle, features/pricing copy). Server-side dispatch code, push
// enrollment, DB, and the QA harness stay in place so Phase 2 = flip
// this flag back to true.
export const SMART_ALARM_ENABLED = false;
