CREATE TABLE public.traffic_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('home','work','custom')),
  label text NOT NULL,
  address text,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  baseline_min integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.traffic_destinations TO authenticated;
GRANT ALL ON public.traffic_destinations TO service_role;

ALTER TABLE public.traffic_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own traffic destinations"
  ON public.traffic_destinations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER traffic_destinations_set_updated_at
  BEFORE UPDATE ON public.traffic_destinations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX traffic_destinations_user_idx ON public.traffic_destinations(user_id);
