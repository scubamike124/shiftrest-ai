// Apple Health (HealthKit) → RestPilot nightly summaries. Pure, no I/O.
//
// Input: the raw samples the app shell's RestPilotHealth plugin returns
// (ios-app/plugins/restpilot-health). Output: one summary per night, in the
// same shape the insights engine already uses for Oura/Fitbit nights.
//
// Rules (all unit-tested in tests/apple-health.test.mjs):
//  - Only MEASURED sleep counts: "asleep", "core", "deep", "rem". "inBed" alone
//    (for example an iPhone bedtime schedule) is not sleep, and "awake" time
//    inside a night is excluded.
//  - Samples from several sources (iPhone + Apple Watch) often overlap; time is
//    counted as a union of intervals, never summed twice.
//  - Samples less than 60 minutes apart form one sleep session; a night is
//    dated by the local day its session ends (the wake date), so day-time
//    sleep after a night shift belongs to that day.
//  - HRV is Apple's SDNN, averaged over the main sleep session. It is not
//    comparable with Oura's RMSSD; trends only compare Apple Health nights.

export type RawSleepSample = { start: string; end: string; value: string };
export type RawHrvSample = { start: string; end: string; ms: number };
export type RawRestingHrSample = { start: string; end: string; bpm: number };
export type RawAppleHealth = {
  sleep?: RawSleepSample[];
  hrv?: RawHrvSample[];
  restingHeartRate?: RawRestingHrSample[];
};

export type AppleHealthNight = {
  provider: "apple-health";
  /** Local wake date, YYYY-MM-DD. */
  date: string;
  sleepStart: string;
  sleepEnd: string;
  sleepDurationMin: number;
  /** Asleep ÷ time in the session (0–1). */
  sleepEfficiency: number | null;
  deepMin: number | null;
  remMin: number | null;
  /** Apple's "Core" stage. */
  lightMin: number | null;
  awakeMin: number;
  /** SDNN, milliseconds. */
  hrvMs: number | null;
  restingHr: number | null;
};

const KNOWN = new Set(["asleep", "core", "deep", "rem", "inBed", "awake"]);
const SESSION_GAP_MS = 60 * 60_000;
const MIN_SESSION_ASLEEP_MIN = 20;
const MAX_SAMPLE_MS = 24 * 60 * 60_000;
export const APPLE_HEALTH_NIGHTS = 14;

type Interval = { s: number; e: number };
type Sample = Interval & { value: string };

function parse(start: unknown, end: unknown): Interval | null {
  if (typeof start !== "string" || typeof end !== "string") return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || e - s > MAX_SAMPLE_MS) return null;
  return { s, e };
}

/** Sorted, merged union of intervals. */
function union(intervals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const iv of [...intervals].sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1];
    if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
    else out.push({ ...iv });
  }
  return out;
}

/** `a` minus `b` (both any intervals); result is a sorted union. */
function subtract(a: Interval[], b: Interval[]): Interval[] {
  const cut = union(b);
  const out: Interval[] = [];
  for (const iv of union(a)) {
    let s = iv.s;
    for (const c of cut) {
      if (c.e <= s || c.s >= iv.e) continue;
      if (c.s > s) out.push({ s, e: c.s });
      s = Math.max(s, c.e);
      if (s >= iv.e) break;
    }
    if (s < iv.e) out.push({ s, e: iv.e });
  }
  return out;
}

const minutes = (ivs: Interval[]) => Math.round(ivs.reduce((n, x) => n + (x.e - x.s), 0) / 60_000);

/** Total length (minutes) of the union of intervals. */
export function unionMinutes(intervals: Interval[]): number {
  return minutes(union(intervals));
}

function localYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Session = { s: number; e: number; samples: Sample[] };

/** Groups sleep/awake samples (never "inBed") into sessions split at 60-min gaps. */
function sessions(samples: Sample[]): Session[] {
  const out: Session[] = [];
  for (const x of [...samples].sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1];
    if (last && x.s - last.e <= SESSION_GAP_MS) {
      last.e = Math.max(last.e, x.e);
      last.samples.push(x);
    } else {
      out.push({ s: x.s, e: x.e, samples: [x] });
    }
  }
  return out;
}

type Scored = {
  s: number;
  e: number;
  asleep: number;
  inBed: number;
  awake: number;
  stages: { deep: number; rem: number; core: number } | null;
};

/**
 * One session. Sources often disagree (a ring or app writes a long "asleep"
 * while the Watch records "awake" inside it), so: awake time is removed from
 * sleep, and stages are made disjoint (deep, then REM, then core, each minus
 * awake and the stages before it), so they never add up to more than sleep.
 */
function score(x: Session, inBedAll: Interval[]): Scored {
  const of = (...v: string[]) => x.samples.filter((y) => v.includes(y.value));
  const awake = union(of("awake"));
  const asleep = subtract(of("asleep", "core", "deep", "rem"), awake);
  const deep = subtract(of("deep"), awake);
  const rem = subtract(of("rem"), [...awake, ...deep]);
  const core = subtract(of("core"), [...awake, ...deep, ...rem]);
  const hasStages = deep.length + rem.length + core.length > 0;
  // Time in bed: the session plus any in-bed record touching it (clipped to an hour around it).
  const near = inBedAll
    .filter((b) => b.e >= x.s - SESSION_GAP_MS && b.s <= x.e + SESSION_GAP_MS)
    .map((b) => ({
      s: Math.max(b.s, x.s - SESSION_GAP_MS),
      e: Math.min(b.e, x.e + SESSION_GAP_MS),
    }));
  const bed = union([...x.samples, ...near]);
  return {
    s: bed[0]?.s ?? x.s,
    e: bed[bed.length - 1]?.e ?? x.e,
    asleep: minutes(asleep),
    inBed: minutes(bed),
    awake: minutes(awake),
    stages: hasStages ? { deep: minutes(deep), rem: minutes(rem), core: minutes(core) } : null,
  };
}

export function mapAppleHealthNights(raw: RawAppleHealth | null | undefined): AppleHealthNight[] {
  const sleep: Sample[] = [];
  const inBed: Interval[] = [];
  for (const r of raw?.sleep ?? []) {
    const iv = parse(r?.start, r?.end);
    if (!iv || typeof r.value !== "string" || !KNOWN.has(r.value)) continue;
    if (r.value === "inBed") inBed.push(iv);
    else sleep.push({ ...iv, value: r.value });
  }

  const scored = sessions(sleep)
    .map((x) => score(x, inBed))
    .filter((x) => x.asleep >= MIN_SESSION_ASLEEP_MIN);

  // HRV readings can be instantaneous (start == end): key them on the start time.
  const hrv = (raw?.hrv ?? [])
    .map((h) => ({ t: Date.parse(String(h?.start)), ms: Number(h?.ms) }))
    .filter((h) => Number.isFinite(h.t) && Number.isFinite(h.ms) && h.ms > 0 && h.ms < 500);
  const resting = (raw?.restingHeartRate ?? [])
    .map((h) => ({ t: Date.parse(String(h?.start)), bpm: Number(h?.bpm) }))
    .filter((h) => Number.isFinite(h.t) && Number.isFinite(h.bpm) && h.bpm >= 25 && h.bpm <= 200);

  const byDate = new Map<string, Scored[]>();
  for (const x of scored) {
    const key = localYmd(x.e);
    byDate.set(key, [...(byDate.get(key) ?? []), x]);
  }

  const nights: AppleHealthNight[] = [];
  for (const [date, list] of byDate) {
    const main = list.reduce((a, b) => (b.asleep > a.asleep ? b : a));
    const asleep = list.reduce((n, x) => n + x.asleep, 0);
    const inBedMin = list.reduce((n, x) => n + x.inBed, 0);
    const inMain = hrv.filter((h) => h.t >= main.s && h.t <= main.e).map((h) => h.ms);
    const rhrToday = resting.filter((r) => localYmd(r.t) === date).sort((a, b) => b.t - a.t)[0];
    nights.push({
      provider: "apple-health",
      date,
      sleepStart: new Date(main.s).toISOString(),
      sleepEnd: new Date(main.e).toISOString(),
      sleepDurationMin: asleep,
      sleepEfficiency: inBedMin > 0 ? Math.round((asleep / inBedMin) * 100) / 100 : null,
      deepMin: main.stages?.deep ?? null,
      remMin: main.stages?.rem ?? null,
      lightMin: main.stages?.core ?? null,
      awakeMin: list.reduce((n, x) => n + x.awake, 0),
      hrvMs: inMain.length
        ? Math.round((inMain.reduce((a, b) => a + b, 0) / inMain.length) * 10) / 10
        : null,
      restingHr: rhrToday ? Math.round(rhrToday.bpm) : null,
    });
  }
  return nights.sort((a, b) => a.date.localeCompare(b.date)).slice(-APPLE_HEALTH_NIGHTS);
}

/** The latest night if it ended today or yesterday (local); older is not "last night". */
export function lastNightFrom(nights: AppleHealthNight[], now: Date): AppleHealthNight | null {
  const latest = nights[nights.length - 1];
  if (!latest) return null;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return latest.date >= localYmd(y.getTime()) ? latest : null;
}

/** Nights within the last `days` days (local), for 7-day debt and HRV trend. */
export function recentNights(
  nights: AppleHealthNight[],
  now: Date,
  days = APPLE_HEALTH_NIGHTS,
): AppleHealthNight[] {
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  const key = localYmd(from.getTime());
  return nights.filter((n) => n.date > key);
}
