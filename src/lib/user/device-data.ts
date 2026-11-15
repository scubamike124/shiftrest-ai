// Personal data cached in this browser / app WebView.
//
// The privacy policy says device-cached data is cleared by signing out.
// Before this helper, sign-out cleared only the offline plan snapshot: AI
// recaps (sessionStorage, not keyed by user), hydration logs, companion
// action history and legacy local shifts stayed behind and the next person
// to sign in on the same device could see them.
//
// Device settings that hold no personal data are kept so signing out does
// not reset the device.

/** Exact keys that are device settings, not personal data. */
const DEVICE_SETTING_KEYS = new Set([
  "restpilot.cookie-consent.v1", // consent record for this device
  "restpilot:alarm:audio", // alarm sound choice
  "companion_avatar_id", // avatar choice
  "companion.modelUrl", // avatar model URL
  "rp.coach.voice", // voice choice
  "companion_debug",
  "restpilot:debug-alarm",
]);

type StorageLike = Pick<Storage, "length" | "key" | "removeItem" | "clear">;

/** Keys this helper removes from `local` (exported for tests). */
export function personalLocalKeys(local: StorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < local.length; i += 1) {
    const k = local.key(i);
    if (k && !DEVICE_SETTING_KEYS.has(k)) keys.push(k);
  }
  return keys;
}

/**
 * Remove personal data from browser storage. Call AFTER sign-out (the auth
 * client removes its own session first). Never throws: storage can be
 * unavailable in private mode or a locked-down WebView.
 */
export function clearPersonalDeviceData(
  storages: { local?: StorageLike | null; session?: StorageLike | null } = defaultStorages(),
): void {
  try {
    storages.session?.clear();
  } catch {
    /* unavailable */
  }
  try {
    const local = storages.local;
    if (local) for (const k of personalLocalKeys(local)) local.removeItem(k);
  } catch {
    /* unavailable */
  }
}

function defaultStorages(): { local: Storage | null; session: Storage | null } {
  if (typeof window === "undefined") return { local: null, session: null };
  const get = (name: "localStorage" | "sessionStorage") => {
    try {
      return window[name];
    } catch {
      return null;
    }
  };
  return { local: get("localStorage"), session: get("sessionStorage") };
}

/** AI-generated content cached on this device (cleared with AI memory). */
const AI_SESSION_KEYS = ["rp_daily_review_v1", "rp_right_now_v1", "rp_rightnow_v1", "rp_tomorrow_v1"];
const AI_LOCAL_KEYS = ["restpilot.companion.history.v1"];

export function clearDeviceAiCaches(
  storages: { local?: Pick<Storage, "removeItem"> | null; session?: Pick<Storage, "removeItem"> | null } = defaultStorages(),
): void {
  try {
    for (const k of AI_SESSION_KEYS) storages.session?.removeItem(k);
    for (const k of AI_LOCAL_KEYS) storages.local?.removeItem(k);
  } catch {
    /* unavailable */
  }
}
