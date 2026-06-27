# Remaining Issues

## Known limitations (acceptable for launch)

- **Wearables — Apple Health / Garmin** still show "Coming soon". Requires native wrapper or each vendor's OAuth — out of scope for v1 web.
- **Rate limiting** — no in-app backend rate limiter (no standard primitive available). Lovable AI gateway enforces upstream 429s and the app maps them to friendly errors.
- **Audit log table** — generic `audit_log` not created. Current coverage via `legal_acceptances`, `ai_log`, `notification_log` is sufficient for compliance and AI usage; revisit if support volume needs broader event history.

## Deferred (post-launch)

- Lighthouse + axe sweeps on the published URL.
- Live Stripe test charge.
- Playwright end-to-end verification on a clean test account.
- Custom domain attachment.
- Native iOS/Android wrappers for Apple Health / HealthKit / Google Fit.

## No open critical issues.
