// Signed OAuth `state` for the Fitbit/Oura connect flows.
// The callbacks used to take the user id straight from an unsigned
// `<userId>:<random>` state, so anyone completing their own provider
// authorization with `state=<another user's id>:x` could store their tokens on
// that account. The state is now HMAC-signed by the server, bound to the
// provider and short-lived; callbacks accept only states this server issued.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type OAuthProvider = "fitbit" | "oura";
const TTL_SECONDS = 15 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signingKey(env: Record<string, string | undefined>): Buffer {
  // A dedicated secret if configured; otherwise derived from the server-only
  // service-role key, which the callbacks already require.
  const base = env.OAUTH_STATE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("OAuth state signing is not configured");
  return createHmac("sha256", base).update("restpilot-wearable-oauth-state-v1").digest();
}

function mac(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function signOAuthState(
  userId: string,
  provider: OAuthProvider,
  env: Record<string, string | undefined> = process.env,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (!UUID.test(userId)) throw new Error("Invalid user id");
  const payload = `${userId}.${provider}.${nowSeconds + TTL_SECONDS}.${randomBytes(12).toString("base64url")}`;
  return `${payload}.${mac(signingKey(env), payload)}`;
}

// Returns the user id for a valid, unexpired state issued for this provider,
// otherwise null.
export function verifyOAuthState(
  state: string,
  provider: OAuthProvider,
  env: Record<string, string | undefined> = process.env,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  const parts = state.split(".");
  if (parts.length !== 5) return null;
  const [userId, stateProvider, exp, nonce, sig] = parts;
  if (!UUID.test(userId) || stateProvider !== provider || !/^\d+$/.test(exp) || !nonce) return null;
  const expected = Buffer.from(mac(signingKey(env), `${userId}.${stateProvider}.${exp}.${nonce}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(exp) < nowSeconds) return null;
  return userId;
}
