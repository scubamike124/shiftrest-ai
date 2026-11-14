#!/usr/bin/env node
// Cutover gate: check a deployed RestPilot app against the Supabase project
// it should use. No secrets needed; nothing is written.
//
//   APP_URL=https://restpilot-web-staging.up.railway.app EXPECT_SUPABASE_REF=<ref> \
//   SUPABASE_PUBLISHABLE_KEY=<public anon key> \
//   [TEST_EMAIL=... TEST_PASSWORD=...]  node scripts/migration/verify-deployment.mjs
//
// TEST_EMAIL/TEST_PASSWORD (an EXISTING migrated account, ideally the
// owner's) add a real password sign-in and an RLS-scoped read of the user's
// own profile. Only pass/fail is printed, never the token or row contents.
import { LIVE_SOURCE_REF } from "./lib.mjs";

const app = (process.env.APP_URL || "").replace(/\/+$/, "");
const ref = process.env.EXPECT_SUPABASE_REF;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!/^https:\/\//.test(app) || !ref) {
  console.error(
    "usage: APP_URL=https://... EXPECT_SUPABASE_REF=<ref> [SUPABASE_PUBLISHABLE_KEY=...] verify-deployment.mjs",
  );
  process.exit(2);
}
const sb = `https://${ref}.supabase.co`;
const results = [];
const check = (ok, msg) => {
  results.push({ ok, msg });
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
};
const get = (u, init = {}) => fetch(u, { redirect: "manual", ...init });

try {
  const h = await get(`${app}/api/public/health`);
  check(h.status === 200, `health ${h.status}`);
  const v = await get(`${app}/api/public/version`);
  const ver = v.ok ? await v.json() : {};
  check(
    v.ok && Boolean(ver.buildId),
    `version ${ver.buildId || v.status} built ${ver.builtAt || "?"}`,
  );

  const page = await get(`${app}/auth`);
  const csp = page.headers.get("content-security-policy") || "";
  check(csp.includes(sb), `CSP connect-src allows ${sb}`);
  const html = await page.text();
  const assets = [...new Set([...html.matchAll(/\/assets\/[^"' ]+\.js/g)].map((m) => m[0]))];
  let bundleHasRef = false;
  let bundleHasLive = false;
  for (const a of assets) {
    const js = await (await get(`${app}${a}`)).text();
    if (js.includes(`${ref}.supabase.co`)) bundleHasRef = true;
    if (ref !== LIVE_SOURCE_REF && js.includes(`${LIVE_SOURCE_REF}.supabase.co`))
      bundleHasLive = true;
  }
  check(bundleHasRef, `browser bundle points at ${ref} (${assets.length} entry assets)`);
  if (ref !== LIVE_SOURCE_REF)
    check(
      !bundleHasLive,
      "browser bundle no longer references the Lovable Cloud backend (rebuilt after variables changed)",
    );

  if (key) {
    const s = await get(`${sb}/auth/v1/settings`, { headers: { apikey: key } });
    const settings = s.ok ? await s.json() : { external: {} };
    check(s.ok && settings.external.email === true, "email/password sign-in enabled");
    check(settings.disable_signup === false, "sign-up open (matches current production)");
    for (const provider of ["google", "apple"]) {
      if (!settings.external[provider]) {
        console.log(`INFO ${provider} sign-in disabled on ${ref}`);
        continue;
      }
      const redirect = `${app}/auth`;
      const r = await get(
        `${sb}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirect)}`,
      );
      const loc = r.headers.get("location") || "";
      if (r.status !== 302 && r.status !== 303) {
        check(false, `${provider} authorize HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
        continue;
      }
      const state = new URL(loc).searchParams.get("state");
      let referrer = null;
      try {
        referrer = JSON.parse(Buffer.from(state.split(".")[1], "base64url").toString()).referrer;
      } catch {
        /* opaque state */
      }
      check(
        referrer === null || referrer.startsWith(app),
        `${provider} OAuth redirect to ${new URL(loc).host}; return URL ${referrer === null ? "not inspectable" : referrer.startsWith(app) ? "accepted by allow-list" : "REJECTED (falls back to " + referrer + ")"}`,
      );
    }
    if (process.env.TEST_EMAIL && process.env.TEST_PASSWORD) {
      const t = await fetch(`${sb}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json", Origin: app },
        body: JSON.stringify({
          email: process.env.TEST_EMAIL,
          password: process.env.TEST_PASSWORD,
        }),
      });
      const tok = t.ok ? await t.json() : null;
      check(
        Boolean(tok?.access_token),
        `existing account signs in with its existing password (HTTP ${t.status})`,
      );
      if (tok?.access_token) {
        const p = await fetch(`${sb}/rest/v1/profiles?select=id`, {
          headers: { apikey: key, Authorization: `Bearer ${tok.access_token}` },
        });
        const rows = p.ok ? await p.json() : [];
        check(
          rows.length === 1 && rows[0].id === tok.user.id,
          `RLS returns exactly the user's own profile (${rows.length} row)`,
        );
        await fetch(`${sb}/auth/v1/logout`, {
          method: "POST",
          headers: { apikey: key, Authorization: `Bearer ${tok.access_token}` },
        });
      }
    }
  } else console.log("INFO set SUPABASE_PUBLISHABLE_KEY to check Auth settings, OAuth and sign-in");
} catch (e) {
  check(false, `error: ${e.message}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `GATE FAILED (${failed})` : "GATE PASSED");
process.exit(failed ? 1 : 0);
