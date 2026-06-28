-- Companion Skills connections (per user)
CREATE TABLE public.companion_skills (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill text NOT NULL,
  status text NOT NULL DEFAULT 'connected',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets_ref text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, skill)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companion_skills TO authenticated;
GRANT ALL ON public.companion_skills TO service_role;

ALTER TABLE public.companion_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own companion_skills"
  ON public.companion_skills
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER companion_skills_set_updated_at
  BEFORE UPDATE ON public.companion_skills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Companion Routines (learned multi-step automations, gated by Approve)
CREATE TABLE public.companion_routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger jsonb NOT NULL,
  steps jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  reason text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companion_routines TO authenticated;
GRANT ALL ON public.companion_routines TO service_role;

ALTER TABLE public.companion_routines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own companion_routines"
  ON public.companion_routines
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX companion_routines_user_status_idx
  ON public.companion_routines(user_id, status);

CREATE TRIGGER companion_routines_set_updated_at
  BEFORE UPDATE ON public.companion_routines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();