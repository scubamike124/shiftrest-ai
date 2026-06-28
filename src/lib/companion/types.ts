// Slice 7 — Shared DTOs for Afternoon Check-In and Evening Brief.

export type AfternoonCardId =
  | "remaining"
  | "nextTraffic"
  | "weatherShift"
  | "workingLate"
  | "hydration"
  | "movement"
  | "battery";

export type EveningCardId =
  | "tomorrowFirst"
  | "tomorrowWeather"
  | "clothing"
  | "smartAlarm"
  | "bedtime"
  | "prep"
  | "travel"
  | "summary"
  | "windDown";

export type AfternoonBriefDTO = {
  generatedAtISO: string;
  greetingName: string;
  remaining: {
    items: { id: string; title: string; atISO: string; kind: string }[];
  } | null;
  nextTraffic: {
    eventTitle: string;
    eventISO: string;
    baselineMin: number;
    leaveByISO: string;
  } | null;
  weatherShift: {
    nowC: number;
    later: { hourISO: string; tempC: number; condition: string }[];
    rainSoon: boolean;
  } | null;
  workingLate: { lastEventISO: string; lastEventTitle: string } | null;
  /** Local-only reminders are surfaced client-side; server signals availability only. */
  hydrationEnabled: boolean;
  movementEnabled: boolean;
};

export type EveningBriefDTO = {
  generatedAtISO: string;
  greetingName: string;
  tomorrowFirst: { title: string; atISO: string; kind: string } | null;
  tomorrowWeather: {
    high: number;
    low: number;
    morningTempC: number | null;
    precipProbabilityMax: number;
    condition: string;
    icon: string;
  } | null;
  /** Derived from temperature & precipitation; client renders friendly copy. */
  clothing: { tone: "warm" | "mild" | "cool" | "cold" | "rain"; hint: string } | null;
  smartAlarm: {
    suggestedWakeISO: string;
    suggestedBedtimeISO: string;
    targetHours: number;
  } | null;
  prep: { count: number; firstTitle: string } | null;
  travel: { destLabel: string | null; departISO: string } | null;
  summary: string | null;
  windDownMin: number;
};
