// App Store Guideline 3.1.1: no upgrade or purchase prompt inside the iPhone app.
// The app shell is recognised by window.Capacitor OR by the "RestPilotApp/" user
// agent: Capacitor can arrive after the first requests, the user agent cannot.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import test from "node:test";
import { makeLoader, read } from "./_ai-route-harness.mjs";

const APP_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 RestPilotApp/1.0 (build 7)";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const cap = (v) => ({ Capacitor: { isNativePlatform: () => v } });

function env({ window, userAgent } = {}) {
  const globals = {};
  if (window !== undefined) globals.window = window;
  if (userAgent !== undefined) globals.navigator = { userAgent };
  return globals;
}
const nativeApp = (g) => makeLoader({}, g)("src/lib/native-app.ts");

test("detection: Capacitor, or the app user agent; the website is never native; SSR safe", () => {
  assert.equal(nativeApp(env()).isNativeApp(), false, "server render (no window, no navigator)");
  assert.equal(
    nativeApp({ navigator: { userAgent: APP_UA } }).isNativeApp(),
    false,
    "no window: server render wins",
  );
  assert.equal(nativeApp(env({ window: {}, userAgent: SAFARI_UA })).isNativeApp(), false, "Safari");
  assert.equal(
    nativeApp(env({ window: cap(false), userAgent: SAFARI_UA })).isNativeApp(),
    false,
    "Capacitor web runtime",
  );
  assert.equal(
    nativeApp(env({ window: cap(true), userAgent: SAFARI_UA })).isNativeApp(),
    true,
    "Capacitor present",
  );
  assert.equal(
    nativeApp(env({ window: {}, userAgent: APP_UA })).isNativeApp(),
    true,
    "UA token, Capacitor not injected yet",
  );
  assert.equal(
    nativeApp(env({ window: {}, userAgent: APP_UA.toLowerCase() })).isNativeApp(),
    true,
    "case-insensitive like the server guard",
  );
  assert.equal(
    nativeApp(
      env({
        window: {
          Capacitor: {
            isNativePlatform: () => {
              throw new Error("x");
            },
          },
        },
        userAgent: APP_UA,
      }),
    ).isNativeApp(),
    true,
    "bridge throws, UA still detects",
  );
  assert.equal(
    nativeApp(
      env({
        window: {
          Capacitor: {
            isNativePlatform: () => {
              throw new Error("x");
            },
          },
        },
        userAgent: SAFARI_UA,
      }),
    ).isNativeApp(),
    false,
    "never throws",
  );
  assert.equal(
    nativeApp(env({ window: {}, userAgent: "RestPilot/1.0 Safari" })).isNativeApp(),
    false,
    "a similar name is not the token",
  );
  assert.equal(nativeApp({ window: {}, navigator: {} }).isNativeApp(), false, "no user agent");
});

test("the client token equals the server guard's token", () => {
  const guard = makeLoader()("src/lib/entitlements/app-request-guard.ts");
  assert.equal(nativeApp(env()).APP_USER_AGENT_TOKEN, guard.NATIVE_APP_UA_TOKEN);
  assert.equal(guard.isNativeAppUserAgent(APP_UA), true);
});

// What a refusal shows, with the real helper and the real detector.
async function refusalFor(g, code = "daily_limit") {
  const toasts = [];
  const load = makeLoader(
    { sonner: { toast: { error: (title, opts) => toasts.push({ title, opts: opts ?? {} }) } } },
    g,
  );
  const client = load("src/lib/ai/refusal-client.ts");
  const res = new Response(JSON.stringify({ code, error: "x" }), { status: 429 });
  const r = await client.readAIRefusal(res);
  client.toastAIRefusal(r, "fallback");
  return { r, toast: toasts[0] };
}
const text = (x) =>
  `${x.r.title} ${x.r.description} ${x.r.chatMessage} ${x.toast.title} ${x.toast.opts.description ?? ""}`;

test("daily_limit: the app user agent alone (Capacitor late) gets no upgrade text and no Upgrade toast", async () => {
  const x = await refusalFor(env({ window: {}, userAgent: APP_UA }));
  assert.equal(x.r.offerUpgrade, false);
  assert.equal(x.toast.opts.action, undefined);
  assert.doesNotMatch(text(x), /upgrade|subscribe|paywall|pricing/i);
});

test("daily_limit: Capacitor present gets no upgrade text and no Upgrade toast", async () => {
  const x = await refusalFor(env({ window: cap(true), userAgent: SAFARI_UA }));
  assert.equal(x.r.offerUpgrade, false);
  assert.equal(x.toast.opts.action, undefined);
  assert.doesNotMatch(text(x), /upgrade|subscribe|paywall|pricing/i);
});

test("daily_limit on the website: upgrade offered; every other refusal never offers it", async () => {
  const web = await refusalFor(env({ window: {}, userAgent: SAFARI_UA }));
  assert.equal(web.r.offerUpgrade, true);
  assert.equal(web.toast.opts.action.label, "Upgrade");
  for (const code of [
    "rate_limited",
    "ai_provider_busy",
    "ai_provider_unavailable",
    "ai_budget_unavailable",
  ]) {
    const x = await refusalFor(env({ window: {}, userAgent: SAFARI_UA }), code);
    assert.equal(x.toast.opts.action, undefined, code);
    assert.doesNotMatch(text(x), /upgrade/i, code);
  }
});

test("ai_budget_unavailable says the usage check is unavailable, not the AI service; not your limit", async () => {
  const x = await refusalFor(env({ window: {}, userAgent: SAFARI_UA }), "ai_budget_unavailable");
  assert.equal(x.r.kind, "usage_check_unavailable");
  assert.match(x.r.title, /usage check is temporarily unavailable/i);
  assert.match(x.r.description, /isn't your limit/);
  assert.match(x.r.description, /try again shortly/i);
  assert.doesNotMatch(`${x.r.title} ${x.r.chatMessage}`, /AI service/);
});

// ---- UI gates (source-level; every hit of an upsell string in src/) ----------
test("live-voice trial: no Upgrade link or text in the app, and the server's Upgrade text is replaced", () => {
  const c = read("src/routes/companion.tsx");
  assert.match(c, /function VoiceTrialUsedUp\(\) \{\s*if \(useIsNativeApp\(\)\) \{/);
  assert.match(c, /<VoiceTrialUsedUp \/>/);
  const links = c.slice(0, c.indexOf("function VoiceTrialUsedUp")).match(/to="\/paywall"/g) ?? [];
  assert.equal(
    links.length,
    0,
    "the only /paywall link is inside VoiceTrialUsedUp, after the native branch",
  );
  const after = c.slice(c.indexOf("function VoiceTrialUsedUp"));
  assert.ok(after.indexOf("useIsNativeApp()") < after.indexOf('to="/paywall"'));
  const hook = read("src/lib/realtime/useOpenAIRealtime.ts");
  assert.match(
    hook,
    /includes\("trial_limit_reached"\)[\s\S]{0,200}setError\("Trial voice minutes used up\."\)/,
  );
  assert.match(
    read("src/hooks/use-native-app.ts"),
    /useSyncExternalStore\(noopSubscribe, isNativeApp, \(\) => false\)/,
  );
});

test("AI-limit prompts: only the shared helper has a /paywall toast action, gated on isNativeApp()", () => {
  for (const f of ["companion", "coach", "pilot"]) {
    const src = read(`src/routes/${f}.tsx`);
    assert.equal((src.match(/window\.location\.href = "\/paywall"/g) ?? []).length, 0, f);
    assert.match(src, /toastAIRefusal\(/, f);
  }
  const helper = read("src/lib/ai/refusal-client.ts");
  assert.match(helper, /!refusal\.offerUpgrade \|\| isNativeApp\(\)/);
  assert.match(read("src/lib/ai/refusal.ts"), /const offerUpgrade = !opts\.native;/);
});

test("every /paywall or /pricing reference in src/ is listed with its gate", () => {
  // Hits scanned on this line. On this line the website itself has no purchase flow
  // (payments are off): /pricing and /paywall render "App preview" access, and
  // inside the app /paywall renders NativeSubscription only behind the IAP flag.
  // Each file below is neutral or gated; a new file must be reviewed and listed.
  const allowed = new Map([
    ["src/routes/legal.subscription.tsx", "legal text link"],
    ["src/routes/legal.terms.tsx", "legal text link"],
    ["src/routes/auth.tsx", "post-login return allowlist"],
    ["src/routes/__root.tsx", "marketing route list"],
    ["src/routes/sitemap[.]xml.ts", "sitemap"],
    ["src/routes/pricing.tsx", "App preview page, no price or purchase"],
    ["src/routes/paywall.tsx", "AppAwarePaywall: iOS shell uses IAP screen, else App preview"],
    ["src/routes/index.tsx", "link text 'View app preview access', no price"],
    ["src/routes/companion.tsx", "inside VoiceTrialUsedUp, native branch first"],
    ["src/routes/profile.tsx", "card titled 'App preview access', no price or purchase"],
    ["src/components/site/AppSidebar.tsx", "label 'App preview'"],
    ["src/components/site/SiteHeader.tsx", "label 'App preview'"],
    ["src/components/site/SiteFooter.tsx", "label 'App preview'"],
    [
      "src/components/subscription/NativeSubscription.tsx",
      "in-app screen; website link only if paywall-policy externalPurchaseLink (US storefront and flag, default off)",
    ],
    ["src/lib/ai/refusal-client.ts", "toast action gated on isNativeApp()"],
    ["src/lib/appearance.ts", "marketing route list"],
  ]);
  const out = execSync(
    'git ls-files src | xargs grep -lE \'["`](/paywall|/pricing)|to="/(paywall|pricing)"\' || true',
    {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
    },
  );
  const files = out
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes("email-templates") && !f.endsWith("routeTree.gen.ts"));
  assert.deepEqual(
    files.filter((f) => !allowed.has(f)),
    [],
    "new purchase entry points must be gated and listed here",
  );
});

test("no price or purchase wording in the app-preview screens", () => {
  for (const f of ["src/components/AppPreviewAccess.tsx"]) {
    assert.doesNotMatch(
      read(f),
      /\$\s?\d|per month|\/month|\/year|Subscribe now|Buy now|Upgrade/i,
      f,
    );
  }
});

test("wording: voice playback and briefing never tell a customer 'AI credits are exhausted'", () => {
  for (const f of ["brief", "tts", "tts-elevenlabs"]) {
    const src = read(`src/routes/api/${f}.ts`);
    const fn = src.slice(
      src.indexOf("function messageFromReason"),
      src.indexOf("}", src.indexOf("default:")),
    );
    assert.doesNotMatch(fn, /credits? (are )?exhausted|your credits/i, f);
    assert.match(fn, /paused for now\. Try again later\./, f);
  }
});
