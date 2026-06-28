ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS brief_enabled jsonb
    NOT NULL DEFAULT '{"morning":true,"afternoon":true,"evening":true}'::jsonb;