
CREATE TABLE IF NOT EXISTS public.rate_limit_counter (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

GRANT ALL ON public.rate_limit_counter TO service_role;

ALTER TABLE public.rate_limit_counter ENABLE ROW LEVEL SECURITY;

-- No policies: table is service-role only. RLS enabled to lock out anon/authenticated.

CREATE INDEX IF NOT EXISTS idx_rate_limit_counter_window
  ON public.rate_limit_counter (window_start);

-- Atomic increment: insert-or-add, returns the resulting count.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  _bucket_key text,
  _window_start timestamptz,
  _increment integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO public.rate_limit_counter (bucket_key, window_start, count, updated_at)
  VALUES (_bucket_key, _window_start, _increment, now())
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = public.rate_limit_counter.count + EXCLUDED.count,
                updated_at = now()
  RETURNING count INTO new_count;
  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, timestamptz, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, timestamptz, integer) TO service_role;

-- Housekeeping: purge windows older than 24h. Called opportunistically by the app.
CREATE OR REPLACE FUNCTION public.rate_limit_prune()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.rate_limit_counter
  WHERE window_start < now() - interval '24 hours';
$$;

REVOKE ALL ON FUNCTION public.rate_limit_prune() FROM public;
GRANT EXECUTE ON FUNCTION public.rate_limit_prune() TO service_role;
