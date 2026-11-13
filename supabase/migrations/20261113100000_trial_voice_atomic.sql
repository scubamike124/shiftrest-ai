-- Apply before the voice-usage code. Service-only, atomic increments prevent lost heartbeats.
create or replace function public.increment_trial_voice_usage(_user_id uuid, _environment text, _seconds integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare used integer;
begin
  if _user_id is null or _environment is null or _environment not in ('sandbox','live')
     or _seconds is null or _seconds < 0 or _seconds > 3600 then
    raise exception 'invalid voice usage request';
  end if;
  insert into public.trial_usage(user_id, environment, voice_seconds_used, last_updated_at)
    values (_user_id, _environment, least(3600, _seconds), now())
  on conflict (user_id, environment) do update
    set voice_seconds_used = least(3600, public.trial_usage.voice_seconds_used + excluded.voice_seconds_used),
        last_updated_at = now()
  returning voice_seconds_used into used;
  return used;
end; $$;
revoke all on function public.increment_trial_voice_usage(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.increment_trial_voice_usage(uuid,text,integer) to service_role;
