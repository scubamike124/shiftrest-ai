// iPhone App Store readiness gaps closed on the Railway line:
//   - Guideline 3.1.1: the Stripe server functions refuse requests from the app shell
//     (user agent token "RestPilotApp/"), so no website checkout or portal from inside the app.
//   - Budget parity: has_ai_budget(uuid) is service-role only (no cross-user reads).
//   - 5.1.1(v): the in-app deletion dialog tells people an App Store subscription is not
//     cancelled by deleting the account.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import test from "node:test";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const guardSrc = stripTypeScriptTypes(read("src/lib/entitlements/app-request-guard.ts"))
  .replaceAll("export const ", "const ")
  .replaceAll("export function ", "function ");
const guard = vm.runInContext(
  `${guardSrc}\n({NATIVE_APP_UA_TOKEN, APP_PURCHASE_REFUSED_MESSAGE, isNativeAppUserAgent})`,
  vm.createContext({}),
);

const APP_UA = "Mozilla/5.0 (iPhone) AppleWebKit RestPilotWebOAuth/1 RestPilotApp/1.0.0";
const SAFARI_UA = "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18 Safari/604.1";

test("the guard token matches the one the app shell sends", () => {
  const config = JSON.parse(read("ios-app/capacitor.config.json"));
  assert.ok(config.appendUserAgent.includes(guard.NATIVE_APP_UA_TOKEN));
  assert.equal(guard.isNativeAppUserAgent(APP_UA), true);
  assert.equal(guard.isNativeAppUserAgent(SAFARI_UA), false);
  assert.equal(guard.isNativeAppUserAgent("Mozilla/5.0 restpilotapp/2.0"), true);
  assert.equal(guard.isNativeAppUserAgent("X RESTPILOTAPP/1"), true);
  assert.equal(guard.isNativeAppUserAgent("RestPilotApp"), false);
  assert.equal(guard.isNativeAppUserAgent(null), false);
  assert.equal(guard.isNativeAppUserAgent(undefined), false);
});

function harness(userAgent) {
  const source = stripTypeScriptTypes(read("src/lib/billing.functions.ts"))
    .replace(/^import[\s\S]*?;\n/gm, "")
    .replaceAll("export const ", "const ");
  const stripeCalls = [];
  const stripe = new Proxy(
    {},
    {
      get: (_t, name) => {
        stripeCalls.push(String(name));
        throw new Error("Stripe must not be reached");
      },
    },
  );
  function createServerFn() {
    let v;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn) {
        v = fn;
        return b;
      },
      handler(fn) {
        return (a) => fn({ ...a, data: v(a.data) });
      },
    };
    return b;
  }
  const ctx = vm.createContext({
    URL,
    process: { env: { NODE_ENV: "production" } },
    createServerFn,
    requireSupabaseAuth: {},
    createStripeClient: () => stripe,
    getStripeErrorMessage: (e) => e.message,
    appleSubscriptionBlocksCheckout: async () => null,
    getRequest: () => ({ headers: new Headers({ "user-agent": userAgent }) }),
    isNativeAppUserAgent: guard.isNativeAppUserAgent,
    APP_PURCHASE_REFUSED_MESSAGE: guard.APP_PURCHASE_REFUSED_MESSAGE,
  });
  const fns = vm.runInContext(`${source}\n({createCheckoutSession, createPortalSession})`, ctx);
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user: { email: "m@example.test" } } };
      },
    },
    from() {
      throw new Error("database must not be read for an app request");
    },
  };
  const context = { supabase, userId: "user-123" };
  const returnUrl = "https://restpilotai.com/profile";
  return {
    stripeCalls,
    checkout: () =>
      fns.createCheckoutSession({
        context,
        data: { priceId: "restpilot_monthly", environment: "live", returnUrl },
      }),
    portal: () => fns.createPortalSession({ context, data: { environment: "live", returnUrl } }),
  };
}

test("from the app shell, checkout and the Stripe portal are refused before any Stripe or database call", async () => {
  const h = harness(APP_UA);
  const c = JSON.parse(JSON.stringify(await h.checkout()));
  const p = JSON.parse(JSON.stringify(await h.portal()));
  assert.deepEqual(c, { error: guard.APP_PURCHASE_REFUSED_MESSAGE });
  assert.deepEqual(p, { error: guard.APP_PURCHASE_REFUSED_MESSAGE });
  assert.deepEqual(h.stripeCalls, []);
});

test("from a normal browser the guard does not intercept (Stripe is reached)", async () => {
  const h = harness(SAFARI_UA);
  const c = JSON.parse(JSON.stringify(await h.checkout()));
  assert.notEqual(c.error, guard.APP_PURCHASE_REFUSED_MESSAGE);
  assert.ok(h.stripeCalls.length > 0, "handler proceeded to Stripe");
});

test("has_ai_budget is service-role only", () => {
  const sql = read(
    "supabase/migrations/20261115080000_revoke_has_ai_budget_from_authenticated.sql",
  );
  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.has_ai_budget\(UUID\) FROM PUBLIC, anon, authenticated;/,
  );
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.has_ai_budget\(UUID\) TO service_role;/);
  // Every app caller uses the service-role client (admission) or an admin client (log).
  assert.match(read("src/lib/ai/admission.server.ts"), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(read("src/lib/ai/log.server.ts"), /admin\.rpc\("has_ai_budget"/);
});

test("account deletion dialog says an App Store subscription is not cancelled by deletion", () => {
  const profile = read("src/routes/profile.tsx");
  assert.match(
    profile,
    /bought\s+through\s+the\s+App\s+Store[^.]*not\s+cancelled\s+by\s+deleting\s+your\s+account/,
  );
  assert.match(profile, /iPhone\s+Settings,\s+your\s+name,\s+Subscriptions/);
  assert.doesNotMatch(profile, /cancel recurring Stripe subscriptions/);
});
