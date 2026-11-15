// Mobile layout audit: loads routes at iPhone viewports and reports anything
// that would make a phone browser zoom the page out ("miniature desktop page").
//
// For each route and viewport it records:
//   - document scroll width vs. the viewport width, and the visual viewport scale;
//   - the outermost elements whose box extends past the viewport and that no
//     ancestor (other than <html>/<body>) clips. iOS Safari does not clip the
//     layout viewport with overflow on <html>/<body>, so such elements widen the
//     page there even when Chromium hides them;
//   - visible text smaller than 12 CSS px, and interactive controls smaller than
//     44 x 44 CSS px (Apple HIG minimum hit target), as advisory counts.
//
// Usage: node scripts/qa/mobile-layout-audit.mjs <baseUrl> [route ...]
//   PW_BROWSER=webkit|chromium (default chromium), AUDIT_OUT=<json path>,
//   AUDIT_SHOTS=<dir> for full-page screenshots (AUDIT_SLICES=<n> for n screen-sized ones), AUDIT_NO_FAIL=1 to always exit 0.
//   PLAYWRIGHT_MODULE=<path to playwright entry> when playwright is not resolvable.
import fs from "node:fs";

const base = (process.argv[2] || "http://127.0.0.1:3000").replace(/\/$/, "");
const DEFAULT_ROUTES = [
  "/",
  "/pricing",
  "/auth",
  "/paywall",
  "/features",
  "/science",
  "/safety",
  "/contact",
  "/legal",
  "/legal/privacy",
  "/legal/terms",
  "/legal/cookies",
  "/legal/third-parties",
  "/reset-password",
];
const VIEWPORTS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 13/14", width: 390, height: 844 },
  { name: "iPhone Pro Max", width: 430, height: 932 },
];

// Signed-in app screens, for a LOCAL build made with placeholder Supabase values only:
// AUDIT_FAKE_SESSION=1 plants a fake session in localStorage and answers every
// request to the placeholder Supabase host with empty data, so screens render
// their empty/loading states. No real backend or account is involved.
const APP_ROUTES = [
  "/dashboard",
  "/companion",
  "/pilot",
  "/plan",
  "/sleep",
  "/coach",
  "/events",
  "/swap",
  "/health",
  "/memory",
  "/decisions",
  "/playbooks",
  "/profile",
  "/settings",
  "/paywall",
];
const FAKE = process.env.AUDIT_FAKE_SESSION === "1";
if (FAKE && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  // The fake session is for a local placeholder build only; never point it at a real site.
  console.error(
    "AUDIT_FAKE_SESSION=1 is only allowed against http://localhost or http://127.0.0.1",
  );
  process.exit(2);
}
const routes = process.argv.slice(3).length
  ? process.argv.slice(3)
  : FAKE
    ? APP_ROUTES
    : DEFAULT_ROUTES;
const PLACEHOLDER_HOST = process.env.AUDIT_SUPABASE_HOST || "placeholder.supabase.co";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const fakeUser = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "layout-audit@example.com",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Layout Audit" },
  created_at: "2026-01-01T00:00:00Z",
};
const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
const fakeToken = `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: fakeUser.id, role: "authenticated", aud: "authenticated", email: fakeUser.email, exp })}.c2ln`;
const fakeSession = {
  access_token: fakeToken,
  token_type: "bearer",
  expires_in: 7 * 86400,
  expires_at: exp,
  refresh_token: "audit",
  user: fakeUser,
};
// An onboarded user, so the first-run dialog does not cover the screen under test.
const FAKE_PREFS = {
  wind_down_min: 45,
  sleep_hours: 7.5,
  notifications: false,
  low_light: false,
  lat: 40.71,
  lon: -74.0,
  location_label: "New York",
  partner_name: "",
  preferred_name: "Sam",
  onboarded_at: "2026-01-01T00:00:00Z",
  cycle_weeks: 1,
  cycle_anchor: null,
  assistant_name: "RestPilot",
  assistant_mode: "coach",
};
const SAMPLE_SHIFTS = [
  [0, 19 * 60, 7 * 60, "ICU nights"],
  [1, 19 * 60, 7 * 60, "ICU nights"],
  [2, 19 * 60, 7 * 60, "ICU nights"],
  [4, 7 * 60, 19 * 60, "Day shift"],
  [6, 7 * 60, 19 * 60, "Day shift"],
].map(([day, start, end, title], i) => ({
  id: `00000000-0000-4000-8000-00000000010${i}`,
  day,
  week_index: 0,
  start_min: start,
  end_min: end,
  employer_id: null,
  title,
  notes: null,
}));
async function installFakeBackend(context) {
  const key = `sb-${PLACEHOLDER_HOST.split(".")[0]}-auth-token`;
  await context.addInitScript(
    ([k, v]) => {
      try {
        localStorage.setItem(k, v);
        localStorage.setItem("restpilot.companion.introSeen.v1", "1");
        // Cookie choice already made (all optional cookies off), so the banner does not cover the screen.
        localStorage.setItem(
          "restpilot.cookie-consent.v1",
          JSON.stringify({
            necessary: true,
            preferences: false,
            analytics: false,
            ai_logs: false,
            third_party: false,
            decidedAt: "2026-01-01T00:00:00Z",
            version: "2026-06-27",
          }),
        );
      } catch {}
    },
    [key, JSON.stringify(fakeSession)],
  );
  await context.route(`https://${PLACEHOLDER_HOST}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.startsWith("/auth/v1/user")) return json(200, fakeUser);
    if (url.pathname.startsWith("/auth/v1/token")) return json(200, fakeSession);
    if (url.pathname.startsWith("/auth/v1/logout")) return route.fulfill({ status: 204, body: "" });
    if (url.pathname === "/rest/v1/user_prefs" && req.method() === "GET")
      return json(200, [FAKE_PREFS]);
    // AUDIT_SAMPLE_SHIFTS=1: a typical nurse rotation, so schedule screens show real content.
    if (
      url.pathname === "/rest/v1/shifts" &&
      req.method() === "GET" &&
      process.env.AUDIT_SAMPLE_SHIFTS === "1"
    )
      return json(200, SAMPLE_SHIFTS);
    if (url.pathname.startsWith("/rest/v1/")) {
      if (req.method() === "HEAD")
        return route.fulfill({ status: 200, headers: { "content-range": "0-0/0" }, body: "" });
      if ((req.headers()["accept"] || "").includes("vnd.pgrst.object"))
        return json(406, {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
          details: "0 rows",
          hint: null,
        });
      return json(req.method() === "GET" ? 200 : 201, []);
    }
    return json(200, {});
  });
}

const pw = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browserType = pw[process.env.PW_BROWSER || "chromium"];
const browser = await browserType.launch();
const results = [];
let failures = 0;

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 3,
    isMobile: (process.env.PW_BROWSER || "chromium") !== "firefox",
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  if (FAKE) await installFakeBackend(context);
  // AUDIT_THEME=<id> (and AUDIT_MATCH_SYSTEM=1) picks the Appearance theme first.
  if (process.env.AUDIT_THEME)
    await context.addInitScript(
      ([theme, match]) => {
        try {
          localStorage.setItem(
            "restpilot.appearance.v1",
            JSON.stringify({ theme, matchSystem: match }),
          );
        } catch {}
      },
      [process.env.AUDIT_THEME, process.env.AUDIT_MATCH_SYSTEM === "1"],
    );
  for (const route of routes) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e.message || e).slice(0, 200)));
    let status = 0;
    try {
      const res = await page.goto(base + route, { waitUntil: "load", timeout: 45000 });
      status = res ? res.status() : 0;
      await page.waitForTimeout(FAKE ? 6000 : 2500);
    } catch (e) {
      results.push({ viewport: vp.name, route, error: String(e.message || e).slice(0, 200) });
      failures++;
      await page.close();
      continue;
    }
    const data = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const clips = (el) => {
        for (
          let a = el.parentElement;
          a && a !== document.body && a !== document.documentElement;
          a = a.parentElement
        ) {
          const cs = getComputedStyle(a);
          if (cs.overflowX !== "visible" || cs.contain.includes("paint")) return true;
        }
        return false;
      };
      const describe = (el) => {
        const cls =
          typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
        return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cls ? "." + cls.trim().split(/\s+/).slice(0, 6).join(".") : ""}`;
      };
      const offenders = [];
      const all = Array.from(document.body.querySelectorAll("*"));
      for (const el of all) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right <= vw + 1 && r.left >= -1) continue;
        if (cs.position === "fixed" && r.left >= -1 && r.right <= vw + 1) continue;
        if (clips(el)) continue;
        // Report only the outermost offender of each subtree.
        if (offenders.some((o) => o.el.contains(el))) continue;
        offenders.push({
          el,
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          position: cs.position,
        });
      }
      let smallText = 0;
      const smallTextSamples = [];
      for (const el of all) {
        if (!el.childNodes.length) continue;
        const hasText = Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 1,
        );
        if (!hasText) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) {
          smallText++;
          if (smallTextSamples.length < 5)
            smallTextSamples.push(`${fs}px "${el.textContent.trim().slice(0, 40)}"`);
        }
      }
      let smallTargets = 0;
      const smallTargetSamples = [];
      for (const el of document.querySelectorAll(
        "a[href], button, [role=button], input, select, textarea, [role=switch], [role=checkbox]",
      )) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // Inline text links inside running copy are exempt (WCAG 2.5.8 inline exception).
        if (el.tagName === "A" && cs.display === "inline" && el.closest("p, li")) continue;
        // Controls with the `hit-area` utility get an invisible 44 x 44 pt touch box.
        if (el.classList.contains("hit-area")) continue;
        if (r.width < 44 || r.height < 44) {
          smallTargets++;
          if (smallTargetSamples.length < 8)
            smallTargetSamples.push(
              `${Math.round(r.width)}x${Math.round(r.height)} ${describe(el).slice(0, 60)} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}"`,
            );
        }
      }
      return {
        clientWidth: vw,
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        visualScale: window.visualViewport ? window.visualViewport.scale : null,
        offenders: offenders.slice(0, 12).map((o) => ({
          el: describe(o.el),
          left: o.left,
          right: o.right,
          width: o.width,
          position: o.position,
        })),
        smallText,
        smallTextSamples,
        smallTargets,
        smallTargetSamples,
      };
    });
    const bad =
      data.scrollWidth > data.clientWidth + 1 ||
      data.offenders.length > 0 ||
      (data.visualScale && data.visualScale < 0.99);
    if (bad) failures++;
    results.push({
      viewport: vp.name,
      width: vp.width,
      route,
      status,
      ok: !bad,
      consoleErrors: consoleErrors.slice(0, 3),
      ...data,
    });
    console.log(
      `${bad ? "FAIL" : "ok  "} ${vp.width} ${route} status=${status} scrollWidth=${data.scrollWidth}/${data.clientWidth} inner=${data.innerWidth} scale=${data.visualScale} offenders=${data.offenders.length} smallText=${data.smallText} smallTargets=${data.smallTargets}`,
    );
    for (const o of data.offenders)
      console.log(`       offender ${o.el} [${o.left}..${o.right}] ${o.position}`);
    if (process.env.AUDIT_SHOTS) {
      fs.mkdirSync(process.env.AUDIT_SHOTS, { recursive: true });
      const name = `${vp.width}${route.replace(/[^a-z0-9]+/gi, "_")}`;
      if (process.env.AUDIT_SLICES) {
        // Screen-sized slices, as a phone shows them (max N per route).
        const total = await page.evaluate(() => document.documentElement.scrollHeight);
        for (
          let i = 0, y = 0;
          y < total && i < Number(process.env.AUDIT_SLICES);
          i++, y += vp.height
        ) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          await page.waitForTimeout(250);
          await page
            .screenshot({ path: `${process.env.AUDIT_SHOTS}/${name}-${i}.png`, scale: "css" })
            .catch(() => {});
        }
      } else {
        await page
          .screenshot({
            path: `${process.env.AUDIT_SHOTS}/${name}.png`,
            fullPage: true,
            scale: "css",
          })
          .catch(() => {});
      }
    }
    await page.close();
  }
  await context.close();
}
await browser.close();
if (process.env.AUDIT_OUT)
  fs.writeFileSync(process.env.AUDIT_OUT, JSON.stringify(results, null, 2));
console.log(`${failures} failing route/viewport combinations`);
process.exitCode = process.env.AUDIT_NO_FAIL ? 0 : failures ? 1 : 0;
