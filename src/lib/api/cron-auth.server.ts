// Shared server-side helper: verify inbound cron/webhook requests.
//
// Requires a dedicated CRON_SECRET in the `x-cron-secret` header. pg_cron
// pulls it from Vault at trigger time. The legacy anon-key fallback was
// removed after all scheduled jobs migrated to this header (verified against
// cron.job: restpilot-dispatch-alarms, restpilot-notify-tick,
// subscription-lifecycle-daily all send x-cron-secret).

export function requireCronSecret(request: Request): Response | null {
  const provided = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;

  if (expected && provided && provided === expected) return null;

  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
