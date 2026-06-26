## Rebrand to RestPilot AI + copy cleanup

This is a text-only pass. No UI redesign, no functional changes. After approval I will apply edits in one batch and search-verify nothing slipped through.

### 1. Brand rename: ShiftRest / ShiftZen → RestPilot AI

User-facing strings to rewrite (every occurrence):

- `public/manifest.webmanifest` — `name`, `short_name`
- `src/routes/__root.tsx` — title, OG/Twitter title, `apple-mobile-web-app-title`
- `src/routes/index.tsx` — header label "ShiftRest AI"
- `src/routes/auth.tsx` — page title + meta description
- `src/routes/reset-password.tsx` — page title + meta description
- `src/routes/coach.tsx` — page title
- `src/routes/plan.tsx` — page title
- `src/routes/playbooks.tsx` — page title
- `src/routes/swap.tsx` — page title
- `src/routes/paywall.tsx` — page title + hero copy ("ShiftRest Premium…")
- `src/routes/profile.tsx` — title, test-notification body, settings blurb
- `src/routes/share.tsx` — title, share title, footer ("Powered by ShiftRest AI"), share-card text
- `src/routes/privacy.tsx` — title, body mentions, support email
- `src/routes/terms.tsx` — title, body mentions, support email
- `src/routes/api/coach.ts` — system prompt brand line
- `src/components/Onboarding.tsx` — slide copy
- `src/lib/shifts.ts` — `DISCLAIMER` string

Support emails `support@shiftrest.app` / `privacy@shiftrest.app` → `support@restpilot.ai` / `privacy@restpilot.ai`.

Internal keys NOT touched (no user impact, breaking them would wipe local data):
`shiftrest.shifts.v1`, `shiftrest.prefs.v1`, `shiftrest.onboarded.v1`, migration flags, the `shiftrest-winddown` notification tag, the `revenuecat_user_id` column.

### 2. Strip Apple / App Store / iOS wording (web launch)

- `src/routes/terms.tsx` §3 — rewrite to web-only billing language. New copy:
  > Pricing: Monthly $7.99 / Annual $49.99 / Lifetime $99 (one-time). Paid subscriptions renew automatically at the listed price until cancelled. You can manage or cancel your plan anytime from your account settings. Lifetime is a one-time purchase and does not renew. Free-trial time is forfeited when a paid plan begins.
- `src/lib/subscription.ts` — drop the "RevenueCat / native iOS" comments; keep them generic ("Server-side subscription state").
- Spot-check: no other route mentions Apple ID, App Store, iOS, or RevenueCat after the sweep. (The `apple-mobile-web-app-*` meta tags stay — those are standard PWA hints, not user-visible.)

### 3. Consistency + tone polish

Standardize casing across every button, toast, title, and link label:

- "Sign In" (not "Sign in" / "Log in")
- "Sign Out" (not "Sign out")
- "Sign Up" / "Create Account" — pick one; plan uses "Create Account" for the signup CTA and "Sign Up" for the mode toggle link
- "Delete Account" (not "Delete account")
- "Forgot Password?"
- "Reset Password"
- "Restore Purchases"

Toast/error tone pass — same meaning, friendlier phrasing:
- "Sign in to start your trial." → "Sign in to start your free trial."
- "Authentication failed" → use the provider message when present, else "We couldn't sign you in. Please try again."
- "Could not start trial." → "We couldn't start your trial. Please try again."
- "Restore failed." → "We couldn't restore your purchases."
- "Could not send reset email" → "We couldn't send the reset email. Please try again."
- Onboarding skip → "Skip intro"
- Profile partner-name placeholder, empty schedule state, and the "Fine-tune how ShiftRest plans…" blurb get RestPilot-branded rewrites.

### 4. Verification

After edits I run:

```
rg -ni "shiftrest|shiftzen|apple id|app store|ios subscription|revenuecat" src public
```

and confirm zero user-facing hits (the localStorage keys and `revenuecat_user_id` column are the only allowed matches, and they're internal).

### 5. Multi-employer / multi-job — investigation only (not built)

Current shape (`public.shifts`): `id, user_id, day (0-6), start_min, end_min`. Repeats weekly, no name, no notes, no employer.

Recommended future shape (single migration, additive, backwards-compatible):

1. New table `public.jobs`
   - `id`, `user_id` (FK auth.users, cascade), `name` (e.g. "St. Mary's ER"), `color` (hex for calendar pill), `is_default boolean`, `created_at`, `updated_at`
   - RLS: owner-only; `GRANT SELECT/INSERT/UPDATE/DELETE TO authenticated`, `GRANT ALL TO service_role`.
2. Extend `public.shifts` with nullable columns — no data migration needed:
   - `job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL`
   - `label text` (shift name, e.g. "Night float")
   - `notes text`
3. Seeding: on first read, if a user has shifts but no jobs row, create a default "My Job" row and leave existing shifts with `job_id = null` (treated as the default in the UI).
4. UI impact (later phase): shift form gains Job picker + name + notes; week grid color-codes by job; Plan / Coach prompts pass the job name through so AI recommendations can say "before your St. Mary's night".
5. Risks / open questions:
   - One shift = one job (no split shifts across employers in v1).
   - Recurring weekly model stays; a true calendar-date model is a separate, bigger migration.
   - Playbooks currently call `replaceAllShifts` — must be scoped per-job once jobs ship, otherwise generating a playbook would wipe the other job's schedule.

No schema or code changes for this section in the current pass — proposal only.

### Deliverable on completion

A single message listing: every wording change applied, confirmation that brand + Apple sweep returns zero user-facing hits, any remaining copy I flagged as still confusing, and the multi-employer proposal above for your sign-off.