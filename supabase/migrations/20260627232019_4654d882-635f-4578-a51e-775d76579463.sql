
-- 1. Roles enum + table
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'tester', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 2. has_role security-definer
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

-- 3. Rewrite has_ai_budget with tiered logic
CREATE OR REPLACE FUNCTION public.has_ai_budget(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  used BIGINT;
  cap INTEGER;
  is_premium BOOLEAN;
BEGIN
  -- Admins and testers: unlimited
  IF public.has_role(_user_id, 'admin'::public.app_role)
     OR public.has_role(_user_id, 'tester'::public.app_role) THEN
    RETURN TRUE;
  END IF;

  SELECT COALESCE(SUM(total_tokens), 0) INTO used
  FROM public.ai_log
  WHERE user_id = _user_id AND created_at > now() - interval '24 hours';

  is_premium := public.has_active_subscription(_user_id, 'live')
             OR public.has_active_subscription(_user_id, 'sandbox');

  IF is_premium THEN
    cap := 500000;
  ELSE
    SELECT ai_daily_token_cap INTO cap FROM public.user_prefs WHERE user_id = _user_id;
    cap := COALESCE(cap, 15000);
  END IF;

  RETURN used < cap;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.has_ai_budget(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_ai_budget(UUID) TO authenticated, service_role;

-- 4. Lower default cap on user_prefs going forward
ALTER TABLE public.user_prefs ALTER COLUMN ai_daily_token_cap SET DEFAULT 15000;

-- 5. Grant admin to scubamike124@gmail.com
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users WHERE email = 'scubamike124@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
