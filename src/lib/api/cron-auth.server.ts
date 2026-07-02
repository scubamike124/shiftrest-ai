// Shared server-side helper: verify inbound cron/webhook requests.
//
// The old pattern gated on `apikey === SUPABASE_PUBLISHABLE_KEY`, but that
// key is embedded in the client bundle — effectively public. We now require
// a dedicated CRON_SECRET in the `x-cron-secret` header. pg_cron pulls it
// from Vault at trigger time.
//
// For a safe rollover window, we still accept the legacy anon-key header
// so any in-flight cron jobs don't 401 mid-deploy. Remove the fallback
// after the pg_cron migration lands and one full day of runs is clean.

export function requireCronSecret(request: Request): Response | null {
  const provided = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (expected && provided && provided === expected) return null;

  // Legacy fallback — accept the Supabase anon key while pg_cron jobs
  // are being migrated. Delete this block after rollover is verified.
  const apikey = request.headers.get("apikey") ?? request.headers.get("x-api-key");
  const legacy = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (legacy && apikey && apikey === legacy) return null;

  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
