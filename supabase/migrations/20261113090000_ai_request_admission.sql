-- Apply before deploying routes using requireAIAdmission. Missing RPC fails closed.
-- No customer prompt, IP address or credentials are stored here.
create table public.ai_request_allowance (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_started timestamptz not null,
  minute_count integer not null check (minute_count >= 0),
  day_started date not null,
  day_count integer not null check (day_count >= 0)
);
alter table public.ai_request_allowance enable row level security;
revoke all on public.ai_request_allowance from public, anon, authenticated;

create or replace function public.consume_ai_request(_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := clock_timestamp();
  today date := (now_at at time zone 'UTC')::date;
  allowance public.ai_request_allowance%rowtype;
  retry_seconds integer;
begin
  if _user_id is null then
    raise exception 'user required';
  end if;
  insert into public.ai_request_allowance values (_user_id, now_at, 0, today, 0)
    on conflict (user_id) do nothing;
  -- Every caller for a user serializes here, including across edge isolates.
  select * into strict allowance from public.ai_request_allowance
    where user_id = _user_id for update;
  now_at := clock_timestamp();
  today := (now_at at time zone 'UTC')::date;
  if allowance.day_started <> today then
    allowance.day_started := today;
    allowance.day_count := 0;
  end if;
  if now_at >= allowance.minute_started + interval '1 minute' then
    allowance.minute_started := now_at;
    allowance.minute_count := 0;
  end if;
  if allowance.day_count >= 300 then
    retry_seconds := greatest(1, ceil(extract(epoch from
      (((today + 1)::timestamp at time zone 'UTC') - now_at)))::integer);
    return jsonb_build_object('allowed', false, 'retry_after_seconds', retry_seconds);
  end if;
  if allowance.minute_count >= 30 then
    retry_seconds := greatest(1, ceil(extract(epoch from
      (allowance.minute_started + interval '1 minute' - now_at)))::integer);
    return jsonb_build_object('allowed', false, 'retry_after_seconds', retry_seconds);
  end if;
  update public.ai_request_allowance set
    minute_started = allowance.minute_started,
    minute_count = allowance.minute_count + 1,
    day_started = allowance.day_started,
    day_count = allowance.day_count + 1
    where user_id = _user_id;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;
revoke all on function public.consume_ai_request(uuid) from public, anon, authenticated;
grant execute on function public.consume_ai_request(uuid) to service_role;
