import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const moduleUrl = new URL("../src/lib/legal/date.ts", import.meta.url).href;
const dates = ["2026-06-27", "2026-11-15", "2024-02-29", "2027-01-01"];
const expected = ["June 27, 2026", "November 15, 2026", "February 29, 2024", "January 1, 2027"];

for (const timezone of ["UTC", "America/Chicago", "Pacific/Honolulu", "Pacific/Kiritimati"]) {
  test(`legal dates preserve the policy day and server text in ${timezone}`, () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { formatLegalDate } from ${JSON.stringify(moduleUrl)};
         process.stdout.write(JSON.stringify(${JSON.stringify(dates)}.map(formatLegalDate)));`,
      ],
      { encoding: "utf8", env: { ...process.env, TZ: timezone, LANG: "de_DE.UTF-8" } },
    );
    assert.deepEqual(JSON.parse(output), expected);
  });
}
