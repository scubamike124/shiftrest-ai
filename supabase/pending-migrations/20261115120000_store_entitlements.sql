-- Apple App Store entitlements, synchronized through RevenueCat.
--
-- PENDING: NOT APPLIED. Production database migrations need the owner's
-- approval. This file deliberately lives outside supabase/migrations/ so no
-- tool applies it by accident. To apply it, follow
-- docs/restpilot-upgrade-2026-11/APPLE-IAP-SETUP.md (step "Approve the
-- database migration"). Until then the code treats every Apple entitlement
-- as absent: the RevenueCat webhook answers 503, restore says "not available",
-- the app keeps its neutral screen, and Stripe works exactly as before.
--
-- Additive: two new tables and one new function. The only change to an
-- existing object is public.has_active_subscription (below), which keeps its
-- Stripe conditions verbatim and adds an OR for an active App Store row.
-- Nothing writes these tables until the owner turns on IAP_ENABLED and
-- configures RevenueCat. Stripe tables, functions and webhooks are untouched.
-- Same content as the Railway branch's
-- supabase/migrations/20261114120000_store_entitlements.sql (#16).
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

-- The AI token budget (has_ai_budget) and other SQL premium checks go
-- through has_active_subscription. Count an active App Store entitlement for
-- the same environment too, so an Apple-only subscriber gets the premium
-- budget. The Stripe conditions are unchanged. Rows here exist only once IAP
-- is switched on, and sandbox rows only while IAP_HONOR_SANDBOX=true (the
-- sync writes them empty otherwise), so with IAP off the result is unchanged.
-- Same signature, language and security as the original, so existing grants
-- are kept.
CREATE OR REPLACE FUNCTION public.has_active_subscription(
  user_uuid uuid,
  check_env text DEFAULT 'live'
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = user_uuid
    AND environment = check_env
    AND (
      (status IN ('active', 'trialing') AND (current_period_end IS NULL OR current_period_end > now()))
      OR (status = 'canceled' AND current_period_end IS NOT NULL AND current_period_end > now())
      OR (status = 'lifetime')
    )
  ) OR EXISTS (
    SELECT 1 FROM public.store_entitlements
    WHERE user_id = user_uuid
    AND environment = check_env
    AND expires_at IS NOT NULL
    AND greatest(expires_at, coalesce(grace_expires_at, expires_at)) > now()
  );
$$;
