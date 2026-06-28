
-- Slice 5: AI Memory Foundation

-- 1) Extend ai_memory.category to include sleep-domain categories
ALTER TABLE public.ai_memory DROP CONSTRAINT IF EXISTS ai_memory_category_check;
ALTER TABLE public.ai_memory ADD CONSTRAINT ai_memory_category_check
  CHECK (category = ANY (ARRAY[
    'general','schedule','health','preferences','employer','recovery',
    'caffeine','family','goals',
    'sleep_habits','alarm_prefs','favorite_sounds','daily_routine','companion_prefs'
  ]));

-- 2) Pause flag on user_prefs
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS memory_learning_paused boolean NOT NULL DEFAULT false;

-- 3) Proposals table — pending suggestions awaiting user yes/no
CREATE TABLE IF NOT EXISTS public.ai_memory_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  content text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence real NOT NULL DEFAULT 0.7,
  observed_count integer NOT NULL DEFAULT 0,
  dedupe_key text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_memory_proposals_status_check
    CHECK (status = ANY (ARRAY['pending','accepted','declined','expired'])),
  CONSTRAINT ai_memory_proposals_category_check
    CHECK (category = ANY (ARRAY[
      'general','schedule','health','preferences','employer','recovery',
      'caffeine','family','goals',
      'sleep_habits','alarm_prefs','favorite_sounds','daily_routine','companion_prefs'
    ])),
  CONSTRAINT ai_memory_proposals_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_memory_proposals TO authenticated;
GRANT ALL ON public.ai_memory_proposals TO service_role;

ALTER TABLE public.ai_memory_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memory_proposals_select_own" ON public.ai_memory_proposals
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "memory_proposals_insert_own" ON public.ai_memory_proposals
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "memory_proposals_update_own" ON public.ai_memory_proposals
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "memory_proposals_delete_own" ON public.ai_memory_proposals
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS ai_memory_proposals_user_status_idx
  ON public.ai_memory_proposals (user_id, status, last_seen_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ai_memory_proposals_dedupe_idx
  ON public.ai_memory_proposals (user_id, dedupe_key)
  WHERE status = 'pending';

CREATE TRIGGER ai_memory_proposals_updated_at
  BEFORE UPDATE ON public.ai_memory_proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
