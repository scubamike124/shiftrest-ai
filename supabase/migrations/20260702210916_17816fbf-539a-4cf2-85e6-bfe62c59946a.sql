-- 1. Drop the vulnerable public SELECT policy
DROP POLICY IF EXISTS "Anyone can read a share by code" ON public.partner_shares;

-- 2. Revoke anonymous table access via PostgREST
REVOKE SELECT ON public.partner_shares FROM anon;

-- 3. Secure lookup RPC — returns only the fields Partner Mode needs,
--    only for non-expired shares, only when the caller supplies the code.
CREATE OR REPLACE FUNCTION public.get_partner_share(_code text)
RETURNS TABLE (
  code text,
  payload jsonb,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ps.code, ps.payload, ps.expires_at
  FROM public.partner_shares ps
  WHERE ps.code = _code
    AND (ps.expires_at IS NULL OR ps.expires_at > now())
  LIMIT 1;
$$;

-- Lock down function execution: anon + authenticated may call it; nobody else.
REVOKE ALL ON FUNCTION public.get_partner_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_share(text) TO anon, authenticated;

-- 4. "Owners manage their shares" policy (authenticated, auth.uid() = user_id)
--    is intentionally left unchanged.
