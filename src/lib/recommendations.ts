// Personalized daily action engine — Upgrade 1.
//
// Emits 3–5 ranked, time-stamped actions for the next 24h driven by:
//   - The user's resolved shift (today's or the next one)
//   - Rotation pattern + fatigue band
//   - Wearable signals (sleep debt, last-night efficiency, HRV trend)
//   - User prefs (sleepHours, windDownMin)
//
// Pure functions, no network. Consumed by AIBriefCard, /plan, and the
// AI coach context.

import { DAYS, type Shift, endAbsolute, fmt } from "./shifts";
import type { Insights } from "./insights";
import type { Prefs } from "./prefs";
import { sunTimes } from "./sleep-engine";
import { detectDeviceTz } from "./tz";

export type Recommendation = {
  /** Absolute minutes from now when the user should act (for sorting). */
  whenMinutes: number;
  /** Human time label, e.g. "16:30" or "in 2h". */
  whenLabel: string;
  kind:
    | "anchor-sleep"
    | "wind-down"
    | "bright-light"
    | "amber-light"
    | "caffeine-on"
    | "caffeine-cutoff"
    | "meal"
    | "nap"
    | "split-sleep"
    | "hydrate"
    | "recovery";
  title: string;
  detail: string;
  /** 1 (top) – 5 (lowest). Used to rank when more than 5 candidates exist. */
  priority: number;
};

function minutesUntil(targetMinFromMidnight: number, now: Date): number {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const delta = ((targetMinFromMidnight - nowMin) % 1440 + 1440) % 1440;
  return delta;
}

function labelFor(targetMin: number, now: Date): string {
  const dm = minutesUntil(targetMin, now);
  if (dm < 60) return `in ${Math.max(1, Math.round(dm))}m`;
  if (dm < 6 * 60) return `in ${(dm / 60).toFixed(1)}h`;
  return fmt(targetMin);
}

function relMinutesFromNow(targetMin: number, now: Date): number {
  return minutesUntil(targetMin, now);
}

export function buildRecommendations(
  insights: Insights,
  prefs: Prefs,
  now: Date,
  location?: { lat: number | null; lon: number | null },
): Recommendation[] {
  const recs: Recommendation[] = [];
  const target = insights.todayShift ?? insights.nextShift?.shift;

  const recsTz = prefs.currentTz ?? prefs.homeTz ?? detectDeviceTz() ?? undefined;
  const sun = location
    ? sunTimes(now, location.lat ?? null, location.lon ?? null, recsTz)
    : { sunrise: null, sunset: null };

  if (target) {
    const isNight = target.start >= 22 * 60 || target.start < 4 * 60;
    const endAbs = endAbsolute(target);
    const sleepStart = (endAbs + prefs.windDownMin) % 1440;
    const sleepEnd = (endAbs + prefs.windDownMin + prefs.sleepHours * 60) % 1440;
    const caffeineOn = (target.start - 30 + 1440) % 1440;
    const caffeineCutoff = (sleepStart - 6 * 60 + 1440) % 1440;
    const windDown = endAbs % 1440;
    const preShiftMeal = (target.start - 90 + 1440) % 1440;

    // Pre-shift bright light (if outside sleep window)
    const wakeApprox = (target.start - 90 + 1440) % 1440;
    recs.push({
      whenMinutes: relMinutesFromNow(wakeApprox, now),
      whenLabel: labelFor(wakeApprox, now),
      kind: "bright-light",
      title: "Bright light + caffeine",
      detail: isNight
        ? "10–20 min of bright light (10,000 lux lamp ideal) to lock in alertness before the night."
        : "10–20 min outside or under a bright lamp within 15 min of waking.",
      priority: 1,
    });

    recs.push({
      whenMinutes: relMinutesFromNow(caffeineOn, now),
      whenLabel: labelFor(caffeineOn, now),
      kind: "caffeine-on",
      title: "Caffeine on",
      detail: "100–200 mg about 30 min before clock-in. Top up midway if needed.",
      priority: 2,
    });

    recs.push({
      whenMinutes: relMinutesFromNow(preShiftMeal, now),
      whenLabel: labelFor(preShiftMeal, now),
      kind: "meal",
      title: "Light pre-shift meal",
      detail: "Protein + complex carbs. Skip heavy/greasy food — it sabotages alertness.",
      priority: 3,
    });

    recs.push({
      whenMinutes: relMinutesFromNow(caffeineCutoff, now),
      whenLabel: labelFor(caffeineCutoff, now),
      kind: "caffeine-cutoff",
      title: "Caffeine cutoff",
      detail: `Last coffee by ${fmt(caffeineCutoff)} so it clears before sleep.`,
      priority: 3,
    });

    recs.push({
      whenMinutes: relMinutesFromNow(windDown, now),
      whenLabel: labelFor(windDown, now),
      kind: "wind-down",
      title: "Wind-down begins",
      detail: `Dim lights, screens off, hot shower. ${prefs.windDownMin} min until sleep window.`,
      priority: 2,
    });

    recs.push({
      whenMinutes: relMinutesFromNow(sleepStart, now),
      whenLabel: labelFor(sleepStart, now),
      kind: "anchor-sleep",
      title: isNight ? "Anchor sleep window" : "Sleep window",
      detail: `Blackout room, 65–68°F. Sleep ${fmt(sleepStart)} → ${fmt(sleepEnd)}.`,
      priority: 1,
    });

    if (isNight && sun?.sunrise != null) {
      recs.push({
        whenMinutes: relMinutesFromNow(sun.sunrise, now),
        whenLabel: labelFor(sun.sunrise, now),
        kind: "amber-light",
        title: "Amber glasses on",
        detail: "Sunrise — switch to amber/blue-blocking glasses on the commute home.",
        priority: 2,
      });
    }

    // Split-sleep suggestion when turnaround is under 9h
    if (insights.nextShift) {
      const ns = insights.nextShift.shift;
      const gap = ns.start + 1440 - endAbsolute(target);
      if (gap > 0 && gap < 9 * 60) {
        const anchorLen = Math.min(4 * 60, gap - 60);
        recs.push({
          whenMinutes: relMinutesFromNow(sleepStart, now),
          whenLabel: labelFor(sleepStart, now),
          kind: "split-sleep",
          title: "Try split sleep",
          detail: `Short turnaround (${(gap / 60).toFixed(
            1,
          )}h). Anchor ${(anchorLen / 60).toFixed(
            1,
          )}h now + 90-min nap before ${DAYS[ns.day]} shift.`,
          priority: 1,
        });
      }
    }

    // Pre-shift nap on extreme/high fatigue days
    if (insights.fatigueToday.band === "extreme" || insights.fatigueToday.band === "high") {
      const napStart = (target.start - 180 + 1440) % 1440;
      recs.push({
        whenMinutes: relMinutesFromNow(napStart, now),
        whenLabel: labelFor(napStart, now),
        kind: "nap",
        title: "Pre-shift power nap",
        detail: "20–30 min nap ~3h before clock-in. Set an alarm — anything longer = grogginess.",
        priority: 2,
      });
    }
  } else {
    // Rest day — focus on recovery
    recs.push({
      whenMinutes: 0,
      whenLabel: "today",
      kind: "recovery",
      title: "Active recovery day",
      detail:
        "Get morning sunlight, eat at consistent times, light movement. Protect tomorrow's energy.",
      priority: 1,
    });
  }

  // Sleep-debt recovery prompt
  if (insights.sleepDebtHours >= 3) {
    recs.push({
      whenMinutes: 0,
      whenLabel: "tonight",
      kind: "recovery",
      title: `Bank ${Math.min(2, insights.sleepDebtHours - 2).toFixed(1)}h extra tonight`,
      detail: `You're carrying ${insights.sleepDebtHours.toFixed(
        1,
      )}h of sleep debt. Add 30–90 min to tonight's window — don't try to repay it all at once.`,
      priority: 1,
    });
  }

  // HRV trending down → push hydration + earlier wind-down
  if (insights.hrvTrend != null && insights.hrvTrend < -0.07) {
    recs.push({
      whenMinutes: 0,
      whenLabel: "today",
      kind: "hydrate",
      title: "Hydrate + earlier wind-down",
      detail:
        "HRV is below baseline — body's under load. Add 500ml water across the day and start wind-down 15 min earlier.",
      priority: 2,
    });
  }

  // Rank: lower priority first, then sooner. Cap at 5.
  return recs
    .sort((a, b) => a.priority - b.priority || a.whenMinutes - b.whenMinutes)
    .slice(0, 5);
}

export function summarizeRecommendations(recs: Recommendation[]): string {
  if (!recs.length) return "";
  return recs
    .map((r) => `- ${r.whenLabel} — ${r.title}: ${r.detail}`)
    .join("\n");
}
