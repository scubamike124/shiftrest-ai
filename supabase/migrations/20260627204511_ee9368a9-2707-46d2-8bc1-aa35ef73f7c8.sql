-- ai_log: server-only writes
DROP POLICY IF EXISTS "Users can insert their own AI log" ON public.ai_log;
DROP POLICY IF EXISTS "Users can update their own AI log" ON public.ai_log;
DROP POLICY IF EXISTS "Users can delete their own AI log" ON public.ai_log;
REVOKE INSERT, UPDATE, DELETE ON public.ai_log FROM authenticated;

-- notification_log: owner delete, server-only update
DROP POLICY IF EXISTS "Users can delete their notification log" ON public.notification_log;
CREATE POLICY "Users can delete their notification log"
  ON public.notification_log FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
REVOKE UPDATE ON public.notification_log FROM authenticated;

-- wearable_connections: tokens written server-side only
DROP POLICY IF EXISTS "Users can insert their wearable connections" ON public.wearable_connections;
DROP POLICY IF EXISTS "Users can update their wearable connections" ON public.wearable_connections;
REVOKE INSERT, UPDATE ON public.wearable_connections FROM authenticated;

-- SECURITY DEFINER lockdown
REVOKE EXECUTE ON FUNCTION public.has_ai_budget(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
