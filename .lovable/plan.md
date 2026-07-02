# Owner Alerts on AI/Coach/Brief/TTS Fallbacks

## Investigation summary

Fallback paths in the four routes today log to console but never page the owner. A silent Lovable-AI or gateway outage would degrade all voice + coach + brief + intent surfaces without a single alert firing. `notifyOwner()` (`src/lib/ops/alert.server.ts`) already gives us branded ops-alert email with a 10-minute in-memory dedupe keyed by `severity:service:message`, so we can wire it in cheaply.

Coach (`/api/coach`) just forwards to `/api/ai`, so it inherits any alert wired at the AI layer — no separate hook needed.

## What counts as "infra failure" (alert-worthy)

Only these classes should page:

- **Config missing** — `LOVABLE_API_KEY` missing, `SUPABASE_URL`/`SERVICE_ROLE_KEY` missing (`AIError 500 "Backend not configured"`).
- **Upstream 5xx** — `status >= 500` from Lovable AI gateway or TTS gateway.
- **Auth to provider failed** — upstream `401` / `403` (our key rotated or revoked).
- **Quota exhausted** — upstream `402` ("credits" reason).
- **Rate-limited by provider** — upstream `429` ("rate_limit" reason) — warning severity, not critical.
- **Provider unavailable / network error** — thrown fetch error, empty model response ("unavailable" reason).

Explicitly NOT alerted:

- 400 / 401 / 403 / 404 / 422 to the caller (bad JSON, missing fields, unauthenticated user, unknown intent).
- Daily AI budget cap (`429 "Daily AI limit reached"` — that's a user quota, not infra).
- User validation failures inside handlers.

## Severity mapping

| Condition | Severity |
| --- | --- |
| Config missing (env not set) | `critical` |
| Upstream 5xx / network error / empty response | `error` |
| Upstream 401 / 403 (bad key) | `critical` |
| Upstream 402 (credits) | `critical` |
| Upstream 429 (rate limit) | `warning` |

## Dedupe strategy

Reuse the existing 10-min window in `alert.server.ts`. Key each call as `service:reason` (e.g. `ai:upstream_5xx`, `tts:credits_exhausted`, `brief:config_missing`) so:

- A burst of the same failure = 1 email per 10 min.
- Different failure classes still page independently.
- Multiple services failing from one gateway outage = ~4 emails max, all correlating.

`fireAndForget` the notify call (don't `await`) so alerting never blocks the fallback response to the user.

## Changes

### 1. `src/routes/api/ai.ts`
- In the outer `catch` (around line 578): if `status >= 500` OR the caught error is our `AIError(500, "Backend not configured")`, call `notifyOwner`. Reason = `upstream_5xx` or `config_missing`. Skip for status 400/401/429-budget.
- In `getAdminClient()` failure path (line 260-262): notify with `service: "ai", reason: "config_missing", severity: "critical"`.

### 2. `src/routes/api/brief.ts`
- Line 107-110 (missing `LOVABLE_API_KEY`): notify critical `config_missing`.
- Line 148-150 (empty model response): notify error `empty_response`.
- Line 168-174 (catch): notify based on `reasonFromStatus(status)`. Alert only for `credits` (critical), `rate_limit` (warning), `unavailable` / status>=500 (error). Do NOT alert on 400/401.

### 3. `src/routes/api/tts.ts`
- Line 110-114 (missing `LOVABLE_API_KEY`): notify critical `config_missing`.
- Line 152-160 (upstream not ok): notify on 402 (critical `credits`), 429 (warning `rate_limit`), status>=500 or auth 401/403 (error/critical `upstream_error`). Skip other 4xx.
- Line 165-168 (outer catch — network/fetch error): notify error `unavailable`.

### 4. `src/routes/api/coach.ts`
- No changes. Forwards to `/api/ai`, which owns the alert.

### 5. Optional small helper (in `src/lib/ops/alert.server.ts`)
Add a `fireAndForget(notifyOwner(...))` wrapper — trivial `void notifyOwner(...).catch(() => {})` — so call sites read cleanly and never block responses.

## Risk

- Low. Alert path is best-effort and already try/catches internally.
- Dedupe is in-memory per worker instance. On Cloudflare that means each isolate can send 1 email per 10 min; worst case ~ handful of duplicate emails during a real outage — acceptable and actually helpful signal.
- No user-visible behavior changes. Fallback envelopes returned to the client are unchanged.

## Verification after implementation

- Type-check clean.
- Manually temp-break `LOVABLE_API_KEY` in a preview to confirm one email arrives per service, then no repeats within 10 min.
- Confirm 400/validation errors do NOT trigger alerts.

Awaiting approval before implementation.
