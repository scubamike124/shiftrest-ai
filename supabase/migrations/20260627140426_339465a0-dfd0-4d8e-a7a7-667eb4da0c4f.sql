
CREATE TABLE public.user_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('calendar','commute','personal')),
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  location TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','google','ics')),
  reminder_min INTEGER NOT NULL DEFAULT 15,
  travel_buffer_min INTEGER NOT NULL DEFAULT 20,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_events_user_starts_idx ON public.user_events(user_id, starts_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_events TO authenticated;
GRANT ALL ON public.user_events TO service_role;

ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events: select own" ON public.user_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "events: insert own" ON public.user_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "events: update own" ON public.user_events
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "events: delete own" ON public.user_events
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER user_events_set_updated_at
  BEFORE UPDATE ON public.user_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.notification_prefs
  ADD COLUMN IF NOT EXISTS smart_alarm BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commute BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calendar BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_routine_summary_at TIMESTAMPTZ;
