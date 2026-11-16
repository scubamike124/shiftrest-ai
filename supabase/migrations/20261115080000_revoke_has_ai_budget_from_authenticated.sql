-- has_ai_budget(uuid) was executable by every signed-in user for ANY user id, so a
-- signed-in user could read another user's remaining AI allowance. Every caller in
-- the app (admission.server.ts, log.server.ts) uses the service-role client, so
-- the function is service-role only. Same change as main's
-- 20261115070000_voice_session_ledger_and_budget_rpc_lockdown.sql (part 1); this
-- file is idempotent and safe to apply before or after that migration.
REVOKE EXECUTE ON FUNCTION public.has_ai_budget(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_ai_budget(UUID) TO service_role;
