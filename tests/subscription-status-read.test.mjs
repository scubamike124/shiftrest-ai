// The profile and premium UI read the member's plan from the database rows
// the Stripe webhook maintains. That must work on builds without website
// checkout (Railway before Stripe is configured; the iOS app), and a newer
// incomplete checkout must not hide an older paid or lifetime row.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const src = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/subscription.ts", import.meta.url), "utf8"),
)
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replaceAll("export async function ", "async function ")
  .replaceAll("export type ", "type ")
  .replaceAll("export interface ", "interface ");

function load({ rows, configured = false, signedIn = true }) {
  const calls = [];
  const query = {
    select() {
      return query;
    },
    eq(col, val) {
      calls.push([col, val]);
      return query;
    },
    order() {
      return query;
    },
    async limit() {
      return { data: rows };
    },
  };
  const supabase = {
    auth: {
      async getSession() {
        return { data: { session: signedIn ? { user: { id: "u1" } } : null } };
      },
    },
    from(t) {
      calls.push(["from", t]);
      return query;
    },
  };
  const ctx = vm.createContext({
    supabase,
    Date,
    isPaymentsConfigured: () => configured,
    getStripeEnvironment: () => "sandbox",
  });
  const { getSubscriptionState } = vm.runInContext(`${src}\n({ getSubscriptionState })`, ctx);
  return { getSubscriptionState, calls };
}

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

test("without website checkout configured, a lifetime member still sees lifetime (live rows)", async () => {
  const h = load({
    rows: [{ price_id: "restpilot_lifetime", status: "lifetime", current_period_end: null }],
  });
  const s = await h.getSubscriptionState();
  assert.equal(s.tier, "lifetime");
  assert.equal(s.isPremium, true);
  assert.deepEqual(
    h.calls.find(([c]) => c === "environment"),
    ["environment", "live"],
  );
});

test("an active monthly subscriber is premium even with checkout off", async () => {
  const s = await load({
    rows: [{ price_id: "restpilot_monthly", status: "active", current_period_end: future }],
  }).getSubscriptionState();
  assert.equal(s.tier, "monthly");
  assert.equal(s.isPremium, true);
});

test("a newer incomplete checkout does not hide an older paid row", async () => {
  const s = await load({
    rows: [
      { price_id: "restpilot_annual", status: "incomplete", current_period_end: null },
      { price_id: "restpilot_monthly", status: "active", current_period_end: future },
    ],
  }).getSubscriptionState();
  assert.equal(s.tier, "monthly");
  assert.equal(s.isPremium, true);
});

test("a lifetime member who later bought a plan still shows lifetime (matches the server)", async () => {
  const s = await load({
    rows: [
      { price_id: "restpilot_monthly", status: "active", current_period_end: future },
      { price_id: "restpilot_lifetime", status: "lifetime", current_period_end: null },
    ],
  }).getSubscriptionState();
  assert.equal(s.tier, "lifetime");
});

test("expired rows are not premium; signed-out users are free; configured builds use their own mode", async () => {
  const exp = await load({
    rows: [{ price_id: "restpilot_monthly", status: "active", current_period_end: past }],
  }).getSubscriptionState();
  assert.equal(exp.isPremium, false);
  assert.equal((await load({ rows: [], signedIn: false }).getSubscriptionState()).tier, "free");
  const h = load({ rows: [], configured: true });
  assert.equal((await h.getSubscriptionState()).tier, "free");
  assert.deepEqual(
    h.calls.find(([c]) => c === "environment"),
    ["environment", "sandbox"],
  );
});
