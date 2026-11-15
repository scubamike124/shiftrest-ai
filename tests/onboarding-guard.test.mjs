import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/components/Onboarding.tsx", import.meta.url), "utf8");

test("onboarding waits for a real prefs fetch before opening", () => {
  // initialData makes isSuccess true immediately; without isFetched the consent
  // step flashes at already-onboarded users on a slow connection.
  assert.match(src, /initialData:\s*DEFAULT_PREFS/);
  assert.match(src, /isFetched/);
  assert.match(src, /const open = [^;]*isSuccess[^;]*isFetched[^;]*!prefs\.onboarded/);
});

test("onboarding is a labelled modal dialog with Back and Enter-to-continue", () => {
  assert.match(src, /DialogPrimitive\.Content/);
  assert.match(src, /DialogPrimitive\.Title/);
  assert.match(src, /onEscapeKeyDown=\{\(e\) => e\.preventDefault\(\)\}/);
  assert.match(src, />\s*Back\s*</);
  assert.match(src, /e\.key === "Enter"/);
  assert.match(src, /aria-label="Your first name"/);
});

test("onboarding step resume is storage-safe", () => {
  assert.match(src, /try \{[\s\S]*sessionStorage\.getItem\(STEP_KEY\)/);
  assert.match(src, /try \{[\s\S]*sessionStorage\.setItem\(STEP_KEY/);
});
