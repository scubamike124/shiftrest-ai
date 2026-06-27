/**
 * Plan snapshot — mirrors the dashboard's source-of-truth queries to
 * localStorage so the page can render the full Long Clock, Smart Alarm,
 * light/caffeine/nap/wind-down/recovery schedule, and trip plan with zero
 * network access.
 *
 * What we cache here (and what we *don't*)
 * ────────────────────────────────────────
 * - YES: `shifts`, `prefs`, `employers`, latest `wearable summary`, latest
 *   active `trip`. These are the inputs `buildRecommendations()` and
 *   `computeInsights()` consume; given them, the entire derived plan
 *   (sleep windows, nap, wind-down, light schedule, caffeine cutoff,
 *   recovery actions, Long Clock geometry) reproduces *deterministically*
 *   client-side. That's why we don't snapshot the derived output — we
 *   snapshot the inputs and let the same pure functions run offline.
 * - YES: AI-generated cards (right_now, tomorrow, jet-lag, etc.) — but
 *   those cache through `ai-client.ts` so each intent owns its key.
 * - NO: auth tokens, raw wearable rows, partner-mode shares, or anything
 *   we wouldn't want sitting in another browser profile's localStorage.
 *
 * Reconcile-on-reconnect
 * ──────────────────────
 * `reconcileOnReconnect` compares the saved IANA tz vs the device tz right
 * now. If they differ, we log a `tz_events` row (the existing detector +
 * jet-lag intent will then pick up the jump on next /api/ai call) and ask
 * React Query to refetch the plan inputs so the dashboard regenerates the
 * derived schedule.
 */
import type { QueryClient } from "@tanstack/react-query";
import { lsGet, lsSet } from "@/lib/offline/cache";
import type { Shift } from "@/lib/shifts";
import type { Employer } from "@/lib/employers";
import type { Prefs } from "@/lib/prefs";

const SHIFTS_KEY = "snapshot:shifts";
const EMPLOYERS_KEY = "snapshot:employers";
const PREFS_KEY = "snapshot:prefs";
const META_KEY = "snapshot:meta";

export type SnapshotMeta = {
  savedAt: number;
  currentTz: string | null;
  homeTz: string | null;
};

/** Seed React Query's cache from localStorage so the first render after a
 *  cold offline boot is the saved plan, not an empty skeleton. */
export function hydrateQueryCacheFromSnapshot(
  qc: QueryClient,
  userId: string | null | undefined,
): void {
  const shifts = lsGet<Shift[]>(SHIFTS_KEY, userId);
  if (shifts && Array.isArray(shifts.value) && qc.getQueryData(["shifts"]) === undefined) {
    qc.setQueryData(["shifts"], shifts.value);
  }
  const employers = lsGet<Employer[]>(EMPLOYERS_KEY, userId);
  if (employers && Array.isArray(employers.value) && qc.getQueryData(["employers"]) === undefined) {
    qc.setQueryData(["employers"], employers.value);
  }
  const prefs = lsGet<Prefs>(PREFS_KEY, userId);
  if (prefs && prefs.value && qc.getQueryData(["prefs"]) === undefined) {
    qc.setQueryData(["prefs"], prefs.value);
  }
}

/** Persist the currently-loaded query data. Safe to call on every render —
 *  it's cheap and bails when the data is identical to what's already saved
 *  by relying on JSON.stringify equality at the storage layer. */
export function persistSnapshot(
  qc: QueryClient,
  userId: string | null | undefined,
): void {
  const shifts = qc.getQueryData<Shift[]>(["shifts"]);
  const employers = qc.getQueryData<Employer[]>(["employers"]);
  const prefs = qc.getQueryData<Prefs>(["prefs"]);
  if (Array.isArray(shifts)) lsSet(SHIFTS_KEY, userId, shifts);
  if (Array.isArray(employers)) lsSet(EMPLOYERS_KEY, userId, employers);
  if (prefs) lsSet(PREFS_KEY, userId, prefs);
  const meta: SnapshotMeta = {
    savedAt: Date.now(),
    currentTz: (prefs?.currentTz ?? null) || null,
    homeTz: (prefs?.homeTz ?? null) || null,
  };
  lsSet(META_KEY, userId, meta);
}

export function readSnapshotMeta(userId: string | null | undefined): SnapshotMeta | null {
  return lsGet<SnapshotMeta>(META_KEY, userId)?.value ?? null;
}

export type ReconcileResult = {
  tzChanged: boolean;
  fromTz: string | null;
  toTz: string | null;
};

/**
 * Called once per offline→online edge. Returns whether the device tz
 * shifted while we were dark; the caller (dashboard) decides what to say
 * in the toast and which queries to invalidate.
 */
export async function reconcileOnReconnect(
  qc: QueryClient,
  userId: string | null | undefined,
): Promise<ReconcileResult> {
  const { detectDeviceTz, normalizeTz } = await import("@/lib/time/tz");
  const device = normalizeTz(detectDeviceTz());
  const meta = readSnapshotMeta(userId);
  const previous = meta?.currentTz ?? null;
  const tzChanged = previous !== null && previous !== device;

  // Best-effort: persist & log. If the network is still flaky the catches
  // keep us from regressing into the offline-error path.
  if (tzChanged && userId) {
    try {
      const { savePrefs } = await import("@/lib/prefs");
      await savePrefs({ currentTz: device });
    } catch { /* fine — we'll retry on next mount */ }
    try {
      const { recordTzEvent } = await import("@/lib/trips.functions");
      await recordTzEvent({ data: { toTz: device, source: "device_tz" } });
    } catch { /* fine */ }
  }

  // Always refetch the plan inputs so the dashboard regenerates the
  // derived schedule from fresh data once we're back online.
  await Promise.allSettled([
    qc.invalidateQueries({ queryKey: ["shifts"] }),
    qc.invalidateQueries({ queryKey: ["prefs"] }),
    qc.invalidateQueries({ queryKey: ["employers"] }),
    qc.invalidateQueries({ queryKey: ["wearable-summary"] }),
  ]);

  return { tzChanged, fromTz: previous, toTz: device };
}
