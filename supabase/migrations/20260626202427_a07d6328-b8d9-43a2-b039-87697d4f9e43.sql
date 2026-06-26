CREATE TABLE public.shifts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day         SMALLINT NOT NULL CHECK (day BETWEEN 0 AND 6),
  start_min   SMALLINT NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min     SMALLINT NOT NULL CHECK (end_min BETWEEN 0 AND 1439),
  title       TEXT,
  shift_type  TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own shifts" ON public.shifts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own shifts" ON public.shifts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own shifts" ON public.shifts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own shifts" ON public.shifts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX shifts_user_id_idx ON public.shifts (user_id);

CREATE TRIGGER shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();