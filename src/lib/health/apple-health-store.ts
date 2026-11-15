// Where Apple Health data lives: on this iPhone only, in the app's WebView
// storage, tied to the signed-in account. It is never sent to RestPilot's
// servers or to the AI coach.
//
// Connect: ask iOS for read access, read 14 days, keep the nightly summaries.
// Refresh: read again (no prompt once asked). Disconnect: stop reading and
// delete everything stored here.

import { nativePlatform, nativePlugin } from "@/lib/native/capacitor";
import {
  mapAppleHealthNights,
  type AppleHealthNight,
  type RawAppleHealth,
} from "@/lib/health/apple-health";

const KEY = "rp:apple-health:v1";
const READ_DAYS = 14;

export type AppleHealthState = {
  v: 1;
  ownerUserId: string;
  connectedAt: string;
  lastReadAt: string | null;
  nights: AppleHealthNight[];
};

type RestPilotHealthPlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  requestReadAuthorization(): Promise<{ requested: boolean }>;
  readSamples(o: { days: number }): Promise<RawAppleHealth & { partialError?: string }>;
};

function plugin(): RestPilotHealthPlugin | null {
  return nativePlatform() === "ios" ? nativePlugin<RestPilotHealthPlugin>("RestPilotHealth") : null;
}

/** True only inside the iPhone app, with the plugin installed and Health available. */
export async function appleHealthAvailable(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    return (await p.isAvailable()).available === true;
  } catch {
    return false;
  }
}

export function loadAppleHealth(userId: string | null): AppleHealthState | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AppleHealthState;
    if (s?.v !== 1 || !Array.isArray(s.nights)) return null;
    if (s.ownerUserId !== userId) {
      // Another account signed in on this phone: never show them this data.
      clearAppleHealth();
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function save(s: AppleHealthState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the data simply is not kept */
  }
  window.dispatchEvent(new CustomEvent("rp:apple-health-changed"));
}

/** Disconnect / sign-out / account deletion: remove every stored Apple Health value. */
export function clearAppleHealth(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* already gone */
  }
  window.dispatchEvent(new CustomEvent("rp:apple-health-changed"));
}

/** null when HealthKit reported an error and returned nothing (for example while the phone is locked). */
async function read(p: RestPilotHealthPlugin): Promise<AppleHealthNight[] | null> {
  const raw = await p.readSamples({ days: READ_DAYS });
  const nights = mapAppleHealthNights(raw);
  return raw.partialError && nights.length === 0 ? null : nights;
}

/** Call only from the person's tap on Connect: it can show Apple's permission sheet. */
export async function connectAppleHealth(userId: string): Promise<AppleHealthState> {
  const p = plugin();
  if (!p) throw new Error("Apple Health is only available in the RestPilot iPhone app.");
  await p.requestReadAuthorization();
  const now = new Date().toISOString();
  const state: AppleHealthState = {
    v: 1,
    ownerUserId: userId,
    connectedAt: now,
    lastReadAt: now,
    nights: (await read(p)) ?? [],
  };
  save(state);
  return state;
}

/** Re-reads for a connected account. Never prompts and never connects anyone. */
export async function refreshAppleHealth(userId: string): Promise<AppleHealthState | null> {
  const current = loadAppleHealth(userId);
  const p = plugin();
  if (!current || !p) return current;
  const nights = await read(p);
  // A failed read keeps the last good nights and does not count as a read.
  if (nights === null) return current;
  const next: AppleHealthState = { ...current, lastReadAt: new Date().toISOString(), nights };
  // Disconnected while the read was running: do not bring the data back.
  if (!loadAppleHealth(userId)) return null;
  save(next);
  return next;
}
