
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS week_index smallint NOT NULL DEFAULT 0;

ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS cycle_weeks smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cycle_anchor date;

ALTER TABLE public.user_prefs
  ADD CONSTRAINT user_prefs_cycle_weeks_range CHECK (cycle_weeks BETWEEN 1 AND 6);

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_week_index_range CHECK (week_index BETWEEN 0 AND 5);

CREATE INDEX IF NOT EXISTS shifts_user_week_day_idx
  ON public.shifts (user_id, week_index, day);
