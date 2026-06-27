
-- =========================================================
-- TRIPS
-- =========================================================
CREATE TABLE public.trips (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label       TEXT,
  origin_tz   TEXT NOT NULL,
  dest_tz     TEXT NOT NULL,
  depart_utc  TIMESTAMPTZ NOT NULL,
  arrive_utc  TIMESTAMPTZ NOT NULL,
  dest_lat    DOUBLE PRECISION,
  dest_lon    DOUBLE PRECISION,
  dest_label  TEXT,
  status      TEXT NOT NULL DEFAULT 'planned',
  source      TEXT NOT NULL DEFAULT 'manual',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO authenticated;
GRANT ALL ON public.trips TO service_role;

ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trips_select_own" ON public.trips
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "trips_insert_own" ON public.trips
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "trips_update_own" ON public.trips
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "trips_delete_own" ON public.trips
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX trips_user_arrive_idx ON public.trips (user_id, arrive_utc);
CREATE INDEX trips_user_status_idx ON public.trips (user_id, status);

CREATE TRIGGER trips_set_updated_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- TZ EVENTS (ledger)
-- =========================================================
CREATE TABLE public.tz_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_tz      TEXT,
  to_tz        TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'device',
  confidence   REAL NOT NULL DEFAULT 0.5
);

GRANT SELECT, INSERT, DELETE ON public.tz_events TO authenticated;
GRANT ALL ON public.tz_events TO service_role;

ALTER TABLE public.tz_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tz_events_select_own" ON public.tz_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "tz_events_insert_own" ON public.tz_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tz_events_delete_own" ON public.tz_events
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX tz_events_user_time_idx ON public.tz_events (user_id, detected_at DESC);

-- =========================================================
-- SHIFTS additions
-- =========================================================
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS tz        TEXT,
  ADD COLUMN IF NOT EXISTS start_utc TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_utc   TIMESTAMPTZ;

-- =========================================================
-- AI RECOMMENDATIONS additions
-- =========================================================
ALTER TABLE public.ai_recommendations
  ADD COLUMN IF NOT EXISTS tz                TEXT,
  ADD COLUMN IF NOT EXISTS valid_in_tz       TEXT,
  ADD COLUMN IF NOT EXISTS body_clock_basis  TEXT;

-- =========================================================
-- USER PREFS additions
-- =========================================================
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS home_tz                 TEXT,
  ADD COLUMN IF NOT EXISTS current_tz              TEXT,
  ADD COLUMN IF NOT EXISTS tz_auto                 BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS offline_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS travel_mode_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS calendar_travel_detect  BOOLEAN NOT NULL DEFAULT FALSE;

-- =========================================================
-- BACKFILL shifts.tz from user_prefs.home_tz (UTC fallback)
-- start_utc / end_utc backfill: best-effort using UTC; client
-- will recompute on next write using the real tz.
-- =========================================================
UPDATE public.shifts s
SET tz = COALESCE(p.home_tz, 'UTC')
FROM public.user_prefs p
WHERE s.user_id = p.user_id
  AND s.tz IS NULL;

UPDATE public.shifts SET tz = 'UTC' WHERE tz IS NULL;
