-- Canonical Stripe snapshots use an optimistic revision. Read revision BEFORE
-- fetching Stripe; a concurrent writer forces a fresh provider read and retry.
create table public.subscription_sync_state (
  stripe_subscription_id text not null,
  environment text not null check (environment in ('live','sandbox')),
  revision integer not null default 0 check (revision >= 0),
  primary key (stripe_subscription_id, environment)
);
alter table public.subscription_sync_state enable row level security;
revoke all on public.subscription_sync_state from public, anon, authenticated;
grant select on public.subscription_sync_state to service_role;

create or replace function public.apply_subscription_snapshot(_snapshot jsonb, _expected_revision integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  sub_id text := _snapshot->>'stripe_subscription_id';
  env text := _snapshot->>'environment';
  current_revision integer;
  previous public.subscriptions%rowtype;
begin
  if sub_id is null or sub_id not like 'sub\_%' escape '\' or env is null or env not in ('live','sandbox')
     or _expected_revision is null or _expected_revision < 0
     or nullif(_snapshot->>'user_id','') is null
     or nullif(_snapshot->>'stripe_customer_id','') is null
     or _snapshot->>'status' is null or _snapshot->>'status' not in
       ('active','trialing','canceled','unpaid','incomplete','incomplete_expired','past_due','paused') then
    raise exception 'invalid subscription snapshot';
  end if;
  insert into public.subscription_sync_state values (sub_id, env, 0) on conflict do nothing;
  select revision into strict current_revision from public.subscription_sync_state
    where stripe_subscription_id = sub_id and environment = env for update;
  if current_revision <> _expected_revision then return false; end if;
  select * into previous from public.subscriptions where stripe_subscription_id = sub_id for update;
  if found then
    if previous.environment <> env or previous.user_id <> (_snapshot->>'user_id')::uuid
       or previous.stripe_customer_id <> _snapshot->>'stripe_customer_id' then
      raise exception 'subscription ownership mismatch';
    end if;
    if previous.status = 'canceled' and _snapshot->>'status' <> 'canceled' then
      raise exception 'canceled subscription cannot reactivate';
    end if;
  end if;
  insert into public.subscriptions(user_id,stripe_subscription_id,stripe_customer_id,
    product_id,price_id,status,current_period_start,current_period_end,cancel_at_period_end,environment)
  values ((_snapshot->>'user_id')::uuid,sub_id,_snapshot->>'stripe_customer_id',
    coalesce(_snapshot->>'product_id',''),coalesce(_snapshot->>'price_id',''),_snapshot->>'status',
    (_snapshot->>'current_period_start')::timestamptz,(_snapshot->>'current_period_end')::timestamptz,
    coalesce((_snapshot->>'cancel_at_period_end')::boolean,false),env)
  on conflict (stripe_subscription_id) do update set
    product_id=excluded.product_id,price_id=excluded.price_id,status=excluded.status,
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
    cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now();
  update public.subscription_sync_state set revision=revision+1
    where stripe_subscription_id=sub_id and environment=env;
  return true;
end; $$;
revoke all on function public.apply_subscription_snapshot(jsonb,integer) from public, anon, authenticated;
grant execute on function public.apply_subscription_snapshot(jsonb,integer) to service_role;
