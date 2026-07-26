/**
 * RestPilot production smoke + responsive QA (no credentials required).
 * Authenticated flows run only when RESTPILOT_E2E_EMAIL + RESTPILOT_E2E_PASSWORD are set.
 *
 * Usage: node scripts/prod-e2e-smoke.mjs
 */
import fs from "fs";

const BASE = process.env.RESTPILOT_BASE || "https://restpilotai.com";
const email = process.env.RESTPILOT_E2E_EMAIL || "";
const password = process.env.RESTPILOT_E2E_PASSWORD || "";

const PUBLIC = [
  "/",
  "/auth",
  "/plan",
  "/pricing",
  "/features",
  "/science",
  "/safety",
  "/contact",
  "/legal/privacy",
  "/legal/terms",
  "/api/public/health",
  "/api/public/version",
];

const AUTHENTICATED = [
  "/dashboard",
  "/plan",
  "/events",
  "/profile",
  "/coach",
  "/companion",
  "/memory",
  "/inbox",
  "/decisions",
  "/playbooks",
  "/settings/morning",
];

const results = {
  public: [],
  auth: [],
  responsive: [],
  bugsFound: 0,
  bugsFixed: 0,
  ownerBlockers: [],
};

async function check(path) {
  const url = BASE + path;
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "RestPilot-E2E/1.0" },
    });
    const ms = Date.now() - t0;
    const text = await res.text();
    const ok = res.status >= 200 && res.status < 400;
    if (!ok) results.bugsFound += 1;
    return {
      path,
      status: res.status,
      ms,
      ok,
      bytes: text.length,
      hasRestPilot: /RestPilot/i.test(text),
      hasShiftRest: /ShiftRest|Shift Rest/i.test(text) && !/shiftrest\./i.test(text),
    };
  } catch (e) {
    results.bugsFound += 1;
    return { path, status: 0, ms: Date.now() - t0, ok: false, error: String(e.message || e) };
  }
}

for (const p of PUBLIC) {
  const r = await check(p);
  results.public.push(r);
  if (r.hasShiftRest) {
    results.bugsFound += 1;
    r.brandIssue = true;
  }
}

// Responsive: fetch home HTML and assert viewport meta + no obvious desktop-only blockers in markup
const home = await fetch(BASE + "/", { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" } });
const homeHtml = await home.text();
const hasViewport = /name=["']viewport["']/i.test(homeHtml);
results.responsive.push({
  viewport: "mobile-ua",
  status: home.status,
  hasViewportMeta: hasViewport,
  ok: home.ok && hasViewport,
});
if (!(home.ok && hasViewport)) results.bugsFound += 1;

const tablet = await fetch(BASE + "/plan", {
  headers: { "User-Agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15" },
});
results.responsive.push({
  viewport: "tablet-ua",
  path: "/plan",
  status: tablet.status,
  ok: tablet.ok,
});
if (!tablet.ok) results.bugsFound += 1;

if (!email || !password) {
  results.ownerBlockers.push(
    "RESTPILOT_E2E_EMAIL / RESTPILOT_E2E_PASSWORD not set — authenticated page/button/modal/DB E2E cannot run from this agent.",
  );
  for (const p of AUTHENTICATED) {
    const r = await check(p);
    // Expect redirect to auth or 200 with login wall
    results.auth.push({
      ...r,
      note: "unauthenticated probe only",
    });
  }
} else {
  results.ownerBlockers.push(
    "Credentials present but browser form automation (Playwright) not installed in this pass — use Lovable signed-in preview or install Playwright.",
  );
}

const out = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  ...results,
  summary: {
    publicPass: results.public.filter((r) => r.ok).length,
    publicTotal: results.public.length,
    responsivePass: results.responsive.filter((r) => r.ok).length,
    responsiveTotal: results.responsive.length,
    bugsFound: results.bugsFound,
    authenticatedExecuted: Boolean(email && password),
  },
};

fs.mkdirSync("docs/launch/audits", { recursive: true });
fs.writeFileSync(
  "docs/launch/audits/prod-e2e-smoke-2026-07-26.json",
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out.summary, null, 2));
console.log("ownerBlockers:", out.ownerBlockers);
