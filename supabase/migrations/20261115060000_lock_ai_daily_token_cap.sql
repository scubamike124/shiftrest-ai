-- Signed-in users could raise their own daily AI budget.
--
-- has_ai_budget() reads user_prefs.ai_daily_token_cap, but user_prefs is
-- updatable by its owner ("Users update own prefs" + GRANT UPDATE to
-- authenticated) with no column guard. A PATCH of ai_daily_token_cap from the
-- browser was accepted on production (checked with a no-op write that set the
-- test account's cap to its current value), so any user could lift the free
-- tier's 15,000 tokens/day and spend unlimited AI credits.
--
-- The cap is now managed only by the backend (service_role) or the database
-- owner. Signed-in (authenticated) and anonymous requests keep the stored
-- value on UPDATE and get the column default on INSERT. Other columns are
-- unaffected.

CREATE OR REPLACE FUNCTION public.guard_user_prefs_ai_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.ai_daily_token_cap := 15000;
    ELSIF NEW.ai_daily_token_cap IS DISTINCT FROM OLD.ai_daily_token_cap THEN
      NEW.ai_daily_token_cap := OLD.ai_daily_token_cap;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_prefs_guard_ai_cap ON public.user_prefs;
CREATE TRIGGER user_prefs_guard_ai_cap
  BEFORE INSERT OR UPDATE ON public.user_prefs
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_prefs_ai_cap();
