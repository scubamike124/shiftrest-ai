CREATE TABLE public.sound_mixes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sound_mixes_user_id_idx ON public.sound_mixes(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sound_mixes TO authenticated;
GRANT ALL ON public.sound_mixes TO service_role;

ALTER TABLE public.sound_mixes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own sound mixes"
  ON public.sound_mixes FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER sound_mixes_set_updated_at
  BEFORE UPDATE ON public.sound_mixes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();