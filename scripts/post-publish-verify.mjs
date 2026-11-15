#!/usr/bin/env node
// Post-publish verification for restpilotai.com (read-only).
//
// Sends HTTP GET requests only. No POST, no sign-in, no cookies, no writes, no
// credentials, no dependencies beyond Node 18+ built-ins. Run from a laptop,
// from the "Post-publish verify" GitHub Actions workflow, or locally against a
// build of main:
//
//   node scripts/post-publish-verify.mjs
//   node scripts/post-publish-verify.mjs --base http://127.0.0.1:4391
//   node scripts/post-publish-verify.mjs --json
//
// Exit code 0 = every check passed (WARN does not fail). 1 = at least one FAIL.
//
// Limits of this script (read before trusting a PASS):
//  - It only fetches the JS chunks referenced from the INITIAL HTML of /, /pricing,
//    /paywall, /safety and /coach. Dynamically imported chunks that those pages do
//    not preload are not inspected.
//  - The lifetime-string check inspects the pricing, paywall and billing.functions
//    chunks by file name. If a future build renames or merges them, the check says
//    which chunks it inspected; a lifetime string in a differently named chunk would
//    be missed (the HTML checks would still catch server-rendered text).
//  - If almost every request returns HTTP 403, a firewall (for example Cloudflare)
//    is blocking the machine running this, NOT a bad build. Use the manual checks.
//  - The dry runs recorded in the release doc were run from a developer sandbox,
//    NOT from a GitHub Actions runner.
//
// What it cannot prove (needs a signed-in human, see RELEASE-2026-11-PUBLISH.md
// section 8): an existing lifetime subscriber still being Premium, the database
// migrations, voice disabled, Stripe webhook delivery, the iPhone UI itself.

import process from "node:process";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = opt("--base", "https://restpilotai.com").replace(/\/+$/, "");
// The Aug 17 2026 build that is live before this release.
const OLD_BUILD_ID = opt("--old-build-id", "b-1786931160964");
const OLD_DEPLOYMENT_ID = opt(
  "--old-deployment-id",
  "119d568c0ca7e3cb02accde0644f22f92de79f0b38e4493f767d9f368bb0a5b3",
);
const EXPECT_HOST = new URL(BASE).host;
const AS_JSON = flag("--json");
const TIMEOUT_MS = 25_000;
const UA = "restpilot-post-publish-verify/1.0 (read-only GET)";

const results = []; // { name, status: PASS|FAIL|WARN, detail }
const add = (name, status, detail = "") => results.push({ name, status, detail });
const pass = (n, d) => add(n, "PASS", d);
const fail = (n, d) => add(n, "FAIL", d);
const warn = (n, d) => add(n, "WARN", d);

async function get(path, { bust = false } = {}) {
  const url = new URL(path.startsWith("http") ? path : BASE + path);
  if (bust) url.searchParams.set("_verify", String(Date.now()));
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": UA, "cache-control": "no-cache", accept: "*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    return { ok: true, status: res.status, headers: res.headers, text, url: res.url };
  } catch (err) {
    return { ok: false, status: 0, headers: new Headers(), text: "", error: String(err?.message ?? err) };
  }
}

const assetsIn = (html) => [...new Set([...html.matchAll(/\/assets\/[A-Za-z0-9_.\-]+\.js/g)].map((m) => m[0]))];
const snippet = (text, re, n = 50) => {
  const m = re.exec(text);
  if (!m) return "";
  const s = Math.max(0, m.index - n);
  return JSON.stringify(text.slice(s, m.index + m[0].length + n));
};

// ---------------------------------------------------------------- 1. build id
const version = await get("/api/public/version", { bust: true });
let buildId = null;
if (version.status === 200) {
  try {
    buildId = JSON.parse(version.text).buildId ?? null;
  } catch {
    /* handled below */
  }
}
if (!buildId) {
  fail("build id readable (/api/public/version)", `HTTP ${version.status} ${version.error ?? ""}`.trim());
} else if (buildId === OLD_BUILD_ID) {
  fail("build id differs from Aug 17 build", `still ${buildId}: the publish did not take effect (or the CDN is stale)`);
} else {
  pass("build id differs from Aug 17 build", `${OLD_BUILD_ID} -> ${buildId}`);
}

const deployId = version.headers.get("x-deployment-id");
if (!deployId) {
  warn("x-deployment-id differs from Aug 17 deployment", "header not present (normal on a local build, unexpected on production)");
} else if (deployId === OLD_DEPLOYMENT_ID) {
  fail("x-deployment-id differs from Aug 17 deployment", `still ${deployId.slice(0, 16)}...`);
} else {
  pass("x-deployment-id differs from Aug 17 deployment", `${deployId.slice(0, 16)}...`);
}

const sw = await get("/sw.js", { bust: true });
if (sw.status !== 200) {
  warn("sw.js carries the new build id", `HTTP ${sw.status} (service worker not served here)`);
} else if (sw.text.includes(OLD_BUILD_ID)) {
  fail("sw.js carries the new build id", `sw.js still contains the old build ${OLD_BUILD_ID}`);
} else if (buildId && sw.text.includes(buildId)) {
  pass("sw.js carries the new build id", buildId);
} else {
  warn("sw.js carries the new build id", "old id absent but new id not found in sw.js (cache name may be hashed)");
}

// ------------------------------------------------------------------- 2. health
const health = await get("/api/public/health", { bust: true });
let healthOk = false;
try {
  healthOk = health.status === 200 && JSON.parse(health.text).ok === true;
} catch {
  /* ignore */
}
healthOk ? pass("/api/public/health 200 ok:true") : fail("/api/public/health 200 ok:true", `HTTP ${health.status} ${health.error ?? health.text.slice(0, 80)}`);

// ------------------------------------------------- 3. pages + their JS bundles
const PAGES = ["/", "/pricing", "/paywall", "/safety", "/coach"];
const pages = {};
for (const p of PAGES) pages[p] = await get(p, { bust: true });
for (const p of PAGES) {
  if (pages[p].status !== 200) fail(`page ${p} returns 200`, `HTTP ${pages[p].status} ${pages[p].error ?? ""}`.trim());
}

// Existing lifetime members are explained in one renewal-disclosure sentence on
// /paywall ("Lifetime purchases (no longer sold) ..."). That phrase is the only
// allowed use of the word on the plan pages.
const ALLOWED_LIFETIME = /Existing Lifetime purchases \(no longer sold\)|Lifetime purchases \(no longer sold\)/g;
const PLAN_PAGES = ["/pricing", "/paywall"];
const FORBIDDEN_HTML = [
  ["$99", /\$\s?99\b/],
  ["Founding Member", /Founding Member/i],
  ["restpilot_lifetime", /restpilot_lifetime/],
  ["Lifetime", /lifetime/i],
];
for (const p of PLAN_PAGES) {
  const html = (pages[p].text || "").replace(ALLOWED_LIFETIME, "");
  if (pages[p].status !== 200) continue;
  const hits = FORBIDDEN_HTML.filter(([, re]) => re.test(html));
  if (hits.length === 0) pass(`${p} HTML has no lifetime offer`, "no Lifetime / $99 / Founding Member / restpilot_lifetime");
  else fail(`${p} HTML has no lifetime offer`, hits.map(([n, re]) => `${n} ${snippet(html, re, 30)}`).join("; "));
}
// "$99" or Founding Member on the home page or the other pages as well.
for (const p of ["/", "/safety", "/coach"]) {
  if (pages[p].status !== 200) continue;
  const html = pages[p].text.replace(ALLOWED_LIFETIME, "");
  const bad = [/\$\s?99\b/, /Founding Member\s*[—-]\s*Limited/i, /restpilot_lifetime/].find((re) => re.test(html));
  bad ? fail(`${p} HTML has no lifetime offer`, snippet(html, bad, 30)) : pass(`${p} HTML has no lifetime offer`);
}

// Fetch every JS chunk those pages reference.
const chunkPaths = new Set();
for (const p of PAGES) for (const a of assetsIn(pages[p].text || "")) chunkPaths.add(a);
const chunks = {};
{
  const queue = [...chunkPaths];
  const worker = async () => {
    while (queue.length) {
      const a = queue.shift();
      chunks[a] = await get(a);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}
const chunkEntries = Object.entries(chunks);
const failedChunks = chunkEntries.filter(([, r]) => r.status !== 200);
chunkEntries.length > 0 && failedChunks.length === 0
  ? pass("referenced JS bundles load", `${chunkEntries.length} files`)
  : fail("referenced JS bundles load", `${chunkEntries.length} found, ${failedChunks.length} failed: ${failedChunks.slice(0, 3).map(([a, r]) => `${a} ${r.status}`).join(", ")}`);

// Any bundle: the discontinued offer's literals must be gone.
const ANY_BUNDLE_FORBIDDEN = [
  ["$99 price literal", /\$99\b/],
  ["Founding Member - Limited", /Founding Member\s*[—-]\s*Limited/],
  ['one-time cadence ( cadence:"one-time" )', /cadence\s*:\s*["']one-time["']/],
];
// Pricing / paywall / billing route chunks must not mention lifetime at all
// (the shared `subscription` chunk and the native notice keep the word for
// existing members, by design, so they are not in this list).
const OFFER_CHUNK = /\/assets\/(pricing|paywall|billing\.functions)-[A-Za-z0-9_\-]+\.js$/;
const OFFER_FORBIDDEN = [
  ["restpilot_lifetime", /restpilot_lifetime/],
  ["Founding Member", /Founding Member/],
  ["Lifetime", /lifetime/i],
];
{
  const hits = [];
  for (const [a, r] of chunkEntries) {
    const text = r.text.replace(ALLOWED_LIFETIME, "");
    for (const [n, re] of ANY_BUNDLE_FORBIDDEN) if (re.test(text)) hits.push(`${a.split("/").pop()}: ${n}`);
    if (OFFER_CHUNK.test(a)) for (const [n, re] of OFFER_FORBIDDEN) if (re.test(text)) hits.push(`${a.split("/").pop()}: ${n}`);
  }
  const inspected = chunkEntries.filter(([a]) => OFFER_CHUNK.test(a)).map(([a]) => a.split("/").pop());
  const need = ["pricing", "paywall", "billing.functions"];
  const missing = need.filter((n) => !inspected.some((f) => f.startsWith(n + "-")));
  if (missing.length > 0) fail("JS bundles contain no lifetime offer", `could not inspect: ${missing.join(", ")} chunk(s) (inspected: ${inspected.join(", ") || "none"})`);
  else if (hits.length === 0) pass("JS bundles contain no lifetime offer", `${chunkEntries.length} bundles; inspected ${inspected.join(", ")}`);
  else fail("JS bundles contain no lifetime offer", hits.slice(0, 6).join("; "));
}

// ------------------------------------------------------- 4. consent and crisis
const allJs = chunkEntries.map(([, r]) => r.text).join("\n");
/ai_consent/.test(allJs)
  ? pass("AI consent gate present in bundles", "ai_consent / ai_consent_required found")
  : fail("AI consent gate present in bundles", "ai_consent not found in any referenced bundle (old build?)");

/x-crisis-support/.test(allJs)
  ? pass("crisis server-guard marker present in client", "x-crisis-support handled by coach/companion/pilot")
  : fail("crisis server-guard marker present in client", "x-crisis-support not found in coach/companion bundles (old build?)");

// NOTE: the old build also shows 988 on /safety, so this check cannot tell old
// from new. The new-build signals are x-crisis-support above and ai_consent.
const safetyText = pages["/safety"].text + "\n" + assetsIn(pages["/safety"].text).map((a) => chunks[a]?.text ?? "").join("\n");
/\b988\b/.test(safetyText)
  ? pass("crisis line 988 shown on /safety (not a new-build signal)", "/safety HTML and its own chunks")
  : fail("crisis line 988 shown on /safety (not a new-build signal)", "no 988 in /safety HTML or its chunks");

// ------------------------------------------------------------------ 5. Reelo
{
  const hay = Object.values(pages).map((r) => r.text).join("\n") + "\n" + allJs;
  /Reelo/i.test(hay) ? fail("no 'Reelo' product name", snippet(hay, /Reelo/i)) : pass("no 'Reelo' product name", "pages and bundles");
}

// --------------------------------------------------------- 6. robots + sitemap
const robots = await get("/robots.txt", { bust: true });
{
  const m = /^\s*Sitemap:\s*(\S+)/im.exec(robots.text);
  if (robots.status !== 200 || !m) fail("robots.txt sitemap host correct", `HTTP ${robots.status}, no Sitemap line`);
  else {
    let host = "";
    try {
      host = new URL(m[1]).host;
    } catch {
      /* ignore */
    }
    const wantHost = EXPECT_HOST.replace(/^www\./, "");
    host.replace(/^www\./, "") === wantHost || host === "restpilotai.com"
      ? pass("robots.txt sitemap host correct", m[1])
      : fail("robots.txt sitemap host correct", `${m[1]} (expected restpilotai.com)`);
  }
}
const sitemap = await get("/sitemap.xml", { bust: true });
{
  const locs = [...sitemap.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
  const wrong = locs.filter((l) => !/^https:\/\/(www\.)?restpilotai\.com\//.test(l));
  sitemap.status === 200 && locs.length > 0 && wrong.length === 0
    ? pass("sitemap.xml 200, all URLs on restpilotai.com", `${locs.length} urls`)
    : warn("sitemap.xml 200, all URLs on restpilotai.com", `HTTP ${sitemap.status}, ${locs.length} urls, off-host: ${wrong.slice(0, 2).join(", ")}`);
}

// ------------------------------------------------------------- 7. legal pages
const LEGAL = [
  ["/legal/privacy", "Privacy Policy"],
  ["/legal/terms", "Terms of Service"],
  ["/legal/subscription", "Subscription Terms"],
  ["/legal/third-parties", "Subprocessors"],
  ["/legal/disclaimers", "Disclaimers"],
];
for (const [p, heading] of LEGAL) {
  const r = await get(p);
  if (r.status !== 200) fail(`legal page ${p} 200`, `HTTP ${r.status} ${r.error ?? ""}`.trim());
  else if (!/<title>[^<]*RestPilot AI/.test(r.text) || !r.text.includes(heading)) fail(`legal page ${p} 200`, `HTTP 200 but title/heading "${heading}" not found (error page?)`);
  else pass(`legal page ${p} 200`, `title and "${heading}" heading found`);
}
{
  // New in this release: the privacy policy section about AI providers and permission.
  const r = await get("/legal/privacy");
  r.text.includes("AI providers and your permission")
    ? pass("privacy policy has the AI providers and permission section")
    : fail("privacy policy has the AI providers and permission section", "section heading not found (old policy?)");
}
{
  const r = await get("/settings/privacy");
  r.status === 200 && /<title>Privacy \| RestPilot AI<\/title>/.test(r.text)
    ? pass("/settings/privacy (AI data sharing switch) 200", "title found")
    : fail("/settings/privacy (AI data sharing switch) 200", `HTTP ${r.status}${r.status === 200 ? " but wrong page title" : ""} (page ships with the consent release)`);
}

// ------------------------------------------------------------------- report
const http403 = [version, health, robots, sitemap, sw, ...Object.values(pages)].filter((r) => r.status === 403).length;
const w = Math.max(...results.map((r) => r.name.length));
const failed = results.filter((r) => r.status === "FAIL").length;
const warned = results.filter((r) => r.status === "WARN").length;
if (AS_JSON) {
  console.log(JSON.stringify({ base: BASE, buildId, deployId, results, failed, warned }, null, 2));
} else {
  console.log(`\nRestPilot post-publish verification  base=${BASE}  build=${buildId ?? "?"}\n`);
  console.log(`${"RESULT".padEnd(6)}  ${"CHECK".padEnd(w)}  DETAIL`);
  console.log(`${"-".repeat(6)}  ${"-".repeat(w)}  ${"-".repeat(30)}`);
  for (const r of results) console.log(`${r.status.padEnd(6)}  ${r.name.padEnd(w)}  ${r.detail}`);
  console.log(`\n${results.length - failed - warned} PASS, ${warned} WARN, ${failed} FAIL`);
  if (http403 >= 4) console.log(`\nNOTE: ${http403} requests returned HTTP 403. That is most likely a firewall (e.g. Cloudflare) blocking this machine, not a bad build. Use the manual checks instead.`);
  console.log(failed === 0 ? "OVERALL: PASS (automated checks only; do the manual checklist next)" : "OVERALL: FAIL");
}
process.exit(failed === 0 ? 0 : 1);
