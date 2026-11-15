// The evening brief runs on a UTC server; its Smart Alarm and "tomorrow"
// window must use the user's zone. Live, a New York test account saw
// "Wake by 2:00 AM" / "Suggested bedtime 6:00 PM" (07:00 / 23:00 UTC).
process.env.TZ = "UTC";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { userTz, utcAtLocalDay } from "../src/lib/time/tz.ts";

test("default 7:00 wake is 7:00 in the user's zone, not 07:00 UTC", () => {
  const now = new Date("2026-11-15T04:55:00Z"); // Sat 23:55 in New York
  assert.equal(
    utcAtLocalDay(now, "America/New_York", 1, 7 * 60).toISOString(),
    "2026-11-15T12:00:00.000Z",
  );
  assert.equal(utcAtLocalDay(now, "America/New_York", 1).toISOString(), "2026-11-15T05:00:00.000Z");
  assert.equal(utcAtLocalDay(now, "America/New_York", 2).toISOString(), "2026-11-16T05:00:00.000Z");
  assert.equal(
    utcAtLocalDay(now, "Australia/Sydney", 1, 7 * 60).toISOString(),
    "2026-11-15T20:00:00.000Z",
  );
});

test("DST and month ends are handled", () => {
  // US spring-forward night: 7:00 on Sun 14 Mar 2027 is EDT (UTC-4).
  assert.equal(
    utcAtLocalDay(new Date("2027-03-14T03:00:00Z"), "America/New_York", 1, 7 * 60).toISOString(),
    "2027-03-14T11:00:00.000Z",
  );
  assert.equal(
    utcAtLocalDay(new Date("2026-11-30T20:00:00Z"), "America/Chicago", 1).toISOString(),
    "2026-12-01T06:00:00.000Z",
  );
});

test("userTz prefers the current zone, then home, then a valid fallback", () => {
  assert.equal(userTz("Europe/London", "America/New_York"), "Europe/London");
  assert.equal(userTz(null, "America/Denver"), "America/Denver");
  assert.equal(userTz("Not/AZone", "PST"), "America/Los_Angeles");
  assert.equal(userTz(null, null), "America/New_York");
});

test("evening brief uses the user's zone for its window, alarm and summary times", () => {
  const src = readFileSync(
    new URL("../src/lib/companion/evening-brief.functions.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(src, /setHours\(7/);
  assert.match(src, /utcAtLocalDay\(now, tz, 1, 7 \* 60\)/);
  assert.equal((src.match(/timeZone: tz/g) ?? []).length, 2);
});
