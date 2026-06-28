// Slice 8 — Quiet hours helper for Companion voice replies.
// Pure, no DOM/network. Handles wrap-around (e.g. 22:00 → 07:00).

export type QuietHours = { start: string; end: string } | null;

function toMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

export function inQuietHours(qh: QuietHours, now: Date = new Date()): boolean {
  if (!qh) return false;
  const start = toMin(qh.start);
  const end = toMin(qh.end);
  if (start == null || end == null) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end; // same-day window
  return cur >= start || cur < end; // wraps midnight
}
