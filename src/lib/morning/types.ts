// Shared DTO for the Morning Brief. The server function returns this shape;
// the client renders cards in the order saved in user_prefs.brief_layout.

export type BriefCardId =
  | "sleep"
  | "alarm"
  | "weather"
  | "longclock"
  | "departure"
  | "tip"
  | "motivation";

export type MorningBriefDTO = {
  generatedAtISO: string;
  greeting: {
    name: string;
    hourBucket: "early" | "morning" | "midday";
    recommendation: string | null;
  };
  sleep: {
    durationMin: number;
    score: number; // 0–100
    source: "wearable" | "manual";
  } | null;
  weather: {
    tempC: number;
    high: number;
    low: number;
    condition: string;
    icon: string;
  } | null;
  longclock: {
    items: { id: string; title: string; atISO: string; kind: string }[];
  } | null;
  departure: {
    leaveByISO: string;
    firstEventISO: string;
    firstEventTitle: string;
    baselineMin: number;
  } | null;
  memoryLine: string | null;
};
