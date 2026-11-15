// App Store Review Guideline 4.8 (offer Sign in with Apple next to Google) and
// 2.1 (no broken login buttons for the reviewer). See
// src/lib/auth/oauth-providers.ts for the rules these tests pin down.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

function loadProviders() {
  const js = ts.transpileModule(read("src/lib/auth/oauth-providers.ts"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, Promise, URL });
  return module.exports;
}

const APP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 RestPilotApp/1.0.0";

test("website: Apple next to Google once the backend has Apple enabled", () => {
  const p = loadProviders();
  const web = { native: false, nativeWebOAuth: false };
  assert.deepEqual(
    { ...p.visibleOAuthProviders({ ...web, appleConfigured: true }) },
    { apple: true, google: true },
  );
  assert.deepEqual(
    { ...p.visibleOAuthProviders({ ...web, appleConfigured: false }) },
    { apple: false, google: true },
    "provider off: no Apple button that can't work",
  );
  assert.deepEqual(
    { ...p.visibleOAuthProviders({ ...web, appleConfigured: null }) },
    { apple: false, google: true },
    "while unknown: hidden (no flash of a button that may not work)",
  );
});

test("app shell: never Google; Apple only in a shell that keeps OAuth in the web view", () => {
  const p = loadProviders();
  for (const appleConfigured of [true, false, null]) {
    const old = p.visibleOAuthProviders({ native: true, nativeWebOAuth: false, appleConfigured });
    assert.equal(old.google, false, "Google refuses embedded web views");
    assert.equal(old.apple, false, "older shells open Apple in Safari and lose the session");
  }
  assert.deepEqual(
    { ...p.visibleOAuthProviders({ native: true, nativeWebOAuth: true, appleConfigured: true }) },
    { apple: true, google: false },
  );
  assert.equal(
    p.visibleOAuthProviders({ native: true, nativeWebOAuth: true, appleConfigured: false }).apple,
    false,
  );
  // So in every app shell either no third-party login is offered (4.8 does not
  // apply), or Sign in with Apple is.
});

test("the shell capability is read from its User-Agent token only", () => {
  const p = loadProviders();
  assert.equal(p.NATIVE_WEB_OAUTH_UA_TOKEN, "RestPilotWebOAuth/1");
  assert.equal(p.hasNativeWebOAuth(APP_UA), false);
  assert.equal(p.hasNativeWebOAuth(`${APP_UA} RestPilotWebOAuth/1`), true);
  assert.equal(p.hasNativeWebOAuth(undefined), false);
  assert.equal(p.hasNativeWebOAuth(""), false);
});

test("appleEnabledInSettings reads external.apple strictly", () => {
  const p = loadProviders();
  assert.equal(p.appleEnabledInSettings({ external: { apple: true, google: true } }), true);
  for (const s of [
    null,
    undefined,
    {},
    { external: null },
    { external: { apple: false } },
    { external: { apple: "true" } },
    "x",
  ]) {
    assert.equal(p.appleEnabledInSettings(s), false, JSON.stringify(s));
  }
});

test("probeAppleProvider: one public settings request, fails closed", async () => {
  let p = loadProviders();
  const calls = [];
  const ok = await p.probeAppleProvider(
    "https://proj.supabase.co/",
    "pk_example",
    async (url, init) => {
      calls.push([url, init.headers.apikey]);
      return new Response(JSON.stringify({ external: { apple: true } }), { status: 200 });
    },
  );
  assert.equal(ok, true);
  assert.deepEqual(calls, [["https://proj.supabase.co/auth/v1/settings", "pk_example"]]);
  // cached
  assert.equal(
    await p.probeAppleProvider("https://proj.supabase.co", "pk_example", async () =>
      assert.fail("not cached"),
    ),
    true,
  );

  p = loadProviders();
  assert.equal(
    await p.probeAppleProvider(
      "https://proj.supabase.co",
      "pk",
      async () => new Response("{}", { status: 500 }),
    ),
    false,
  );
  p = loadProviders();
  assert.equal(
    await p.probeAppleProvider("https://proj.supabase.co", "pk", async () => {
      throw new Error("offline");
    }),
    false,
  );
  p = loadProviders();
  assert.equal(
    await p.probeAppleProvider(undefined, "pk", async () => assert.fail("no url, no request")),
    false,
  );
});

test("sign-in page wiring: Apple first, through Supabase OAuth, gated by the rules", () => {
  const src = read("src/routes/auth.tsx");
  assert.match(
    src,
    /visibleOAuthProviders\(\{\s*native: inNativeApp,\s*nativeWebOAuth,\s*appleConfigured,?\s*\}\)/,
  );
  assert.match(src, /\{providers\.apple && \(/);
  assert.match(src, /\{providers\.google && \(/);
  assert.ok(
    src.indexOf("providers.apple &&") < src.indexOf("providers.google &&"),
    "Apple listed first",
  );
  assert.match(src, /handleOAuth\("apple"\)/);
  assert.match(src, /Continue with Apple/);
  assert.match(src, /supabase\.auth\.signInWithOAuth\(\{\s*provider,/);
  assert.match(src, /setInNativeApp\(isNativeApp\(\)\)/);
  assert.doesNotMatch(src, /hidden until Apple OAuth is configured/);
});

test("the app shell keeps the Apple sign-in pages in the web view and says so", () => {
  const config = JSON.parse(read("ios-app/capacitor.config.json"));
  assert.match(config.appendUserAgent, /(^| )RestPilotWebOAuth\/1( |$)/);
  assert.match(config.appendUserAgent, / RestPilotApp\/\d+\.\d+\.\d+$/);
  const nav = config.server.allowNavigation;
  for (const host of [
    "oauth.lovable.app",
    "*.supabase.co",
    "appleid.apple.com",
    "idmsa.apple.com",
  ]) {
    assert.ok(nav.includes(host), host);
  }
  assert.ok(!nav.some((h) => /google/.test(h)), "Google is never loaded in the web view");
  assert.ok(!nav.includes("*"), "no blanket navigation");
});
