-- Apple App Store entitlements, synchronized through RevenueCat.
--
-- Additive and inert: nothing writes these tables until the owner turns on
-- IAP_ENABLED and configures RevenueCat (docs/restpilot-upgrade-2026-11/SUBSCRIPTIONS.md).
-- Stripe tables, functions and webhooks are untouched.
--
-- One row per user and App Store environment. Rows are canonical snapshots
-- fetched from RevenueCat's REST API after a signed webhook or an
-- authenticated restore, never copied from a webhook payload. Snapshots are
-- ordered by RevenueCat's request time: an older snapshot can never overwrite
-- a newer one, so concurrent or replayed deliveries are harmless.

create table public.store_entitlements (
  user_id uuid not null references auth.users(id) on delete cascade,
  environment text not null check (environment in ('live','sandbox')),
  provider text not null default 'revenuecat' check (provider = 'revenuecat'),
  store text check (store is null or store = 'app_store'),
  product_id text check (product_id is null or length(product_id) <= 200),
  plan text check (plan is null or plan in ('monthly','annual')),
  period_type text check (period_type is null or period_type in ('trial','intro','normal','prepaid')),
  expires_at timestamptz,
  grace_expires_at timestamptz,
  will_renew boolean not null default false,
  billing_issue boolean not null default false,
  management_url text check (management_url is null or management_url like 'https://apps.apple.com/%'),
  snapshot_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, environment)
);
alter table public.store_entitlements enable row level security;
revoke all on public.store_entitlements from public, anon, authenticated;
grant select on public.store_entitlements to authenticated;
grant select, insert, update, delete on public.store_entitlements to service_role;
create policy "Users can read their own store entitlements"
  on public.store_entitlements for select to authenticated
  using (auth.uid() = user_id);

-- Processed RevenueCat webhook event IDs (at-least-once delivery dedupe).
create table public.store_webhook_events (
  event_id text primary key check (length(event_id) between 1 and 128),
  provider text not null default 'revenuecat' check (provider = 'revenuecat'),
  event_type text check (event_type is null or length(event_type) <= 64),
  processed_at timestamptz not null default now()
);
alter table public.store_webhook_events enable row level security;
revoke all on public.store_webhook_events from public, anon, authenticated;
grant select, insert on public.store_webhook_events to service_role;

create or replace function public.apply_store_entitlement(_snapshot jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid;
  env text := _snapshot->>'environment';
  written integer;
begin
  if _snapshot is null or jsonb_typeof(_snapshot) <> 'object'
     or env is null or env not in ('live','sandbox')
     or nullif(_snapshot->>'snapshot_at','') is null
     or (_snapshot->>'user_id') is null
     or (_snapshot->>'user_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'invalid store entitlement snapshot';
  end if;
  uid := (_snapshot->>'user_id')::uuid;
  -- RevenueCat aliases can name an account that has since been deleted.
  -- Nothing to grant; acknowledge instead of failing every retry.
  if not exists (select 1 from auth.users where id = uid) then
    return false;
  end if;
  insert into public.store_entitlements as cur (user_id, environment, store, product_id, plan,
    period_type, expires_at, grace_expires_at, will_renew, billing_issue, management_url, snapshot_at)
  values (uid, env, _snapshot->>'store', _snapshot->>'product_id', _snapshot->>'plan',
    _snapshot->>'period_type', (_snapshot->>'expires_at')::timestamptz,
    (_snapshot->>'grace_expires_at')::timestamptz,
    coalesce((_snapshot->>'will_renew')::boolean, false),
    coalesce((_snapshot->>'billing_issue')::boolean, false),
    _snapshot->>'management_url', (_snapshot->>'snapshot_at')::timestamptz)
  on conflict (user_id, environment) do update set
    store = excluded.store, product_id = excluded.product_id, plan = excluded.plan,
    period_type = excluded.period_type, expires_at = excluded.expires_at,
    grace_expires_at = excluded.grace_expires_at, will_renew = excluded.will_renew,
    billing_issue = excluded.billing_issue, management_url = excluded.management_url,
    snapshot_at = excluded.snapshot_at, updated_at = now()
  where cur.snapshot_at <= excluded.snapshot_at;
  get diagnostics written = row_count;
  return written > 0;
end; $$;
revoke all on function public.apply_store_entitlement(jsonb) from public, anon, authenticated;
grant execute on function public.apply_store_entitlement(jsonb) to service_role;
