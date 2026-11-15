// App Store Guideline 5.1.1/5.1.3: the privacy policy and the subprocessor
// list must say what the iPhone app really does (Apple Health, location,
// purchases). These scan the route sources, like ai-consent.test.mjs does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const flat = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const policy = flat(read("src/routes/legal.privacy.tsx"));
const policyRaw = read("src/routes/legal.privacy.tsx");
const third = read("src/routes/legal.third-parties.tsx");

test("privacy policy has a dedicated Apple Health section with the real facts", () => {
  assert.match(policyRaw, /id="apple-health"/);
  assert.match(policy, /sleep analysis, heart rate variability \(SDNN\) and resting heart rate/);
  assert.match(policy, /never writes anything to Apple Health/);
  assert.match(policy, /last 14 days/);
  assert.match(policy, /not sent to RestPilot's servers and is not included in what we send to AI/);
  assert.match(policy, /do not use Apple Health data for advertising or marketing, and we do not sell it/);
  assert.match(policy, /Disconnect/);
  assert.match(policy, /may be included in your iPhone backup/);
  assert.doesNotMatch(policy, /not stored in iCloud|does not store it in iCloud/i);
  assert.match(policy, /Apple Health summaries \(iPhone only\)/, "retention row");
});

test("location text says coordinates are stored and names every recipient", () => {
  assert.match(policy, /stored in your account/);
  assert.match(policy, /Open-Meteo/);
  assert.match(policy, /BigDataCloud receives the coordinates/);
  assert.match(policy, /OSRM/);
  assert.match(policy, /four decimal places, about 11 metres/);
  assert.match(policy, /do not track your location in the background/);
  assert.doesNotMatch(policy, /approximate latitude\/longitude/);
  for (const w of ["destination addresses", "calendar feed", "voice recordings", "Coach messages"])
    assert.match(policy, new RegExp(w));
});

test("review fixes: BigDataCloud auto lookup, OSRM origin, coach health details, contact form", () => {
  assert.match(third, /also automatically when we need a city name for a saved location/);
  assert.match(third, /your saved location and your saved destinations/);
  assert.doesNotMatch(third, /your current location or saved places/);
  assert.match(policy, /health or sleep details you choose to share in a message are stored/);
  assert.match(policy, /AI memories about your health/);
  assert.match(policy, /Contact form: if you write to us through the contact form, the name, email address and message/);
  assert.match(policyRaw, /PUBLISHING NOTE/);
});

test("local storage section covers the iPhone web view and Apple Health", () => {
  assert.match(policy, /iPhone app this storage is the app's own web view/);
});

test("third parties: RevenueCat, Apple, OSRM listed live; Apple Health and maps not 'planned'", () => {
  const active = third.slice(third.indexOf("const ACTIVE"), third.indexOf("const PLANNED"));
  for (const n of ["RevenueCat", "Apple (iPhone app)", "OSRM", "BigDataCloud", "Open-Meteo", "Stripe (website payments)"])
    assert.ok(active.includes(n), n);
  const planned = third.slice(third.indexOf("const PLANNED"), third.indexOf("export const Route"));
  for (const n of ["Apple Health", "Traffic", "Maps", "Calendar"])
    assert.ok(!planned.includes(n), `${n} must not be listed as planned`);
  assert.match(third, /Apple Health \(on your iPhone only\)/);
  assert.match(third, /existing connections only/);
});

test("payments text distinguishes Apple (iPhone) from Stripe (website)", () => {
  assert.match(policy, /on the website through Stripe, and in the iPhone app through Apple/);
});
