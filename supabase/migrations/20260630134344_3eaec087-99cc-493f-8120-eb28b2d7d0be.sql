-- Restore client read access to wearable_connections via column-scoped GRANT.
-- Tokens (access_token, refresh_token) are intentionally excluded from the
-- authenticated GRANT so they remain readable only by service_role (supabaseAdmin).

GRANT SELECT
  (id, user_id, provider, expires_at, provider_user_id, scope,
   last_sync_at, last_sync_error, created_at, updated_at)
  ON public.wearable_connections TO authenticated;

GRANT ALL ON public.wearable_connections TO service_role;

CREATE POLICY "own connections select"
  ON public.wearable_connections
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);