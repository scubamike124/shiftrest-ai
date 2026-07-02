
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  real_name text;
BEGIN
  real_name := NULLIF(TRIM(COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name'
  )), '');

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, real_name);
  RETURN NEW;
END;
$function$;

-- Backfill: clear display_name values that are just the email local-part.
UPDATE public.profiles
SET display_name = NULL
WHERE display_name IS NOT NULL
  AND email IS NOT NULL
  AND display_name = split_part(email, '@', 1);
