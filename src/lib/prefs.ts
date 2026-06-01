export type Prefs = {
  windDownMin: number;
  sleepHours: number;
  notifications: boolean;
  lowLight: boolean;
  lat: number;
  lon: number;
  locationLabel: string;
  partnerName: string;
};

export const DEFAULT_PREFS: Prefs = {
  windDownMin: 120,
  sleepHours: 8,
  notifications: true,
  lowLight: true,
  lat: 40.7128,
  lon: -74.006,
  locationLabel: "New York, NY",
  partnerName: "",
};

export const PREFS_KEY = "shiftrest.prefs.v1";

export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}
