-- 1. Per-category learning consents on user_prefs (all OFF by default).
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS learning_consents jsonb NOT NULL DEFAULT jsonb_build_object(
    'bedtime', false,
    'wake', false,
    'sounds', false,
    'quiet_mode', false,
    'traffic', false,
    'calendar', false,
    'weather', false
  );

-- 2. Cross-skill routine suggestions.
CREATE TABLE IF NOT EXISTS public.routine_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,                       -- e.g. 'bedtime', 'wake', 'quiet_mode', 'departure'
  title text NOT NULL,                      -- short label, e.g. "Bedtime routine at 10:00 PM"
  reason text NOT NULL,                     -- plain-English explanation of why
  signals jsonb NOT NULL DEFAULT '{}'::jsonb, -- structured evidence (counts, times, sources)
  proposed_steps jsonb NOT NULL DEFAULT '[]'::jsonb, -- ordered routine steps the user can accept
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','dismissed','snoozed','expired')),
  snoozed_until timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_suggestions TO authenticated;
GRANT ALL ON public.routine_suggestions TO service_role;

ALTER TABLE public.routine_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own routine suggestions"
  ON public.routine_suggestions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own routine suggestions"
  ON public.routine_suggestions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own routine suggestions"
  ON public.routine_suggestions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own routine suggestions"
  ON public.routine_suggestions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS routine_suggestions_user_status_idx
  ON public.routine_suggestions (user_id, status, last_seen_at DESC);

CREATE TRIGGER routine_suggestions_set_updated_at
  BEFORE UPDATE ON public.routine_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();