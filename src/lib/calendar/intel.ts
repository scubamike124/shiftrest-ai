// Slice 12 — Step 4 (Calendar Intelligence). Pure intel module.
//
// Turns a window of normalized events into the agenda DTO that briefs
// render, plus derived insights (early meeting → earlier bedtime,
// "leave 20 minutes earlier" combining first event + traffic delta).
//
// No IO. Safe to unit-test and import anywhere.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { IcsEvent } from "./ics";

export type CalendarPeriod = "morning" | "afternoon" | "evening";

export interface AgendaItem {
  uid: string;
  title: string;
  location: string | null;
  startISO: string;
  endISO: string;
  allDay: boolean;
  recurring: boolean;
  /** Calendar label (feed name). */
  source: string;
  /** Calendar color (hex) if the feed has one. */
  color: string | null;
}

export interface AgendaDTO {
  /** Local date for the agenda (ISO date, YYYY-MM-DD). */
  forDate: string;
  items: AgendaItem[];
  earlyMeeting: AgendaItem | null; // first item before 09:00 local
  nextItem: AgendaItem | null; // next upcoming after `now` (afternoon)
}

export interface LeaveEarlierHint {
  /** The first event the suggestion is anchored to. */
  event: AgendaItem;
  /** Extra minutes to leave earlier (>0). */
  extraMin: number;
  /** Plain-English one-liner ready for UI / voice. */
  suggestion: string;
}

const EARLY_MEETING_HOUR = 9;

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameLocalDate(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return localDateKey(d) === localDateKey(ref);
}

/**
 * Filter and order normalized events into an agenda for the period.
 *  - morning: today's events (sorted)
 *  - afternoon: today's events still upcoming after `now`
 *  - evening: tomorrow's events
 */
export function buildAgenda(
  events: ReadonlyArray<AgendaItem>,
  period: CalendarPeriod,
  now: Date,
): AgendaDTO {
  const ref = new Date(now);
  if (period === "evening") ref.setDate(ref.getDate() + 1);

  const today = events
    .filter((e) => sameLocalDate(e.startISO, ref))
    .sort((a, b) => a.startISO.localeCompare(b.startISO));

  let items = today;
  let nextItem: AgendaItem | null = null;
  if (period === "afternoon") {
    items = today.filter((e) => new Date(e.endISO).getTime() > now.getTime());
    nextItem =
      items.find((e) => new Date(e.startISO).getTime() > now.getTime())
        ?? null;
  }

  // Early-meeting detection only matters when previewing the next day
  // (evening brief) or when looking at today's first item (morning brief).
  let earlyMeeting: AgendaItem | null = null;
  if (period === "morning" || period === "evening") {
    const first = items.find((e) => !e.allDay) ?? null;
    if (first) {
      const startLocal = new Date(first.startISO);
      if (startLocal.getHours() < EARLY_MEETING_HOUR) {
        earlyMeeting = first;
      }
    }
  }

  return {
    forDate: localDateKey(ref),
    items: items.slice(0, 8),
    earlyMeeting,
    nextItem,
  };
}

/**
 * Combine the first calendar event with a traffic delta to produce the
 * "leave earlier" suggestion. Returns null when there's no event, no
 * baseline, or the delta is too small to be useful.
 */
export function deriveLeaveEarlierHint(input: {
  agenda: AgendaDTO;
  trafficCurrentMin: number | null;
  trafficBaselineMin: number | null;
}): LeaveEarlierHint | null {
  const target = input.agenda.nextItem ?? input.agenda.items[0] ?? null;
  if (!target || target.allDay) return null;
  if (input.trafficCurrentMin == null || input.trafficBaselineMin == null) return null;
  const delta = input.trafficCurrentMin - input.trafficBaselineMin;
  if (delta < 5) return null;
  const extra = Math.min(60, Math.round(delta));
  const timeStr = new Date(target.startISO).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return {
    event: target,
    extraMin: extra,
    suggestion: `Your ${timeStr} ${target.title} plus heavier traffic means you may want to leave about ${extra} minutes earlier.`,
  };
}

/**
 * Suggest a bedtime shift when an early meeting is detected.
 * Returns minutes to move bedtime earlier, capped at 60.
 */
export function bedtimeShiftForEarlyMeeting(early: AgendaItem | null): number {
  if (!early) return 0;
  const startHour = new Date(early.startISO).getHours();
  // < 7am → 60min earlier, < 8am → 30min, < 9am → 15min
  if (startHour < 7) return 60;
  if (startHour < 8) return 30;
  return 15;
}
