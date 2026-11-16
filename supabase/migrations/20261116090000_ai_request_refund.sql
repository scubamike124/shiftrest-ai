-- Give a customer's request back when the AI provider failed them.
--
-- consume_ai_request (20261113090000) counts a request BEFORE the provider is
-- called. When the provider is down every card, retry and voice chunk was still
-- counted, so a long outage could use up the 300-a-day allowance with no answer
-- ever delivered, and the customer then stayed locked out until 00:00 UTC.
--
-- Design (the simplest that is safe):
--   * consume_ai_request now also records the admitted request in a small
--     ledger and returns its opaque token ({allowed, retry_after_seconds,
--     token}). The two limits are unchanged: 30 a minute, 300 per UTC day.
--   * refund_ai_request(_user_id, _token) gives back ONE count of the PER-DAY
--     counter for a ledger row that is still 'consumed' and was admitted on the
--     current UTC day, then marks it 'refunded' under the same row lock that
--     consume_ai_request takes. A second call, a replay, a concurrent call, a
--     token of another user and a token from an earlier UTC day are no-ops.
--   * The PER-MINUTE counter is never refunded. Every attempt keeps counting
--     against 30 a minute, so a failing provider cannot be hammered faster than
--     today, and a request that fails slowly (a timeout that crosses a minute
--     boundary) is still refunded because only the day counter is touched.
--   * The day counter never goes below zero.
-- Only service_role can call either function; no customer prompt or text is
-- stored here. has_ai_budget (the token allowance) is untouched.
create table public.ai_request_ledger (
  token uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_started date not null,
  state text not null default 'consumed' check (state in ('consumed', 'refunded'))
);
create index ai_request_ledger_user_day on public.ai_request_ledger (user_id, day_started);
alter table public.ai_request_ledger enable row level security;
revoke all on public.ai_request_ledger from public, anon, authenticated;

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
  request_token uuid;
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
  -- Earlier days can no longer be refunded: drop them (keeps the ledger at no
  -- more than one day of requests per user).
  delete from public.ai_request_ledger
    where user_id = _user_id and day_started < today;
  insert into public.ai_request_ledger (user_id, day_started)
    values (_user_id, today)
    returning token into request_token;
  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0, 'token', request_token);
end;
$$;
revoke all on function public.consume_ai_request(uuid) from public, anon, authenticated;
grant execute on function public.consume_ai_request(uuid) to service_role;

create or replace function public.refund_ai_request(_user_id uuid, _token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date;
  allowance public.ai_request_allowance%rowtype;
  entry public.ai_request_ledger%rowtype;
begin
  if _user_id is null or _token is null then
    return jsonb_build_object('refunded', false, 'reason', 'invalid');
  end if;
  -- Same lock, taken first, as consume_ai_request: a refund never interleaves
  -- with a consume, another refund, or the day rolling over.
  select * into allowance from public.ai_request_allowance
    where user_id = _user_id for update;
  if not found then
    return jsonb_build_object('refunded', false, 'reason', 'unknown_request');
  end if;
  -- The user is part of the lookup: another user's token matches nothing.
  select * into entry from public.ai_request_ledger
    where token = _token and user_id = _user_id for update;
  if not found then
    return jsonb_build_object('refunded', false, 'reason', 'unknown_request');
  end if;
  if entry.state <> 'consumed' then
    return jsonb_build_object('refunded', false, 'reason', 'already_refunded');
  end if;
  today := (clock_timestamp() at time zone 'UTC')::date;
  if entry.day_started <> today or allowance.day_started <> today then
    return jsonb_build_object('refunded', false, 'reason', 'window_closed');
  end if;
  update public.ai_request_ledger set state = 'refunded' where token = _token;
  -- Only the day counter, and never below zero. The minute counter stays consumed.
  update public.ai_request_allowance set day_count = greatest(day_count - 1, 0)
    where user_id = _user_id;
  return jsonb_build_object('refunded', true);
end;
$$;
revoke all on function public.refund_ai_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.refund_ai_request(uuid, uuid) to service_role;
