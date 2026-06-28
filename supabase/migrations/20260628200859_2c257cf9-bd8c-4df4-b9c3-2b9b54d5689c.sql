
-- 1) Smart device registry
CREATE TABLE public.smart_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'light','plug','thermostat','speaker','coffee_maker','fan',
    'tv','lock','garage','blinds','humidifier','bedroom','other'
  )),
  room text,
  vendor text NOT NULL DEFAULT 'manual' CHECK (vendor IN (
    'manual','alexa','google_home','homekit','smartthings','home_assistant','matter','other'
  )),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  sensitive boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smart_devices TO authenticated;
GRANT ALL ON public.smart_devices TO service_role;
ALTER TABLE public.smart_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_smart_devices" ON public.smart_devices
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_smart_devices_user ON public.smart_devices(user_id);
CREATE TRIGGER smart_devices_set_updated_at
  BEFORE UPDATE ON public.smart_devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Automations
CREATE TABLE public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'bedtime','wake_up','goodnight','morning','custom'
  )),
  trigger jsonb NOT NULL DEFAULT '{"type":"manual"}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  require_confirmation boolean NOT NULL DEFAULT true,
  respect_quiet_hours boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automations TO authenticated;
GRANT ALL ON public.automations TO service_role;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_automations" ON public.automations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_automations_user ON public.automations(user_id);
CREATE TRIGGER automations_set_updated_at
  BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Automation run history
CREATE TABLE public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  automation_id uuid REFERENCES public.automations(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN (
    'started','succeeded','failed','cancelled','skipped_quiet','skipped_offline'
  )),
  trigger_source text NOT NULL DEFAULT 'manual',
  steps_resolved jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_runs TO authenticated;
GRANT ALL ON public.automation_runs TO service_role;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all_automation_runs" ON public.automation_runs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_automation_runs_user_created ON public.automation_runs(user_id, created_at DESC);
