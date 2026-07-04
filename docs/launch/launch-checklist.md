# RestPilot AI — Launch Checklist

Generated: 2026-06-27. Reflects state after Pre-Launch Validation pass.

## Legal

- [x] Privacy Policy (`/legal/privacy`)
- [x] Terms of Service (`/legal/terms`)
- [x] Cookie Policy (`/legal/cookies`)
- [x] AI Disclaimer (`/legal/disclaimers`)
- [x] Health & Wellness Disclaimer (`/legal/disclaimers`, `/safety`)
- [x] Subscription terms, refund/cancellation (`/legal/subscription`)
- [x] Accessibility statement (`/legal/accessibility`)
- [x] Open-source notices (`/legal/open-source`)
- [x] All `/legal/*` routes wired into footer (`src/components/site/SiteFooter.tsx`) and serve HTTP 200 on the production custom domain (`https://restpilotai.com/legal/*`). The `shift-rest-ai.lovable.app` host 302-redirects to the custom domain by design — not a 404.


## User controls

- [x] Delete account — `deleteAccountFn` (`src/lib/account.functions.ts`), surfaced on `/profile`. Stripe cancellation + multi-table purge + retained audit rows.
- [x] Export data — `exportAccountFn` JSON download from `/profile`.
- [x] Delete AI memory — `purgeAiMemoryFn` from `/profile` and `/memory`.
- [x] Memory view/edit/toggle — `/memory` page.

## Consent + cookies

- [x] First-visit cookie banner (`src/components/legal/CookieBanner.tsx`), granular toggles persist via `src/lib/legal/cookies.ts`.
- [x] Onboarding consent modal records `legal_acceptances` row server-side (`src/lib/legal/consent.functions.ts`).
- [x] Signup checkbox blocks account creation until accepted (`src/routes/auth.tsx`).

## Observability

- [x] `reportLovableError` wired in root error boundary.
- [x] Audit-style coverage: `ai_log`, `notification_log`, `legal_acceptances`.
- [ ] Manually verify push delivery on iOS Safari + Android Chrome after install (real device).

## Backups

- [x] Lovable Cloud daily Supabase backups (managed; no action required).
- [x] User-initiated portability via `exportAccountFn`.

## Support

- [x] Footer links resolve to `/legal/*` and `/safety`.
- [x] `mailto:legal@restpilot.ai` present in LegalLayout footer.

## Production environment

- [x] Runtime secrets present and match expected set (see `production-checklist.md`).
- [x] Stripe live webhook endpoint registered (`?env=live`).
- [x] Phase 1 RLS / GRANT hardening migration applied.

## Pending blocking items

1. Authenticated E2E regression — pending owner sign-in (`LOVABLE_BROWSER_AUTH_STATUS=signed_out`).
2. Live Stripe verification — pending owner approval to charge a real card.
3. Real-device cross-browser pass (iOS Safari, Android Chrome, iPad, Safari/Firefox/Edge desktop) — owner-driven.

## Final launch-phase deployment (deferred, non-blocking for feature work)

- [ ] Deploy LiveKit Realtime Companion worker to LiveKit Cloud Agents via secure secrets pipeline (no local rebuild). Reserved for final production launch phase; does not block remaining RestPilot feature work or bug fixes.

## Status

**NOT production-ready** until items 1–3 close. Static codebase, security, accessibility (public surface), and Lighthouse SEO/Best-Practices all meet bar. `/legal/*` 404 blocker cleared: custom-domain edge returns HTTP 200.
