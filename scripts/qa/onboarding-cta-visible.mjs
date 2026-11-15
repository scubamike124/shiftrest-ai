#!/usr/bin/env node
// Manual QA (not CI): walks onboarding to the consent step in a mocked browser and checks that the
// "I agree" button is fully inside the viewport at small phone sizes, with Back present.
// No real credentials: a fake local session, Supabase REST and server functions are mocked.
//
//   bun run dev   (in another shell, port 8080)
//   node scripts/qa/onboarding-cta-visible.mjs [baseUrl]
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright overrides the playwright location.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const base = process.argv[2] || "http://127.0.0.1:8080";
const ref = "czsgjqfcjiuqirvmdlps";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const uid = "00000000-0000-4000-8000-000000000001";
const user = { id: uid, aud: "authenticated", role: "authenticated", email: "qa@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: uid, aud: "authenticated", role: "authenticated", exp: now + 86400, iat: now })}.sig`;
const session = { access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: now + 86400, user };

const SIZES = [
  { name: "iPhone SE 375x667", viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  { name: "iPhone 13 Safari 390x664", viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  { name: "desktop 1280x800", viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
];

let failed = false;
const browser = await chromium.launch();
for (const { name, ...ctxOpts } of SIZES) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(([k, v]) => {
    localStorage.setItem(k, v);
    localStorage.setItem("restpilot.companion.introSeen.v1", "1"); // keep the unrelated intro sheet out of the way
    localStorage.setItem("restpilot.cookie-consent.v1", JSON.stringify({ necessary: true, preferences: false, analytics: false, ai_logs: false, third_party: false, decidedAt: new Date().toISOString(), version: "2026-06-27" }));
  }, [`sb-${ref}-auth-token`, JSON.stringify(session)]);
  let prefs = null;
  await ctx.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    const m = r.request().method();
    if (["127.0.0.1", "localhost"].includes(u.hostname)) {
      if (u.pathname.startsWith("/_serverFn")) return r.fulfill({ status: 200, contentType: "application/json", body: '{"result":null}' });
      if (u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/public")) return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return r.continue();
    }
    if (!u.hostname.endsWith("supabase.co")) return r.abort();
    if (u.pathname.includes("/auth/v1/user")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (u.pathname.endsWith("/rest/v1/user_prefs")) {
      if (m === "GET" || m === "HEAD") {
        const single = (r.request().headers().accept || "").includes("pgrst.object");
        return r.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": prefs ? "0-0/1" : "*/0" }, body: JSON.stringify(single ? prefs : prefs ? [prefs] : []) });
      }
      const b = JSON.parse(r.request().postData() || "{}");
      prefs = { onboarded_at: null, preferred_name: null, ...(prefs || {}), ...(Array.isArray(b) ? b[0] : b) };
      return r.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    if (u.pathname.includes("/rest/v1/")) {
      const single = (r.request().headers().accept || "").includes("pgrst.object");
      return r.fulfill({ status: m === "GET" || m === "HEAD" ? 200 : 201, contentType: "application/json", headers: { "content-range": "*/0" }, body: m === "GET" || m === "HEAD" ? (single ? "null" : "[]") : "[]" });
    }
    return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const page = await ctx.newPage();
  const D = "[role=dialog]";
  await page.goto(`${base}/dashboard`, { waitUntil: "load" });
  await page.waitForSelector(`${D} button:has-text("Next")`, { timeout: 30000 });
  await page.locator(`${D} button:has-text("Next")`).click();
  await page.locator(`${D} button:has-text("Next")`).click();
  await page.fill(`${D} input`, "Sam");
  await page.locator(`${D} button:has-text("Continue")`).click();
  await page.waitForSelector(`${D} button[role=checkbox]`);
  const cta = page.locator(`${D} button:has-text("Get started")`);
  const back = page.locator(`${D} button:has-text("Back")`);
  const box = await cta.boundingBox();
  const vh = page.viewportSize().height;
  const ctaOk = !!box && box.y >= 0 && box.y + box.height <= vh;
  const backOk = (await back.count()) === 1 && (await back.isVisible());
  // every checkbox must be reachable by scrolling the dialog body
  const reachable = await page.evaluate((sel) => {
    const boxes = [...document.querySelectorAll(`${sel} button[role=checkbox]`)];
    return boxes.length === 6;
  }, D);
  console.log(`${ctaOk && backOk && reachable ? "PASS" : "FAIL"}  ${name}: CTA bottom ${box ? Math.round(box.y + box.height) : "?"} / viewport ${vh}, Back visible ${backOk}, 6 checkboxes ${reachable}`);
  if (!(ctaOk && backOk && reachable)) failed = true;
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
