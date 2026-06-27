
CREATE TABLE public.legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_slug text NOT NULL,
  document_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text,
  source text NOT NULL,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT, INSERT ON public.legal_acceptances TO authenticated;
GRANT ALL ON public.legal_acceptances TO service_role;

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own acceptances"
  ON public.legal_acceptances FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own acceptances"
  ON public.legal_acceptances FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX legal_acceptances_user_doc_ver_idx
  ON public.legal_acceptances (user_id, document_slug, document_version);
CREATE INDEX legal_acceptances_user_recent_idx
  ON public.legal_acceptances (user_id, accepted_at DESC);

ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS consent_json jsonb NOT NULL DEFAULT '{}'::jsonb;
