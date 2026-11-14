-- REHEARSAL ONLY: synthetic data. No real user, email or secret appears here.
-- Shapes mirror supabase/migrations so the kit is exercised on every kind of
-- column the app uses (uuid, jsonb, inet, numeric, time, date, float, enums).
set search_path = public, extensions;

-- Four accounts: three with bcrypt passwords (GoTrue stores $2a$ hashes) and
-- one OAuth-only account (Google identity, no password).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email,
  case when u.pw is null then null else extensions.crypt(u.pw, extensions.gen_salt('bf', 10)) end,
  now() - interval '30 days',
  jsonb_build_object('provider', u.provider, 'providers', jsonb_build_array(u.provider)),
  jsonb_build_object('full_name', u.full_name),
  now() - interval '60 days', now() - interval '1 day', now() - interval '2 days', false, false
from (values
  ('11111111-1111-4111-8111-111111111111', 'rehearsal-1@example.invalid', 'rehearsal-pass-one', 'email', 'Rehearsal One'),
  ('22222222-2222-4222-8222-222222222222', 'rehearsal-2@example.invalid', 'rehearsal-pass-two', 'email', 'Rehearsal Two'),
  ('33333333-3333-4333-8333-333333333333', 'rehearsal-3@example.invalid', 'rehearsal-pass-three', 'email', null),
  ('44444444-4444-4444-8444-444444444444', 'rehearsal-4@example.invalid', null, 'google', 'Rehearsal Google')
) as u(id, email, pw, provider, full_name);

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select case when u.raw_app_meta_data->>'provider' = 'google' then '1098765432101234567890' else u.id::text end,
  u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  u.raw_app_meta_data->>'provider', now() - interval '2 days', u.created_at, u.updated_at
from auth.users u;

-- Rows the export must NOT carry (sessions are re-issued by the new project).
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', now(), now());
insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id)
values ('rehearsal-token', '11111111-1111-4111-8111-111111111111', false, now(), now(), 'aaaaaaaa-0000-4000-8000-000000000001');

-- profiles were created by the on_auth_user_created trigger; give them state.
update profiles set subscription_tier = 'pro', trial_ends_at = '2026-08-01T00:00:00Z', welcomed_at = '2026-07-01T12:00:00Z'
where id = '11111111-1111-4111-8111-111111111111';

insert into user_roles (user_id, role) values ('11111111-1111-4111-8111-111111111111', 'admin');

insert into user_prefs (user_id, wind_down_min, sleep_hours, lat, lon, location_label, cycle_weeks, cycle_anchor, assistant_name, memory_enabled)
values ('11111111-1111-4111-8111-111111111111', 45, 7.5, 47.6062095, -122.3320708, 'Rehearsal City', 2, '2026-10-05', 'Pilot', true),
       ('22222222-2222-4222-8222-222222222222', 30, 8.5, 40.7128, -74.006, 'Second City', 1, '2026-10-12', 'Coach', false);

insert into notification_prefs (user_id, quiet_start, quiet_end, daily_cap, timezone)
values ('11111111-1111-4111-8111-111111111111', '22:30', '06:45', 6, 'America/Los_Angeles');

insert into employers (id, user_id, name, color, pay_rate, pay_currency, metadata)
values ('e0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Rehearsal Hospital', '#3366ff', 41.75, 'USD', '{"unit":"ICU","tags":["nights"]}');

insert into shifts (user_id, day, start_min, end_min, title, shift_type, employer_id, tz, start_utc, end_utc)
select '11111111-1111-4111-8111-111111111111', d % 7, 1140, 1860 - 1440, 'Night ' || d, 'night',
  'e0000000-0000-4000-8000-000000000001', 'America/Los_Angeles',
  timestamptz '2026-11-01 03:00:00+00' + make_interval(days => d), timestamptz '2026-11-01 15:00:00+00' + make_interval(days => d)
from generate_series(0, 24) d;

insert into coach_messages (user_id, role, content, created_at)
select case when n % 2 = 0 then '11111111-1111-4111-8111-111111111111'::uuid else '22222222-2222-4222-8222-222222222222'::uuid end,
  case when n % 3 = 0 then 'assistant' else 'user' end,
  E'Synthetic message ' || n || E' with tab\tand newline\nand quote '' and backslash \\ and unicode éñ😴',
  timestamptz '2026-11-01 00:00:00+00' + make_interval(mins => n)
from generate_series(1, 120) n;

insert into ai_memory (user_id, content, category, confidence, pinned, importance)
values ('11111111-1111-4111-8111-111111111111', 'Prefers a 20 minute nap before nights', 'preferences', 0.875, true, 3),
       ('22222222-2222-4222-8222-222222222222', 'Avoids caffeine after 02:00', 'preferences', 0.5, false, 1);

insert into legal_acceptances (user_id, document_slug, document_version, ip, user_agent, source, snapshot_json)
values ('11111111-1111-4111-8111-111111111111', 'terms', '2026-06-27', '203.0.113.7', 'RehearsalAgent/1.0', 'signup', '{"accepted":true}'),
       ('22222222-2222-4222-8222-222222222222', 'privacy', '2026-06-27', '2001:db8::1', 'RehearsalAgent/1.0', 'signup', '{}');

insert into wearable_readings (user_id, provider, date, sleep_start, sleep_end, sleep_duration_min, sleep_efficiency, hrv_ms, resting_hr, raw)
select '11111111-1111-4111-8111-111111111111', 'oura', date '2026-10-01' + d,
  timestamptz '2026-10-01 16:00:00+00' + make_interval(days => d), timestamptz '2026-10-01 23:30:00+00' + make_interval(days => d),
  450 - d, 88.5 + d / 10.0, 42.125, 58, jsonb_build_object('score', 80 + d % 10)
from generate_series(0, 29) d;

-- A historical subscription row (read-only on Railway: checkout is disabled).
insert into subscriptions (user_id, stripe_subscription_id, stripe_customer_id, product_id, price_id, status,
  current_period_start, current_period_end, cancel_at_period_end, environment)
values ('11111111-1111-4111-8111-111111111111', 'sub_rehearsal_1', 'cus_rehearsal_1', 'prod_rehearsal', 'restpilot_monthly', 'active',
  '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', false, 'live');
-- A lifetime purchase: the offer is retired for NEW customers, but existing
-- lifetime entitlements must survive the migration intact.
insert into subscriptions (user_id, stripe_subscription_id, stripe_customer_id, product_id, price_id, status,
  current_period_start, current_period_end, cancel_at_period_end, environment)
values ('33333333-3333-4333-8333-333333333333', 'cs_rehearsal_lifetime_1', 'cus_rehearsal_3', 'prod_rehearsal_lifetime', 'restpilot_lifetime', 'lifetime',
  '2026-08-01T00:00:00Z', null, false, 'live');

insert into email_send_log (message_id, template_name, recipient_email, status, metadata)
values ('msg-rehearsal-1', 'welcome', 'rehearsal-1@example.invalid', 'sent', '{"attempt":1}');
insert into suppressed_emails (email, reason) values ('bounced@example.invalid', 'bounce');

-- Project plumbing that lives outside the app tables (recreated, not copied).
select pgmq.send('auth_emails', '{"to":"rehearsal-2@example.invalid","template":"recovery"}');
select vault.create_secret('rehearsal-not-a-real-secret', 'email_queue_service_role_key', 'rehearsal');
select vault.create_secret('rehearsal-not-a-real-cron-secret', 'restpilot_cron_secret', 'rehearsal');
select cron.schedule('restpilot-notify-tick', '*/5 * * * *', $$select net.http_post(url := 'https://restpilotai.com/api/public/hooks/notify', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'restpilot_cron_secret')), body := '{}'::jsonb)$$);
select cron.schedule('restpilot-dispatch-alarms', '* * * * *', $$select net.http_post(url := 'https://restpilotai.com/api/public/hooks/dispatch-alarms', headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'restpilot_cron_secret')), body := '{}'::jsonb)$$);
select cron.schedule('process-email-queue', '5 seconds', $$select net.http_post(url := 'https://restpilotai.com/lovable/email/queue/process', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key')), body := '{}'::jsonb)$$);
