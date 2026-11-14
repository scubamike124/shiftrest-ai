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
//   AUDIT_SHOTS=<dir> for full-page screenshots, AUDIT_NO_FAIL=1 to always exit 0.
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
const routes = process.argv.slice(3).length ? process.argv.slice(3) : DEFAULT_ROUTES;
const VIEWPORTS = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 13/14", width: 390, height: 844 },
  { name: "iPhone Pro Max", width: 430, height: 932 },
];

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
  for (const route of routes) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e.message || e).slice(0, 200)));
    let status = 0;
    try {
      const res = await page.goto(base + route, { waitUntil: "load", timeout: 45000 });
      status = res ? res.status() : 0;
      await page.waitForTimeout(2500);
    } catch (e) {
      results.push({ viewport: vp.name, route, error: String(e.message || e).slice(0, 200) });
      failures++;
      await page.close();
      continue;
    }
    const data = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const clips = (el) => {
        for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.overflowX !== "visible" || cs.contain.includes("paint")) return true;
        }
        return false;
      };
      const describe = (el) => {
        const cls = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
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
        offenders.push({ el, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), position: cs.position });
      }
      let smallText = 0;
      const smallTextSamples = [];
      for (const el of all) {
        if (!el.childNodes.length) continue;
        const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (!hasText) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 12) {
          smallText++;
          if (smallTextSamples.length < 5) smallTextSamples.push(`${fs}px "${el.textContent.trim().slice(0, 40)}"`);
        }
      }
      let smallTargets = 0;
      const smallTargetSamples = [];
      for (const el of document.querySelectorAll("a[href], button, [role=button], input, select, textarea, [role=switch], [role=checkbox]")) {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // Inline text links inside running copy are exempt (WCAG 2.5.8 inline exception).
        if (el.tagName === "A" && cs.display === "inline" && el.closest("p, li")) continue;
        if (r.width < 44 || r.height < 44) {
          smallTargets++;
          if (smallTargetSamples.length < 8)
            smallTargetSamples.push(`${Math.round(r.width)}x${Math.round(r.height)} ${describe(el).slice(0, 60)} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}"`);
        }
      }
      return {
        clientWidth: vw,
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        visualScale: window.visualViewport ? window.visualViewport.scale : null,
        offenders: offenders.slice(0, 12).map((o) => ({ el: describe(o.el), left: o.left, right: o.right, width: o.width, position: o.position })),
        smallText,
        smallTextSamples,
        smallTargets,
        smallTargetSamples,
      };
    });
    const bad = data.scrollWidth > data.clientWidth + 1 || data.offenders.length > 0 || (data.visualScale && data.visualScale < 0.99);
    if (bad) failures++;
    results.push({ viewport: vp.name, width: vp.width, route, status, ok: !bad, consoleErrors: consoleErrors.slice(0, 3), ...data });
    console.log(
      `${bad ? "FAIL" : "ok  "} ${vp.width} ${route} status=${status} scrollWidth=${data.scrollWidth}/${data.clientWidth} inner=${data.innerWidth} scale=${data.visualScale} offenders=${data.offenders.length} smallText=${data.smallText} smallTargets=${data.smallTargets}`,
    );
    for (const o of data.offenders) console.log(`       offender ${o.el} [${o.left}..${o.right}] ${o.position}`);
    if (process.env.AUDIT_SHOTS) {
      fs.mkdirSync(process.env.AUDIT_SHOTS, { recursive: true });
      const name = `${vp.width}${route.replace(/[^a-z0-9]+/gi, "_")}.png`;
      await page
        .screenshot({ path: `${process.env.AUDIT_SHOTS}/${name}`, fullPage: true, scale: "css" })
        .catch(() => {});
    }
    await page.close();
  }
  await context.close();
}
await browser.close();
if (process.env.AUDIT_OUT) fs.writeFileSync(process.env.AUDIT_OUT, JSON.stringify(results, null, 2));
console.log(`${failures} failing route/viewport combinations`);
process.exitCode = process.env.AUDIT_NO_FAIL ? 0 : failures ? 1 : 0;
