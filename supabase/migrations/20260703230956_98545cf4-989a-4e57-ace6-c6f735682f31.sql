CREATE TABLE public.ops_alert (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  severity     text NOT NULL CHECK (severity IN ('critical','error','warning','info')),
  service      text NOT NULL,
  message      text NOT NULL,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  emailed      boolean NOT NULL DEFAULT false,
  resolved_at  timestamptz
);
GRANT SELECT ON public.ops_alert TO authenticated;
GRANT ALL    ON public.ops_alert TO service_role;
ALTER TABLE public.ops_alert ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read ops_alert"
  ON public.ops_alert FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE INDEX ops_alert_recent_idx ON public.ops_alert (created_at DESC);
CREATE INDEX ops_alert_service_recent_idx ON public.ops_alert (service, created_at DESC);