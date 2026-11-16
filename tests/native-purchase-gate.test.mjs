// App Store Guideline 3.1.1: no upgrade or purchase prompt inside the iPhone app.
// The app shell is recognised by window.Capacitor OR by the "RestPilotApp/" user
// agent: Capacitor can arrive after the first requests, the user agent cannot.
//
// What this file covers:
//   - detection (Capacitor, user agent, SSR, case) and what a refusal shows;
//   - the live-voice trial gate and the shared AI-refusal toast gate (source checks);
//   - three source scans of the client tree (src/, minus server-only files), each with
//     an explicit per-file COUNT allowlist, so one more hit in an already-listed file
//     fails too: (1) purchase-route strings in single, double or backtick quotes,
//     relative or absolute restpilotai.com, after joining "a" + "b" literals;
//     (2) upsell wording and prices; (3) "paywall" / "pricing" as bare literals.
// What it does NOT cover: an upsell built from a variable or a template with
// substitutions, text fetched at run time, images, or any native (Swift) code. A new
// hit is not proof of a violation: the failure asks a reviewer to check the gate and
// then update the list.
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

// ---- client-tree scans -----------------------------------------------------------
function clientFiles() {
  const out = execSync("git ls-files src", {
    cwd: new URL("..", import.meta.url).pathname,
    encoding: "utf8",
  });
  return out
    .trim()
    .split("\n")
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .filter(
      (f) =>
        !/\.server\.tsx?$|^src\/routes\/api\/|^src\/routes\/lovable\/|email-templates|routeTree\.gen|supabase\/types/.test(
          f,
        ),
    );
}
/** "a" + "b" + "c" becomes "abc", so a path split across literals is still found. */
function joinLiterals(text) {
  let prev;
  do {
    prev = text;
    text = text.replace(
      /(["'`])([^"'`\n]*)\1\s*\+\s*(["'`])([^"'`\n]*)\3/g,
      (_m, q, a, _q2, b) => q + a + b + q,
    );
  } while (text !== prev);
  return text;
}
function countsFor(regex, files = clientFiles()) {
  const counts = {};
  for (const f of files) {
    const n = (joinLiterals(read(f)).match(regex) ?? []).length;
    if (n) counts[f] = n;
  }
  return counts;
}
const ROUTE_STRING = /(["'`])(?:https?:\/\/(?:www\.)?restpilotai\.com)?\/(?:paywall|pricing)\b/g;
const UPSELL =
  /\b(?:Upgrade|Subscribe|Premium|Go Pro|Get Pro)\b|\bupgrade (?:to|for|now)\b|\$\d+(?:[.,]\d\d)\b|\$\d+\s?(?:\/|per )|\bper (?:month|year)\b|\/(?:month|year)\b/g;
const BARE_FRAGMENT = /(["'`])(?:paywall|pricing)\1/g;
const REVIEW =
  "a new hit must be reviewed (gated on isNativeApp()/useIsNativeApp(), or neutral) and then listed here";

test("purchase-route strings: exact count per file (every quote style, absolute URLs, joined literals)", () => {
  // Reviewed: every hit is neutral or gated. On this line the website has no purchase
  // flow: /pricing and /paywall render "App preview" access; in the app /paywall shows
  // NativeSubscription only behind the IAP flag on an iOS shell.
  const expected = {
    "src/components/site/AppSidebar.tsx": 1, // label "App preview"
    "src/components/site/SiteFooter.tsx": 1, // label "App preview"
    "src/components/site/SiteHeader.tsx": 1, // label "App preview"
    "src/components/subscription/NativeSubscription.tsx": 1, // website link only if paywall-policy externalPurchaseLink (default off)
    "src/lib/ai/refusal-client.ts": 1, // toast action gated on isNativeApp()
    "src/lib/appearance.ts": 1, // marketing route list
    "src/routes/__root.tsx": 1, // marketing route list
    "src/routes/auth.tsx": 1, // post-login return allowlist
    "src/routes/companion.tsx": 1, // VoiceTrialUsedUp, native branch first
    "src/routes/index.tsx": 1, // "View app preview access", no price
    "src/routes/legal.subscription.tsx": 1, // legal text link
    "src/routes/legal.terms.tsx": 1, // legal text link
    "src/routes/paywall.tsx": 1, // route definition (AppAwarePaywall)
    "src/routes/pricing.tsx": 2, // route definition + canonical (App preview)
    "src/routes/profile.tsx": 1, // card "App preview access"
    "src/routes/sitemap[.]xml.ts": 1, // sitemap
  };
  assert.deepEqual(countsFor(ROUTE_STRING), expected, REVIEW);
});

test("upsell wording and prices in the client tree: exact count per file", () => {
  // Reviewed. Most hits are code, comments or non-purchase text (a "Premium" model name,
  // "subscribe" to a store). The ones users can see are gated: refusal.ts/refusal-client.ts
  // (offerUpgrade is false in the app), companion.tsx (VoiceTrialUsedUp), NativeSubscription
  // (the in-app screen), legal pages (documents), profile.tsx (neutral card, Stripe portal off).
  const expected = {
    "src/components/companion/Avatar.tsx": 1,
    "src/components/companion/Avatar3D.tsx": 1,
    "src/components/companion/CompanionQuickGrid.tsx": 1,
    "src/components/subscription/NativeSubscription.tsx": 8,
    "src/lib/ai/refusal-client.ts": 2,
    "src/lib/ai/refusal.ts": 2,
    "src/lib/entitlements/checkout-guard.ts": 1,
    "src/lib/entitlements/merge.ts": 1,
    "src/lib/entitlements/revenuecat.ts": 4,
    "src/lib/insights.ts": 1,
    "src/lib/realtime/openai.functions.ts": 1, // server text, replaced by useOpenAIRealtime
    "src/lib/recommendations.ts": 1,
    "src/lib/schedule.ts": 1,
    "src/lib/sounds/mixer.ts": 1,
    "src/lib/voice/intent-router.ts": 1,
    "src/routes/coach.tsx": 1,
    "src/routes/companion.tsx": 3,
    "src/routes/legal.electronic-consent.tsx": 1,
    "src/routes/legal.subscription.tsx": 3,
    "src/routes/pilot.tsx": 2,
    "src/routes/profile.tsx": 2,
  };
  assert.deepEqual(countsFor(UPSELL), expected, REVIEW);
});

test('"paywall" / "pricing" as bare string literals: only the two known non-URL uses', () => {
  const expected = {
    "src/lib/legal/consent.functions.ts": 1, // a consent-source name
    "src/routes/index.tsx": 1, // a section id
  };
  assert.deepEqual(countsFor(BARE_FRAGMENT), expected, REVIEW);
});

test("the scans themselves catch the five known evasions (self-check of the regexes)", () => {
  const hit = (re, text) => (joinLiterals(text).match(re) ?? []).length > 0;
  assert.ok(hit(ROUTE_STRING, '<Link to="/paywall">Upgrade now</Link>'));
  assert.ok(hit(ROUTE_STRING, "const t = { to: '/paywall' };"));
  assert.ok(hit(ROUTE_STRING, 'const u = "https://restpilotai.com/pricing";'));
  assert.ok(hit(ROUTE_STRING, 'const p = "/" + "pay" + "wall";'));
  assert.ok(hit(UPSELL, "<p>Upgrade to Premium for unlimited AI</p>"));
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
