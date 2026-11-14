// Bands and markers for the dashboard Long Clock (24h ribbon). Pure, so the
// times can be tested against the Plan screen, the 7-day plan and reminders.
// The component adds colors and icons by id.
import { ANCHOR_WHY, localCivilDate, minuteOfDay, shiftAnchorsOn } from "./schedule-core";

export type ClockBand = { id: string; label: string; start: number; end: number; reason: string };
export type ClockMarker = { id: string; label: string; at: number; reason: string };

function fmtTime(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(mm / 60);
  const min = Math.round(mm % 60);
  const ap = h >= 12 ? "p" : "a";
  const h12 = ((h + 11) % 12) + 1;
  return min === 0 ? `${h12}${ap}` : `${h12}:${min.toString().padStart(2, "0")}${ap}`;
}

export function buildClockBands(args: {
  shift?: { start: number; end: number };
  prefs: { sleepHours: number; windDownMin: number };
  /** Today, in the device zone. */
  now: Date;
  /** Device IANA zone (the clock the ribbon is drawn in). */
  tz: string;
  sunrise: number | null;
  sunset: number | null;
}): { bands: ClockBand[]; markers: ClockMarker[] } {
  const { shift, prefs, now, tz, sunrise, sunset } = args;

  const bands: ClockBand[] = [];
  const markers: ClockMarker[] = [];

  if (shift) {
    // Shared anchors: the same times as the Plan screen, the 7-day plan,
    // recommendations and reminders. Previously this clock used an 8h
    // caffeine cutoff and "bright light at sunrise" even after a night
    // shift, which contradicted the Plan screen.
    const a = shiftAnchorsOn(shift, prefs, localCivilDate(now), tz);
    const sStart = shift.start;
    const sEnd = minuteOfDay(a.shiftEnd);
    const wake = minuteOfDay(a.wake);

    bands.push({
      id: "light",
      label: "Bright light",
      start: wake,
      end: minuteOfDay(a.wake + 30),
      reason: `Bright light from ${fmtTime(wake)}, when you wake. ${ANCHOR_WHY.wake} ${ANCHOR_WHY.brightLight}`,
    });

    bands.push({
      id: "work",
      label: "Work",
      start: sStart,
      end: sEnd,
      reason: `Shift ${fmtTime(sStart)} – ${fmtTime(sEnd)}.`,
    });

    const windStart = minuteOfDay(a.windDownStart);
    const sleepStart = minuteOfDay(a.sleepStart);
    bands.push({
      id: "wind",
      label: "Wind-down",
      start: windStart,
      end: sleepStart,
      reason: `${prefs.windDownMin} min wind-down after shift — dim lights, no screens. ${ANCHOR_WHY.windDown}`,
    });

    const sleepEnd = minuteOfDay(a.sleepEnd);
    bands.push({
      id: "sleep",
      label: "Sleep",
      start: sleepStart,
      end: sleepEnd,
      reason: `Target ${prefs.sleepHours}h sleep starting around ${fmtTime(sleepStart)}. ${ANCHOR_WHY.sleep}`,
    });

    const caffCut = minuteOfDay(a.caffeineCutoff);
    markers.push({
      id: "caffeine",
      at: caffCut,
      label: "Caffeine cut",
      reason: `Stop caffeine by ${fmtTime(caffCut)}. ${ANCHOR_WHY.caffeineCutoff}`,
    });

    if (a.isNight && sunrise != null) {
      markers.push({
        id: "amber",
        at: sunrise,
        label: "Amber glasses",
        reason: `Sunrise ${fmtTime(sunrise)}: amber/blue-blocking glasses on the way home. ${ANCHOR_WHY.amberGlasses}`,
      });
    }

    // Alarm at end of sleep
    markers.push({
      id: "alarm",
      at: sleepEnd,
      label: "Alarm",
      reason: `Wake target ${fmtTime(sleepEnd)}, the end of your ${prefs.sleepHours}h sleep window.`,
    });

    // Recovery window: 90 min after wake
    bands.push({
      id: "recovery",
      label: "Recovery",
      start: sleepEnd,
      end: minuteOfDay(a.recoveryEnd),
      reason: `90-min recovery window after wake — light food, hydrate, daylight. ${ANCHOR_WHY.recovery}`,
    });
  } else {
    // Day off: morning daylight from sunrise anchors the body clock.
    if (sunrise != null) {
      bands.push({
        id: "light",
        label: "Bright light",
        start: sunrise,
        end: (sunrise + 180) % 1440,
        reason: `Get daylight from ${fmtTime(sunrise)}. ${ANCHOR_WHY.offDayLight}`,
      });
    }
  }
  if (!shift && sunset != null) {
    // No shift: wind-down before typical sleep at sunset + 4h
    const targetSleep = (sunset + 4 * 60) % 1440;
    const windStart = (targetSleep - prefs.windDownMin + 1440) % 1440;
    bands.push({
      id: "wind",
      label: "Wind-down",
      start: windStart,
      end: targetSleep,
      reason: `${prefs.windDownMin} min wind-down before an estimated ${fmtTime(targetSleep)} bedtime (4h after local sunset, because no shift is set for today).`,
    });
    bands.push({
      id: "sleep",
      label: "Sleep",
      start: targetSleep,
      end: (targetSleep + prefs.sleepHours * 60) % 1440,
      reason: `Target ${prefs.sleepHours}h sleep.`,
    });
  }

  return { bands, markers };
}
