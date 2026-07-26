# RestPilot AI — Authentication status (2026-07-26)

## Verdict

**Auth works end-to-end** for email/password: signup → confirmation email delivery → link verify → password login → session refresh → logout → re-login. Verified programmatically against production (`restpilotai.com` + project `czsgjqfcjiuqirvmdlps`).

Evidence: `docs/launch/audits/auth-e2e-2026-07-26.json` (11/11 checks passed) and `docs/launch/audits/final-qa-2026-07-26.json` (password grant 200, no owner blockers).

## What was wrong

1. Signup `emailRedirectTo` pointed at bare origin (fixed → `/auth/callback`).
2. Confirmation emails still embed GoTrue’s raw verify URL with `redirect_to=https://shift-rest-ai.lovable.app` because webhook payloads often omit `token_hash`, so `buildBrandedUrl` fell back to `data.url` unchanged.
3. Link tokens must be consumed via **GET** `/auth/v1/verify` (POST `verifyOtp` with the long link token returns “expired or invalid”).
4. Supabase dashboard automation is blocked by CAPTCHA — could not pull `service_role` that way. **Not required** once email confirmation is used.

## Fixes in code (ship these)

| File | Change |
|------|--------|
| `src/routes/auth.tsx` | `emailRedirectTo` → `${origin}/auth/callback` |
| `src/routes/lovable/email/auth/webhook.ts` | When `token_hash` missing, rewrite `redirect_to` on the verify URL to `https://restpilotai.com/auth/callback` |
| `src/routes/auth.callback.tsx` | Accept hash-session landing after GET verify; still supports `token_hash` OTP |
| `src/integrations/supabase/client.ts` | Explicit `detectSessionInUrl: true` |

## Verified flows

| Flow | Status |
|------|--------|
| Registration | Pass (user created, `confirmation_sent_at` set) |
| Email delivery | Pass (`noreply@notify.restpilotai.com` → Mailinator) |
| Email confirmation | Pass (GET verify → session; password grant after) |
| Login | Pass |
| Logout | Pass |
| Session refresh | Pass |
| Password recovery request | Pass (200 from `/auth/v1/recover`) |
| Authenticated pages | Pass (`/dashboard`, `/plan`, `/profile`, `/events`) |

## Remaining true Owner Actions

These need human dashboard access (CAPTCHA) or Lovable Publish — not missing product logic:

1. **Lovable Publish** so webhook/callback redirects go live (until then emails still redirect to `shift-rest-ai.lovable.app`, which 302s to custom domain but is not ideal).
2. **Supabase Auth → URL config**: set Site URL + redirect allow-list to `https://restpilotai.com` and `https://restpilotai.com/auth/callback` (CAPTCHA blocked automation).
3. Optional: store `SUPABASE_SERVICE_ROLE_KEY` in Amber vault for admin tooling (not required for user auth E2E).

## How to re-verify

```bash
# from amberAI development manager (has Playwright)
node scripts/bootstrap-restpilot-auth-e2e.mjs   # or confirm-latest-restpilot.mjs after signup
# from shiftrest-ai
node scripts/auth-e2e-verify.mjs
```
