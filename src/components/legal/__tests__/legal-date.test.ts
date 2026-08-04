/**
 * The effective date on a legal document.
 *
 * `toLocaleDateString(undefined, …)` caused two separate bugs from one line.
 *
 * A hydration mismatch — `undefined` means "this runtime's default locale",
 * which is the server's during SSR and the browser's during hydration. Every
 * legal page renders the date twice, so restpilotai.com/legal/privacy threw
 * exactly two uncaught React #418 errors on every visit.
 *
 * And a wrong date. The value was parsed as UTC midnight then formatted in the
 * runtime's timezone, so every reader west of UTC saw the day before the one
 * the document actually took effect on.
 *
 *   node --experimental-strip-types --test src/components/legal/__tests__/legal-date.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatLegalDate as formatDate } from "../../../lib/legal/format-date.ts";

test("the date shown is the date in the document, west of UTC", () => {
  // The regression that mattered: in Los Angeles this rendered "March 13, 2026"
  // for a document that took effect on the 14th.
  process.env.TZ = "America/Los_Angeles";
  assert.equal(formatDate("2026-03-14"), "March 14, 2026");
});

test("and east of UTC", () => {
  process.env.TZ = "Asia/Tokyo";
  assert.equal(formatDate("2026-03-14"), "March 14, 2026");
});

test("the output does not depend on the runtime's timezone", () => {
  // The hydration property, stated directly: a server in one zone and a browser
  // in another must produce the same text, or React tears the tree down.
  const zones = ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Australia/Sydney", "Pacific/Kiritimati"];
  const rendered = new Set(
    zones.map((tz) => {
      process.env.TZ = tz;
      return formatDate("2026-01-01");
    }),
  );
  assert.equal(rendered.size, 1, `the date rendered differently per timezone: ${[...rendered].join(" | ")}`);
});

test("a year boundary is not crossed", () => {
  // The worst case of the off-by-one: the wrong year on a legal document.
  process.env.TZ = "America/Los_Angeles";
  assert.equal(formatDate("2026-01-01"), "January 1, 2026");
});
