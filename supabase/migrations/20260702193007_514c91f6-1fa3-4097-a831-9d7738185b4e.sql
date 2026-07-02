
-- Item 5: favorite voice
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS default_voice_id text,
  ADD COLUMN IF NOT EXISTS default_voice_provider text;

-- Item 7: employer icon (color already exists)
ALTER TABLE public.employers
  ADD COLUMN IF NOT EXISTS icon text;

-- Item 8: partner_shares — short share codes for Partner Mode
CREATE TABLE IF NOT EXISTS public.partner_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.partner_shares TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_shares TO authenticated;
GRANT ALL ON public.partner_shares TO service_role;

ALTER TABLE public.partner_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read a share by code" ON public.partner_shares;
CREATE POLICY "Anyone can read a share by code"
  ON public.partner_shares FOR SELECT
  USING (expires_at IS NULL OR expires_at > now());

DROP POLICY IF EXISTS "Owners manage their shares" ON public.partner_shares;
CREATE POLICY "Owners manage their shares"
  ON public.partner_shares FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS partner_shares_user_idx ON public.partner_shares(user_id);
