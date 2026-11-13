# RestPilot source reconciliation and repair continuation

## Source finding

The earlier repair PR (`scubamike124/restpilot-ai#1`) is based on an August 1 backup. The existing `scubamike124/shiftrest-ai` repository contains the newer Science and For Sale routes, 14-day checkout trial, settings routes, and newer realtime implementation. Its August 17 sale-page commit is `3bcbf051b7b39c1d7da13c55ee45694867513f01`; current main is `12aaebd35436c9c6793f7f4ffb563789e4658e24`.

On November 13, production `/api/public/version` returned build `b-1786931160964`, built `2026-08-17T01:46:00.964Z`, immediately after that sale-page commit. The live sale listing matches this repository. This strongly identifies the relevant newer source; it is not a byte-for-byte attestation of the deployed bundle or proof of the hosting deployment configuration.

Do not merge the older backup over production. This branch ports a bounded subset of its repairs onto the newer repository. It does not copy the older route tree, homepage, or realtime implementation. All 91 generated route imports are preserved. The homepage, Science page, and $25,000 sale page remain byte-for-byte unchanged. Recurring checkout retains the existing 14-day trial, with regression coverage for monthly and annual plans.

## Repairs in this branch

- Account deletion reports subscription lookup/cancellation and data-removal failures truthfully, retains sign-in for retry, uses the correct profile ownership key, and handles lifetime purchases. Memory clearing includes proposals and fails on partial erasure. Export paginates and refuses incomplete data. Deletion is not transactional and export is not a consistent snapshot during concurrent writes.
- Billing validates environments, products, intervals and return destinations, and verifies customer ownership without adopting accounts by email. Preview hosts must be explicitly configured with server-side `PUBLIC_APP_URL`.
- Webhooks return retryable failures when verified payment persistence fails. Unpaid or unrelated one-time purchases cannot grant lifetime access. Delayed-payment success is supported, missing metadata fails explicitly, and failed alerts do not hide retryable errors. Subscription event ordering remains unresolved; this is not full payment readiness.
- Calendar fetching allows supported provider URLs, rejects redirects and arbitrary destinations, and caps response size. Self-hosted feed URLs remain unsupported by this implementation.
- The dependency installation conflict is resolved by pinning compatible TanStack Start/Vite versions. The obsolete global `entities` alias is removed, allowing nested package versions to resolve correctly. Zod is upgraded with schema regression tests; the vulnerable adapter is removed. Both npm and Bun lockfiles are regenerated from the same resolution. Existing independent overrides are retained.
- Calendar query types and router error fallbacks compile with the current framework. Calendar UI branding now names RestPilot. Account-deletion copy reflects the existing cascade behavior.

## Verification

See the accompanying validation file and evidence for final results. Handler tests replace external services with mocks: they do not demonstrate live Stripe, Supabase, email, or calendar-provider success. The existing Science and sale-page claims have been preserved, not endorsed or independently validated.

## Remaining work before production / White Glove

1. Review this reconciled branch and verify the actual Lovable deployment target and rollback procedure.
2. Port the remaining AI admission, realtime authorization, auth/paywall polish, and other applicable repairs from `restpilot-ai#1`, adapting them to this newer source. The earlier review does not independently approve this port.
3. Resolve atomic subscription-event ordering, then exercise real Stripe sandbox lifecycle and replay/concurrency tests.
4. Verify database schema/RLS with isolated users and exercise authenticated account, AI, calendar, notification, offline and wearable journeys.
5. Verify scientific/product claims, complete premium UI review and mobile performance/accessibility checks, then run the existing White Glove conversion and real iOS build/device verification.

No production deployment, database mutation, real charge, customer email, new paid integration, or App Store submission was performed. The owner previously declined Lovable, Supabase and Stripe connections; this continuation uses existing GitHub access and local verification.

## Subsequent continuation

See [followup.md](followup.md) for the adapted AI/realtime repairs, atomic subscription synchronization, UI fixes, 216-test verification and required migration/deployment order. The remaining-work list above describes the state before that continuation; live/backend/device verification remains outstanding.
