
-- 1. Employers table (future-proof with extras + metadata jsonb)
CREATE TABLE public.employers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  is_default boolean NOT NULL DEFAULT false,
  sort_order smallint NOT NULL DEFAULT 0,
  -- Future fields (nullable, ready to use without another migration)
  location text,
  department text,
  supervisor text,
  pay_rate numeric,
  pay_currency text,
  commute_min smallint,
  reminder_offset_min smallint,
  recovery_notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employers TO authenticated;
GRANT ALL ON public.employers TO service_role;

ALTER TABLE public.employers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own employers" ON public.employers
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own employers" ON public.employers
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own employers" ON public.employers
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own employers" ON public.employers
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER employers_set_updated_at
  BEFORE UPDATE ON public.employers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX employers_user_id_idx ON public.employers(user_id);

-- Only one default employer per user
CREATE UNIQUE INDEX employers_one_default_per_user
  ON public.employers(user_id) WHERE is_default = true;

-- 2. Extend shifts table with employer + future-proof fields
ALTER TABLE public.shifts
  ADD COLUMN employer_id uuid REFERENCES public.employers(id) ON DELETE SET NULL,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX shifts_employer_id_idx ON public.shifts(employer_id);

-- 3. Data migration: create a default "My Job" employer for every existing
--    user that has shifts or prefs, and backfill shifts.employer_id.
INSERT INTO public.employers (user_id, name, color, is_default)
SELECT DISTINCT user_id, 'My Job', '#6366f1', true
FROM (
  SELECT user_id FROM public.shifts
  UNION
  SELECT user_id FROM public.user_prefs
) u
ON CONFLICT DO NOTHING;

UPDATE public.shifts s
SET employer_id = e.id
FROM public.employers e
WHERE e.user_id = s.user_id
  AND e.is_default = true
  AND s.employer_id IS NULL;

-- 4. updated_at trigger on shifts (was missing)
DROP TRIGGER IF EXISTS shifts_set_updated_at ON public.shifts;
CREATE TRIGGER shifts_set_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
