-- 1) has_ai_budget(uuid) was executable by every signed-in user for ANY user id,
--    leaking whether another user is over their daily AI cap. It is only ever
--    called by the backend with the service role (src/lib/ai/log.server.ts),
--    so remove it from authenticated/anon. service_role keeps it.
REVOKE EXECUTE ON FUNCTION public.has_ai_budget(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_ai_budget(UUID) TO service_role;

-- 2) Atomic live-voice session ledger (service_role only). Rows live in ai_log
--    (the daily cap sums its total_tokens):
--      rt-mint:<sid>        +debit        written by claim_voice_session
--      rt-end:<sid>         -refund/+over written once by end_voice_session
--      rt-over:<sid>:<n>    +tokens       written once per n by charge_voice_overage

-- Claim a session: one active session per user, and the worst-case debit must
-- fit under the daily cap. Serialised per user so parallel mints cannot overshoot.
CREATE OR REPLACE FUNCTION public.claim_voice_session(
  _user_id UUID, _sid TEXT, _debit INTEGER, _window_seconds INTEGER
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_id UUID;
BEGIN
  IF _debit IS NULL OR _debit <= 0 OR _sid IS NULL OR length(_sid) = 0 OR length(_sid) > 64 THEN
    RETURN 'invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('voice:' || _user_id::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.ai_log m
    WHERE m.user_id = _user_id
      AND m.intent LIKE 'rt-mint:%'
      AND m.created_at > now() - make_interval(secs => _window_seconds)
      AND NOT EXISTS (
        SELECT 1 FROM public.ai_log e
        WHERE e.user_id = _user_id AND e.intent = 'rt-end:' || substr(m.intent, 9)
      )
  ) THEN
    RETURN 'active';
  END IF;

  INSERT INTO public.ai_log (user_id, intent, model, prompt_tokens, completion_tokens, status)
  VALUES (_user_id, 'rt-mint:' || _sid, 'gpt-realtime', _debit, 0, 'ok')
  RETURNING id INTO new_id;

  -- Counts the debit just written (used < cap) => refused exactly when the
  -- remaining budget cannot cover the worst case.
  IF NOT public.has_ai_budget(_user_id) THEN
    DELETE FROM public.ai_log WHERE id = new_id;
    RETURN 'exhausted';
  END IF;
  RETURN 'ok';
END;
$$;

-- Finish a session once. The delta is clamped so a refund can never exceed the
-- debit and is never positive-by-accident; replays and wrong users change nothing.
CREATE OR REPLACE FUNCTION public.end_voice_session(
  _user_id UUID, _sid TEXT, _delta INTEGER, _status TEXT
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  debit INTEGER;
  applied INTEGER;
BEGIN
  IF _sid IS NULL OR length(_sid) = 0 OR length(_sid) > 64 THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('voice:' || _user_id::text, 0));
  SELECT prompt_tokens INTO debit FROM public.ai_log
   WHERE user_id = _user_id AND intent = 'rt-mint:' || _sid;
  IF debit IS NULL THEN RETURN NULL; END IF;                       -- unknown / other user's session
  IF EXISTS (SELECT 1 FROM public.ai_log WHERE user_id = _user_id AND intent = 'rt-end:' || _sid) THEN
    RETURN NULL;                                                    -- already finished (replay)
  END IF;
  applied := GREATEST(COALESCE(_delta, 0), -debit);                 -- refund <= debit
  INSERT INTO public.ai_log (user_id, intent, model, prompt_tokens, completion_tokens, status)
  VALUES (_user_id, 'rt-end:' || _sid, 'gpt-realtime', applied, 0, left(COALESCE(_status, 'ok'), 32));
  RETURN applied;
END;
$$;

-- Charge one overage step for a bucket, once.
CREATE OR REPLACE FUNCTION public.charge_voice_overage(
  _user_id UUID, _sid TEXT, _bucket INTEGER, _tokens INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _sid IS NULL OR length(_sid) = 0 OR length(_sid) > 64 OR _tokens IS NULL OR _tokens <= 0 THEN
    RETURN FALSE;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('voice:' || _user_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.ai_log WHERE user_id = _user_id AND intent = 'rt-mint:' || _sid) THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_log WHERE user_id = _user_id AND intent = 'rt-over:' || _sid || ':' || _bucket) THEN
    RETURN FALSE;
  END IF;
  INSERT INTO public.ai_log (user_id, intent, model, prompt_tokens, completion_tokens, status)
  VALUES (_user_id, 'rt-over:' || _sid || ':' || _bucket, 'gpt-realtime', _tokens, 0, 'overage');
  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_voice_session(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.end_voice_session(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.charge_voice_overage(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_voice_session(UUID, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.end_voice_session(UUID, TEXT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.charge_voice_overage(UUID, TEXT, INTEGER, INTEGER) TO service_role;
