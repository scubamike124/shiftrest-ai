// Slice 12 — Step 4 (Calendar Intelligence). Pure ICS parser.
//
// Read-only iCalendar (RFC 5545) parser sized for a Worker SSR runtime.
// Supports:
//   - VEVENT blocks with DTSTART / DTEND / SUMMARY / LOCATION / UID
//   - Floating, UTC (Z), and TZID-annotated date-times (TZID treated as the
//     local wall-clock; offset honored when present in the string)
//   - All-day events (VALUE=DATE)
//   - Line unfolding (continuation lines that begin with a space/tab)
//   - Simple RRULE expansion (FREQ=DAILY|WEEKLY, INTERVAL, BYDAY, UNTIL,
//     COUNT) within a caller-supplied window. Anything more exotic falls
//     back to the dtstart only.
//
// No IO. Safe to unit-test.

export interface IcsEvent {
  uid: string;
  summary: string;
  location: string | null;
  /** ISO string. */
  startISO: string;
  /** ISO string. May equal start for zero-duration events. */
  endISO: string;
  allDay: boolean;
  /** True if this instance was generated from an RRULE. */
  recurring: boolean;
}

interface RawProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfoldLines(src: string): string[] {
  const lines = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const ln of lines) {
    if (!ln) continue;
    if ((ln.startsWith(" ") || ln.startsWith("\t")) && out.length) {
      out[out.length - 1] += ln.slice(1);
    } else {
      out.push(ln);
    }
  }
  return out;
}

function parseProp(line: string): RawProp | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf("=");
    if (eq < 0) continue;
    params[parts[i].slice(0, eq).toUpperCase()] = parts[i].slice(eq + 1);
  }
  return { name, params, value };
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Parse an ICS datetime string into a JS Date. */
function parseIcsDate(v: string, params: Record<string, string>): { date: Date; allDay: boolean } | null {
  // All-day: VALUE=DATE → YYYYMMDD
  if (params.VALUE === "DATE" || /^\d{8}$/.test(v)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return null;
    return {
      date: new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
      allDay: true,
    };
  }
  // Date-time: YYYYMMDDTHHMMSS[Z]
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) {
    return {
      date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)),
      allDay: false,
    };
  }
  // Floating / TZID local — treat as UTC wall-clock. Best we can do without
  // the VTIMEZONE table; callers that need true local wall-clock should pass
  // their own offset. Most real-world feeds use UTC or absolute offsets.
  return {
    date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)),
    allDay: false,
  };
}

const BYDAY_TO_IDX: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

function parseRRule(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

function expandRecurrence(
  base: IcsEvent,
  rrule: Record<string, string>,
  windowStart: Date,
  windowEnd: Date,
): IcsEvent[] {
  const out: IcsEvent[] = [];
  const freq = rrule.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY") {
    // Unsupported recurrence — return just the base instance if in window.
    const bs = new Date(base.startISO);
    if (bs >= windowStart && bs <= windowEnd) out.push(base);
    return out;
  }
  const interval = Math.max(1, parseInt(rrule.INTERVAL ?? "1", 10) || 1);
  const count = rrule.COUNT ? parseInt(rrule.COUNT, 10) : Infinity;
  const until = rrule.UNTIL
    ? parseIcsDate(rrule.UNTIL.replace(/Z$/, "Z"), {})?.date ?? null
    : null;
  const byDay = rrule.BYDAY
    ? rrule.BYDAY.split(",")
        .map((d) => BYDAY_TO_IDX[d.slice(-2)])
        .filter((n) => Number.isInteger(n))
    : null;

  const startDate = new Date(base.startISO);
  const endDate = new Date(base.endISO);
  const durMs = endDate.getTime() - startDate.getTime();

  let produced = 0;
  // Walk forward by (freq * interval) up to windowEnd. Cap iterations to keep
  // pathological feeds bounded.
  const stepMs =
    freq === "DAILY"
      ? interval * 24 * 60 * 60 * 1000
      : interval * 7 * 24 * 60 * 60 * 1000;
  const maxIter = 400;

  let cursor = new Date(startDate);
  for (let i = 0; i < maxIter; i++) {
    if (cursor > windowEnd) break;
    if (until && cursor > until) break;
    if (produced >= count) break;

    if (freq === "WEEKLY" && byDay && byDay.length > 0) {
      // Emit each BYDAY within this week.
      const weekStart = new Date(cursor);
      weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
      for (const idx of byDay) {
        const occ = new Date(weekStart);
        occ.setUTCDate(occ.getUTCDate() + idx);
        occ.setUTCHours(
          startDate.getUTCHours(),
          startDate.getUTCMinutes(),
          startDate.getUTCSeconds(),
          0,
        );
        if (occ < startDate) continue;
        if (occ > windowEnd) continue;
        if (until && occ > until) continue;
        if (occ >= windowStart) {
          out.push({
            ...base,
            startISO: occ.toISOString(),
            endISO: new Date(occ.getTime() + durMs).toISOString(),
            recurring: true,
          });
          produced += 1;
          if (produced >= count) break;
        }
      }
    } else {
      if (cursor >= windowStart) {
        out.push({
          ...base,
          startISO: cursor.toISOString(),
          endISO: new Date(cursor.getTime() + durMs).toISOString(),
          recurring: true,
        });
        produced += 1;
      }
    }
    cursor = new Date(cursor.getTime() + stepMs);
  }

  return out;
}

/**
 * Parse an ICS payload and return events that fall within [windowStart, windowEnd].
 * Bounded — never returns more than `cap` events to protect downstream UIs.
 */
export function parseIcs(
  src: string,
  windowStart: Date,
  windowEnd: Date,
  cap = 200,
): IcsEvent[] {
  const lines = unfoldLines(src);
  const events: IcsEvent[] = [];
  let inEvent = false;
  let cur: {
    uid?: string;
    summary?: string;
    location?: string;
    dtstart?: { date: Date; allDay: boolean };
    dtend?: { date: Date; allDay: boolean };
    rrule?: string;
  } = {};

  for (const ln of lines) {
    if (ln === "BEGIN:VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (ln === "END:VEVENT") {
      inEvent = false;
      if (cur.dtstart) {
        const startISO = cur.dtstart.date.toISOString();
        const endISO = (cur.dtend?.date ?? cur.dtstart.date).toISOString();
        const base: IcsEvent = {
          uid: cur.uid ?? `${startISO}-${cur.summary ?? "event"}`,
          summary: cur.summary ?? "(no title)",
          location: cur.location ?? null,
          startISO,
          endISO,
          allDay: cur.dtstart.allDay,
          recurring: false,
        };
        if (cur.rrule) {
          const expanded = expandRecurrence(
            base,
            parseRRule(cur.rrule),
            windowStart,
            windowEnd,
          );
          for (const e of expanded) {
            events.push(e);
            if (events.length >= cap) return events;
          }
        } else {
          const s = new Date(base.startISO);
          if (s >= windowStart && s <= windowEnd) {
            events.push(base);
            if (events.length >= cap) return events;
          }
        }
      }
      continue;
    }
    if (!inEvent) continue;
    const p = parseProp(ln);
    if (!p) continue;
    switch (p.name) {
      case "UID":
        cur.uid = p.value;
        break;
      case "SUMMARY":
        cur.summary = unescapeText(p.value);
        break;
      case "LOCATION":
        cur.location = unescapeText(p.value);
        break;
      case "DTSTART": {
        const d = parseIcsDate(p.value, p.params);
        if (d) cur.dtstart = d;
        break;
      }
      case "DTEND": {
        const d = parseIcsDate(p.value, p.params);
        if (d) cur.dtend = d;
        break;
      }
      case "RRULE":
        cur.rrule = p.value;
        break;
    }
  }

  return events.sort((a, b) => a.startISO.localeCompare(b.startISO));
}
