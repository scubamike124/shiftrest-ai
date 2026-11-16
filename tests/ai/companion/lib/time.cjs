/** Local-wall-clock helpers so scenarios read like real schedules ("night shift at 19:00"). */

function tzOffsetMs(utcMs, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

/** "2026-11-17T16:30" in tz -> epoch ms. */
function zoned(localIso, tz) {
  const [d, t = "00:00"] = localIso.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let ms = guess - tzOffsetMs(guess, tz);
  ms = guess - tzOffsetMs(ms, tz);
  return ms;
}

/** Local date (YYYY-MM-DD) of `nowLocal` shifted by `dayOffset`, at clock "HH:MM", as epoch ms. */
function at(nowLocal, tz, clock, dayOffset = 0) {
  const [d] = nowLocal.split("T");
  const base = new Date(`${d}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + dayOffset);
  return zoned(`${base.toISOString().slice(0, 10)}T${clock}`, tz);
}

const isoAt = (...args) => new Date(at(...args)).toISOString();

module.exports = { zoned, at, isoAt, tzOffsetMs };
