
CREATE TABLE public.wearable_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('fitbit','oura')),
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  provider_user_id text,
  scope text,
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wearable_connections TO authenticated;
GRANT ALL ON public.wearable_connections TO service_role;
ALTER TABLE public.wearable_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own connections select" ON public.wearable_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own connections insert" ON public.wearable_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own connections update" ON public.wearable_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own connections delete" ON public.wearable_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER wearable_connections_set_updated_at
BEFORE UPDATE ON public.wearable_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.wearable_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('fitbit','oura')),
  date date NOT NULL,
  sleep_start timestamptz,
  sleep_end timestamptz,
  sleep_duration_min int,
  sleep_efficiency numeric,
  deep_min int,
  rem_min int,
  light_min int,
  hrv_ms numeric,
  resting_hr int,
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, date)
);

CREATE INDEX wearable_readings_user_date_idx ON public.wearable_readings (user_id, date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wearable_readings TO authenticated;
GRANT ALL ON public.wearable_readings TO service_role;
ALTER TABLE public.wearable_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own readings select" ON public.wearable_readings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own readings insert" ON public.wearable_readings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own readings update" ON public.wearable_readings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own readings delete" ON public.wearable_readings FOR DELETE TO authenticated USING (auth.uid() = user_id);
