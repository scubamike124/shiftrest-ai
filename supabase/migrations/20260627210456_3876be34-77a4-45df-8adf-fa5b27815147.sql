
-- Tighten AI tables: public -> authenticated
DROP POLICY IF EXISTS "users manage own feedback" ON public.ai_feedback;
CREATE POLICY "users manage own feedback" ON public.ai_feedback
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users manage own patterns" ON public.ai_patterns;
CREATE POLICY "users manage own patterns" ON public.ai_patterns
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users manage own recs" ON public.ai_recommendations;
CREATE POLICY "users manage own recs" ON public.ai_recommendations
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Lock down wearable_connections: remove client SELECT of raw tokens.
-- Server code uses supabaseAdmin (bypasses RLS) so this is safe.
DROP POLICY IF EXISTS "own connections select" ON public.wearable_connections;
-- (no replacement SELECT policy — clients must not read tokens directly)
