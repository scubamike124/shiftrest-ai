
ALTER TABLE public.user_prefs ADD COLUMN IF NOT EXISTS preferred_name TEXT;

-- Backfill: first from partner_name, then from profiles.display_name.
-- Skip rows where preferred_name is already set.
UPDATE public.user_prefs up
SET preferred_name = NULLIF(TRIM(up.partner_name), '')
WHERE up.preferred_name IS NULL
  AND NULLIF(TRIM(up.partner_name), '') IS NOT NULL;

UPDATE public.user_prefs up
SET preferred_name = NULLIF(TRIM(SPLIT_PART(p.display_name, ' ', 1)), '')
FROM public.profiles p
WHERE up.user_id = p.id
  AND up.preferred_name IS NULL
  AND NULLIF(TRIM(p.display_name), '') IS NOT NULL;
