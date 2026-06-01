import { DAYS, type Shift, endAbsolute, fmt } from "./shifts";

// ───── Sunrise / sunset (NOAA simplified). Returns minutes from local midnight.
export function sunTimes(date: Date, lat: number, lon: number) {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const dayOfYear =
    Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const fracYear = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(fracYear) -
      0.032077 * Math.sin(fracYear) -
      0.014615 * Math.cos(2 * fracYear) -
      0.040849 * Math.sin(2 * fracYear));
  const decl =
    0.006918 -
    0.399912 * Math.cos(fracYear) +
    0.070257 * Math.sin(fracYear) -
    0.006758 * Math.cos(2 * fracYear) +
    0.000907 * Math.sin(2 * fracYear) -
    0.002697 * Math.cos(3 * fracYear) +
    0.00148 * Math.sin(3 * fracYear);
  const cosH =
    (Math.cos(90.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) /
    (Math.cos(lat * rad) * Math.cos(decl));
  if (cosH > 1) return { sunrise: null, sunset: null }; // polar night
  if (cosH < -1) return { sunrise: 0, sunset: 1439 }; // midnight sun
  const ha = Math.acos(cosH) * deg;
  const sunriseUTC = 720 - 4 * (lon + ha) - eqTime;
  const sunsetUTC = 720 - 4 * (lon - ha) - eqTime;
  const offsetMin = -date.getTimezoneOffset();
  const norm = (m: number) => ((Math.round(m + offsetMin) % 1440) + 1440) % 1440;
  return { sunrise: norm(sunriseUTC), sunset: norm(sunsetUTC) };
}

// ───── Rotation detection
export type Rotation =
  | "no-shifts"
  | "fixed-day"
  | "fixed-evening"
  | "fixed-night"
  | "rotating-forward"
  | "rotating-backward"
  | "irregular";

export function detectRotation(shifts: Shift[]): { kind: Rotation; label: string } {
  if (shifts.length === 0) return { kind: "no-shifts", label: "No shifts logged" };
  const buckets = shifts.map((s) => {
    if (s.start >= 22 * 60 || s.start < 4 * 60) return "night";
    if (s.start >= 4 * 60 && s.start < 12 * 60) return "day";
    return "evening";
  });
  const unique = [...new Set(buckets)];
  if (unique.length === 1) {
    const k = unique[0];
    return {
      kind: (`fixed-${k}` as Rotation),
      label: k === "night" ? "Fixed nights" : k === "day" ? "Fixed days" : "Fixed evenings",
    };
  }
  // Detect forward (day→eve→night) or backward (night→eve→day) progression
  const order = ["day", "evening", "night"];
  let forward = 0;
  let backward = 0;
  for (let i = 1; i < buckets.length; i++) {
    const a = order.indexOf(buckets[i - 1]);
    const b = order.indexOf(buckets[i]);
    if (b > a) forward++;
    else if (b < a) backward++;
  }
  if (forward >= 2 && backward === 0)
    return { kind: "rotating-forward", label: "Forward rotation (gentler)" };
  if (backward >= 2 && forward === 0)
    return { kind: "rotating-backward", label: "Backward rotation (harsher)" };
  return { kind: "irregular", label: "Irregular schedule" };
}

// ───── Circadian debt score (0-100, higher = more brutal)
export function circadianDebt(shifts: Shift[]): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (shifts.length === 0) return { score: 0, reasons: ["No shifts logged"] };

  let score = 0;
  // Night shift count
  const nights = shifts.filter((s) => s.start >= 22 * 60 || s.start < 4 * 60).length;
  if (nights) {
    score += nights * 9;
    reasons.push(`${nights} night shift${nights > 1 ? "s" : ""} (+${nights * 9})`);
  }

  // Backward rotation penalty
  const rot = detectRotation(shifts);
  if (rot.kind === "rotating-backward") {
    score += 15;
    reasons.push("Backward rotation (+15)");
  } else if (rot.kind === "irregular") {
    score += 10;
    reasons.push("Irregular pattern (+10)");
  }

  // Short rest between consecutive shifts (<11h)
  const sorted = [...shifts].sort((a, b) => a.day - b.day);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevEndAbs = prev.day * 1440 + endAbsolute(prev);
    const curStartAbs = cur.day * 1440 + cur.start;
    const gap = curStartAbs - prevEndAbs;
    if (gap > 0 && gap < 11 * 60) {
      score += 8;
      reasons.push(`Short turnaround ${DAYS[prev.day]}→${DAYS[cur.day]} (+8)`);
    }
  }

  // Long shifts >10h
  const long = shifts.filter((s) => endAbsolute(s) - s.start > 10 * 60).length;
  if (long) {
    score += long * 4;
    reasons.push(`${long} long shift${long > 1 ? "s" : ""} >10h (+${long * 4})`);
  }

  return { score: Math.min(100, score), reasons };
}

// ───── Smart Light Plan per shift
export type PlanEvent = {
  time: number; // minutes from local midnight (next-day represented mod 1440)
  kind: "wake" | "bright" | "amber" | "blackout" | "caffeine-on" | "caffeine-cutoff" | "shift-start" | "shift-end" | "meal" | "nap";
  title: string;
  detail: string;
};

export function buildLightPlan(
  shift: Shift,
  prefs: { sleepHours: number; windDownMin: number },
  sun?: { sunrise: number | null; sunset: number | null },
): PlanEvent[] {
  const events: PlanEvent[] = [];
  const isNight = shift.start >= 22 * 60 || shift.start < 4 * 60;
  const endAbs = endAbsolute(shift);
  const windStart = endAbs;
  const sleepStart = windStart + prefs.windDownMin;
  const sleepEnd = sleepStart + prefs.sleepHours * 60;
  const wakeBefore = shift.start - 90;

  events.push({
    time: ((wakeBefore % 1440) + 1440) % 1440,
    kind: "wake",
    title: "Wake & bright light",
    detail: "10–20 min of bright light (sunlight or 10,000 lux lamp) within 15 min of waking.",
  });

  events.push({
    time: shift.start - 30,
    kind: "caffeine-on",
    title: "Caffeine on",
    detail: "100–200 mg ~30 min before clock-in. Add a small top-up midway if needed.",
  });

  events.push({
    time: shift.start,
    kind: "shift-start",
    title: "Shift starts",
    detail: `Clocked in at ${fmt(shift.start)}.`,
  });

  // Caffeine cutoff = 6h before sleepStart
  events.push({
    time: sleepStart - 6 * 60,
    kind: "caffeine-cutoff",
    title: "Caffeine cutoff",
    detail: `Last caffeine by ${fmt(sleepStart - 6 * 60)} so it clears before sleep.`,
  });

  if (isNight && sun?.sunrise != null) {
    events.push({
      time: sun.sunrise,
      kind: "amber",
      title: "Amber glasses on",
      detail: "Sunrise — switch to amber/blue-blocking glasses to protect melatonin on the commute.",
    });
  }

  events.push({
    time: endAbs % 1440,
    kind: "shift-end",
    title: "Shift ends — wind down",
    detail: `Dim lights, light snack, no screens for the next ${prefs.windDownMin} min.`,
  });

  events.push({
    time: sleepStart % 1440,
    kind: "blackout",
    title: "Blackout — sleep window",
    detail: `Cave-dark room, 65–68°F (18–20°C). Sleep until ${fmt(sleepEnd)}.`,
  });

  if (isNight && shift.start - 90 - 30 > 0) {
    events.push({
      time: Math.max(shift.start - 90 - 30, 0),
      kind: "meal",
      title: "Light pre-shift meal",
      detail: "Protein + complex carbs. Avoid heavy/greasy — they sabotage alertness.",
    });
  }

  return events.sort((a, b) => a.time - b.time);
}

// ───── Default location (NYC) when user hasn't set one
export const DEFAULT_LOCATION = { lat: 40.7128, lon: -74.006, label: "New York, NY" };
