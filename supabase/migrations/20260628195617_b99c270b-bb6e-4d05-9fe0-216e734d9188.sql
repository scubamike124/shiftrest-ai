
CREATE TABLE public.calendar_feeds (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  ics_url TEXT NOT NULL,
  color TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX calendar_feeds_user_idx ON public.calendar_feeds(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_feeds TO authenticated;
GRANT ALL ON public.calendar_feeds TO service_role;

ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own calendar feeds"
  ON public.calendar_feeds FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER calendar_feeds_set_updated_at
  BEFORE UPDATE ON public.calendar_feeds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
