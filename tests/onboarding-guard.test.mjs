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
  assert.match(src, /try \{[\s\S]*sessionStorage\.getItem\(stepKey\(uid\)\)/);
  assert.match(src, /try \{[\s\S]*sessionStorage\.setItem\(stepKey\(uid\)/);
});

test("paywall plan cards expose their selected state", () => {
  const paywall = readFileSync(new URL("../src/routes/paywall.tsx", import.meta.url), "utf8");
  assert.match(paywall, /aria-pressed=\{!!selected\}/);
});

// ---- Consent gating: these pin the guards that stop a user finishing onboarding
// without ticking every acknowledgement. Removing any of them must fail a test.

const finishBody = (() => {
  const start = src.indexOf("async function finish()");
  const end = src.indexOf("async function advance()");
  assert.ok(start > 0 && end > start, "finish() not found");
  return src.slice(start, end);
})();

test("all six acknowledgements exist and allAcked requires every one", () => {
  const items = src.match(/\{ key: "[a-z]+", label: "/g) ?? [];
  assert.equal(items.length, 6);
  assert.match(src, /const allAcked = ACK_ITEMS\.every\(\(i\) => acks\[i\.key\]\);/);
});

test("finish() refuses unless every acknowledgement is ticked", () => {
  assert.match(finishBody, /if \(!allAcked \|\| busy\) return;/);
  // the guard must come before any write
  assert.ok(finishBody.indexOf("!allAcked") < finishBody.indexOf("recordAcceptanceFn"));
  assert.ok(finishBody.indexOf("!allAcked") < finishBody.indexOf("markOnboarded"));
});

test("the consent CTA is disabled until every acknowledgement is ticked", () => {
  assert.match(
    src,
    /disabled=\{busy \|\| \(isConsentStep && !allAcked\) \|\| \(isNameStep && !nameOk\)\}/,
  );
});

test("the only route to finish() is the consent step, so Enter cannot skip consent", () => {
  const advance = src.slice(src.indexOf("async function advance()"), src.indexOf("return (\n    <DialogPrimitive.Root"));
  const calls = advance.match(/await finish\(\)/g) ?? [];
  assert.equal(calls.length, 1);
  assert.match(advance, /if \(isConsentStep\) \{\s*await finish\(\);\s*return;\s*\}/);
  // Enter handling lives only on the name input and ignores IME composition
  assert.equal((src.match(/e\.key === "Enter"/g) ?? []).length, 1);
  assert.match(src, /e\.key === "Enter" && !e\.nativeEvent\.isComposing/);
});

test("acceptance is recorded first with the onboarding payload, then onboarding is marked", () => {
  assert.match(src, /const ONBOARDING_DOCS = \["terms", "privacy", "disclaimers", "safety", "electronic-consent"\];/);
  assert.match(
    finishBody,
    /await recordAcceptanceFn\(\{\s*data: \{\s*documents: ONBOARDING_DOCS,\s*source: "onboarding",\s*flags: \{ onboarding_ack: new Date\(\)\.toISOString\(\) \},\s*\},\s*\}\);/,
  );
  assert.ok(finishBody.indexOf("recordAcceptanceFn(") < finishBody.indexOf("await markOnboarded()"));
  assert.ok(finishBody.indexOf("await markOnboarded()") < finishBody.indexOf("setDismissed(true)"));
});

test("a failed save keeps the gate closed: error toast, no dismissal", () => {
  const catchBlock = finishBody.slice(finishBody.indexOf("} catch (err)"), finishBody.indexOf("} finally"));
  assert.match(catchBlock, /toast\.error\(/);
  assert.doesNotMatch(catchBlock, /setDismissed\(true\)/);
  assert.doesNotMatch(catchBlock, /markOnboarded/);
  assert.match(finishBody, /\} finally \{\s*setBusy\(false\);/);
});

test("the dialog body scrolls and the CTA stays reachable on short phones", () => {
  assert.match(src, /max-h-\[100dvh\]/);
  assert.match(src, /min-h-0 flex-1 overflow-y-auto/);
  assert.match(src, /flex shrink-0 flex-col gap-4 px-6 pb-\[calc\(env\(safe-area-inset-bottom\)\+1\.5rem\)\]/);
  // Back must not sit in the footer above the CTA (it pushed the CTA off 375x667)
  const footer = src.slice(src.indexOf("flex shrink-0 flex-col gap-4"));
  assert.doesNotMatch(footer.slice(0, footer.indexOf("onClick={advance}")), /Back/);
});

test("step resume is namespaced per user", () => {
  assert.match(src, /const stepKey = \(uid: string \| null \| undefined\) => `\$\{STEP_KEY\}:\$\{uid \?\? "anon"\}`;/);
});
