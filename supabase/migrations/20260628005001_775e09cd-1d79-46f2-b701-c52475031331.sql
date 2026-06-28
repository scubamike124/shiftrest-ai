GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_acceptances TO authenticated;
GRANT ALL ON public.legal_acceptances TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_prefs TO authenticated;
GRANT ALL ON public.user_prefs TO service_role;