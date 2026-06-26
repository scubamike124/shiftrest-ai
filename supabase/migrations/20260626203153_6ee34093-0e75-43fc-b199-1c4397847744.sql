CREATE TABLE public.user_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wind_down_min smallint NOT NULL DEFAULT 120,
  sleep_hours numeric(3,1) NOT NULL DEFAULT 8,
  notifications boolean NOT NULL DEFAULT true,
  low_light boolean NOT NULL DEFAULT true,
  lat double precision NOT NULL DEFAULT 40.7128,
  lon double precision NOT NULL DEFAULT -74.006,
  location_label text NOT NULL DEFAULT 'New York, NY',
  partner_name text NOT NULL DEFAULT '',
  onboarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_prefs TO authenticated;
GRANT ALL ON public.user_prefs TO service_role;

ALTER TABLE public.user_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own prefs" ON public.user_prefs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own prefs" ON public.user_prefs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own prefs" ON public.user_prefs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own prefs" ON public.user_prefs FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER user_prefs_set_updated_at
  BEFORE UPDATE ON public.user_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();