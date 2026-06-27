# Privacy & Compliance Verification Report

Status: **code paths verified by static review**. End-to-end Playwright sweep on a clean test account is the recommended final gate before announcing GA.

| # | Workflow | Backing code | Status |
|---|----------|--------------|--------|
| 1 | Signup checkbox + acceptance log | `src/routes/auth.tsx` → `recordAcceptanceFn({source:'signup'})` in `src/lib/legal/consent.functions.ts` | Verified — writes one row per legal doc into `legal_acceptances`; merges into `user_prefs.consent_json`. |
| 2 | Onboarding consent slide | `src/components/Onboarding.tsx` → `recordAcceptanceFn({source:'onboarding'})` for terms/privacy/disclaimers/safety/electronic-consent | Verified — required checkboxes block submit. |
| 3 | Cookie banner | `src/components/legal/CookieBanner.tsx` + `src/lib/legal/cookies.ts` | Verified — Accept all / Reject / Manage persist to `localStorage`; on auth mirror into `user_prefs.consent_json.cookies`. |
| 4 | Data export | `exportAccountFn` in `src/lib/account.functions.ts` → JSON bundle of 18 user-owned tables; OAuth tokens + push endpoints redacted | Verified. |
| 5 | AI memory purge | `purgeAiMemoryFn` → wipes `ai_memory`, `ai_recommendations`, `ai_feedback`, `ai_patterns`; preserves shifts/prefs | Verified. |
| 6 | Account deletion | `deleteAccountFn` → cancels Stripe sub (non-fatal try/catch) → purges 18 tables → calls `auth.admin.deleteUser` → returns `{retained:['subscriptions','legal_acceptances']}` | Verified — retained-records disclosure matches `/legal/privacy` copy. |
| 7 | Safety/health disclosures | `SafetyNote` in Right Now, Smart Alarm, Companion, AI Brief, Long Clock, Wearable; `OfflineBanner` includes emergency-services disclaimer; `RenewalDisclosure` on paywall & pricing | Verified. |

## Recommended final manual sweep

On a fresh test account:
1. Sign up → confirm `legal_acceptances` rows + `consent_json` populated.
2. Complete onboarding → confirm `source='onboarding'` rows.
3. Export → open downloaded JSON; verify tokens redacted.
4. Erase AI memory → verify shifts/prefs still present.
5. Delete account → confirm Stripe sub canceled, `auth.users` row gone, retained tables intact.
