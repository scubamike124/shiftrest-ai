
-- 1. Extend user_prefs for Smart AI Foundation
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS assistant_name TEXT NOT NULL DEFAULT 'RestPilot',
  ADD COLUMN IF NOT EXISTS assistant_mode TEXT NOT NULL DEFAULT 'coach'
    CHECK (assistant_mode IN ('coach','companion','minimal')),
  ADD COLUMN IF NOT EXISTS memory_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_daily_token_cap INTEGER NOT NULL DEFAULT 60000,
  ADD COLUMN IF NOT EXISTS memory_cutoff_at TIMESTAMPTZ;

-- 2. AI memory — long-term per-user facts
CREATE TABLE IF NOT EXISTS public.ai_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('general','schedule','health','preferences','employer','recovery','caffeine','family','goals')),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
  source TEXT NOT NULL DEFAULT 'chat'
    CHECK (source IN ('chat','manual','derived','onboarding')),
  pinned BOOLEAN NOT NULL DEFAULT false,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_memory_user_idx ON public.ai_memory(user_id, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_memory_user_category_idx ON public.ai_memory(user_id, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_memory TO authenticated;
GRANT ALL ON public.ai_memory TO service_role;

ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_memory_select_own" ON public.ai_memory
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ai_memory_insert_own" ON public.ai_memory
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_memory_update_own" ON public.ai_memory
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ai_memory_delete_own" ON public.ai_memory
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER ai_memory_set_updated_at
  BEFORE UPDATE ON public.ai_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. AI log — per-request accounting / cost capping
CREATE TABLE IF NOT EXISTS public.ai_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intent TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_log_user_day_idx ON public.ai_log(user_id, created_at DESC);

GRANT SELECT ON public.ai_log TO authenticated;
GRANT ALL ON public.ai_log TO service_role;

ALTER TABLE public.ai_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_log_select_own" ON public.ai_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- Inserts go through service_role (orchestrator); no client insert policy.

-- 4. Budget check — true when user is under their daily token cap
CREATE OR REPLACE FUNCTION public.has_ai_budget(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT SUM(total_tokens) FROM public.ai_log
       WHERE user_id = _user_id
         AND created_at > now() - interval '24 hours'),
    0
  ) < COALESCE(
    (SELECT ai_daily_token_cap FROM public.user_prefs WHERE user_id = _user_id),
    60000
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_ai_budget(UUID) TO authenticated, service_role;
