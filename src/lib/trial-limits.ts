/**
 * Trial usage limits. Single source of truth for both server and client.
 *
 * Applies only to users whose subscription status is "trialing". Paying
 * subscribers (active / lifetime / grace-period canceled) are unaffected.
 */

/** Total voice minutes a trial user can spend across all Companion sessions. */
export const TRIAL_VOICE_MINUTES_CAP = 60;

/** Same cap expressed in seconds — what the server actually stores. */
export const TRIAL_VOICE_SECONDS_CAP = TRIAL_VOICE_MINUTES_CAP * 60;

/** How often the client should flush elapsed seconds while a session is active. */
export const TRIAL_VOICE_HEARTBEAT_MS = 30_000;
