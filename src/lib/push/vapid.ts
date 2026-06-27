// VAPID public key is safe to ship in the client bundle (the spec calls for it).
// Private key + subject are server-only and read from env in the cron handler.
export const VAPID_PUBLIC_KEY =
  "BGoFQ4eFB9HF0edlQEjnhAsTYajhqkMVfpJlbSTjAlxcuvvTBjsbbtJWsMwOVIiXeWmsTBlpq1jlYrCpsESQHdU";

/** Convert a base64url VAPID key to the Uint8Array PushManager.subscribe() expects. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
