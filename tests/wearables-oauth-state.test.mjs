// The Fitbit/Oura callbacks must only accept OAuth `state` values this server
// issued: signed, bound to the provider, unexpired. Before, they trusted an
// unsigned `<userId>:<random>`, so anyone could attach their own wearable
// tokens to another user's account by choosing that user's id as state.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const src = stripTypeScriptTypes(
  readFileSync(new URL("../src/lib/wearables/oauth-state.server.ts", import.meta.url), "utf8"),
)
  .replace(/^import \{([^}]+)\} from "node:crypto";$/m, "const {$1} = require('node:crypto');")
  .replaceAll("export function ", "function ")
  .replaceAll("export type ", "type ");
const { signOAuthState, verifyOAuthState } = vm.runInNewContext(
  `${src}\n({ signOAuthState, verifyOAuthState })`,
  { require, process: { env: {} }, Buffer, Math, Date },
);

const env = { SUPABASE_SERVICE_ROLE_KEY: "service-role-example" };
const user = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const now = 1_800_000_000;

test("round trip: a state issued for a user and provider verifies to that user", () => {
  const s = signOAuthState(user, "oura", env, now);
  assert.equal(verifyOAuthState(s, "oura", env, now + 60), user);
});

test("the old unsigned format and forged user ids are rejected", () => {
  assert.equal(verifyOAuthState(`${other}:abcdef`, "oura", env, now), null);
  const s = signOAuthState(user, "oura", env, now);
  assert.equal(verifyOAuthState(s.replace(user, other), "oura", env, now), null);
  assert.equal(verifyOAuthState(s.slice(0, -2) + "xx", "oura", env, now), null);
});

test("bound to the provider, expires after 15 minutes, keyed by the server secret", () => {
  const s = signOAuthState(user, "fitbit", env, now);
  assert.equal(verifyOAuthState(s, "oura", env, now), null);
  assert.equal(verifyOAuthState(s, "fitbit", env, now + 15 * 60), user);
  assert.equal(verifyOAuthState(s, "fitbit", env, now + 15 * 60 + 1), null);
  assert.equal(verifyOAuthState(s, "fitbit", { SUPABASE_SERVICE_ROLE_KEY: "other" }, now), null);
  assert.equal(
    verifyOAuthState(s, "fitbit", { ...env, OAUTH_STATE_SECRET: "dedicated" }, now),
    null,
  );
});

test("refuses to sign without a secret or for a non-uuid user", () => {
  assert.throws(() => signOAuthState(user, "oura", {}, now), /not configured/);
  assert.throws(() => signOAuthState("not-a-uuid", "oura", env, now), /Invalid user id/);
});

test("both callbacks use the verifier; the start function signs", () => {
  for (const p of ["oura", "fitbit"]) {
    const cb = readFileSync(
      new URL(`../src/routes/api/public/wearables/${p}/callback.ts`, import.meta.url),
      "utf8",
    );
    assert.match(cb, new RegExp(`verifyOAuthState\\(state, "${p}"\\)`));
    assert.doesNotMatch(cb, /state\.split\(":"\)/);
  }
  const start = readFileSync(
    new URL("../src/lib/wearables/wearables.functions.ts", import.meta.url),
    "utf8",
  );
  assert.match(start, /signOAuthState\(context\.userId, provider\)/);
});
