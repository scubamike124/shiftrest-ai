export type WearableProvider = "fitbit" | "oura";

export type WearableConnection = {
  provider: WearableProvider;
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  scope: string | null;
};

export type WearableReading = {
  provider: WearableProvider;
  date: string; // YYYY-MM-DD ("night of")
  sleepStart: string | null;
  sleepEnd: string | null;
  sleepDurationMin: number | null;
  sleepEfficiency: number | null;
  deepMin: number | null;
  remMin: number | null;
  lightMin: number | null;
  hrvMs: number | null;
  restingHr: number | null;
};

export type WearableSummary = {
  connections: WearableConnection[];
  latest: WearableReading | null;
};

export const PROVIDER_LABEL: Record<WearableProvider, string> = {
  fitbit: "Fitbit",
  oura: "Oura Ring",
};
