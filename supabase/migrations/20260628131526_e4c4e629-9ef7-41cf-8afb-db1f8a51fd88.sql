
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS brief_layout jsonb NOT NULL DEFAULT '{"order":["sleep","alarm","weather","longclock","departure","tip","motivation"],"hidden":["departure"]}'::jsonb,
  ADD COLUMN IF NOT EXISTS home_address text,
  ADD COLUMN IF NOT EXISTS work_address text,
  ADD COLUMN IF NOT EXISTS commute_minutes_baseline integer;
