# Plan: Diagnose why `/rtc/validate` returns 401 after project/URL/key are verified aligned

## Current elimination status

Confirmed by prior preflight runs and your LiveKit dashboard check:
- LIVEKIT_URL = `wss://restpilot-ai-6jvalz9y.livekit.cloud` (matches project Settings)
- `LIVEKIT_API_KEY` prefix = `API7Md`, length 15, no whitespace
- `LIVEKIT_API_SECRET` length 44, no whitespace
- JWT `iss` claim equals the stored API key (issuerMatchesKey=true)
- JWT decodes with correct `sub` (identity), `video.room`, `video.roomJoin`, and unexpired `exp`
- LiveKit host is reachable (HTTP 200 on `/`)

**Still pending your confirmation:** that the LiveKit dashboard's Settings → Keys tab for project `restpilot-ai-6jvalz9y` currently lists a row whose key starts with `API7Md`. This is the last piece — please confirm before we treat the credentials as fully verified.

## Question 1 — The exact HTTP request preflight makes

`src/lib/realtime.functions.ts` (check `id: "signal"`) issues this from the Cloudflare Worker:

```
GET https://restpilot-ai-6jvalz9y.livekit.cloud/rtc/validate?access_token=<JWT>
```

- Method: `GET`
- No custom headers set (default `fetch()`); LiveKit accepts the token via either the `access_token` query param or an `Authorization: Bearer <JWT>` header — we use the query param
- Timeout: 4 s via `AbortController`
- Response body first 160 chars is logged into the `signal.detail` field

## Question 2 — Is that endpoint/auth method correct?

Yes, verified against LiveKit source (livekit/livekit `pkg/service/auth.go`) and their own troubleshooting guide (livekit.com/blog/token-troubleshooting):

- `/rtc/validate` is the documented pre-flight endpoint the signal server exposes.
- It accepts the token as `?access_token=…` OR `Authorization: Bearer …`.
- The exact 401 body `invalid API key: <key>` is emitted by `auth.go` only when either:
  a) LiveKit's key store for that project does not contain the `iss` in the JWT, OR
  b) HMAC-SHA256 signature verification fails (i.e. the stored secret for that key does not match the secret used to sign).

There is no other code path that produces that exact error text. It is not a clock-skew error (that would say "token not valid yet"), not an expired-token error ("token expired"), not a grant error ("no permissions to access the room"). It is specifically **key-not-known-or-signature-mismatch**.

## Question 3 — Can we reproduce with an independent tool?

Yes. Two independent checks, neither of which changes credentials:

**Check A — swap query param for header.** Same endpoint, different auth channel. If query param and header both 401, LiveKit's key lookup itself is failing (rules out any URL-decoding quirk). If header succeeds and query param 401, our query encoding is at fault.

**Check B — dump the JWT header + payload.** Currently we only echo `iss` prefix. We should also echo:
- JWT `alg` (must be `HS256`; anything else is rejected)
- `iat`, `nbf`, `exp` as ISO timestamps
- Worker's current `Date.now()` as ISO
- SHA-256 fingerprint (first 8 hex chars) of the secret string used to sign — proves the secret bytes signing the JWT are the exact bytes stored in `process.env`, ruling out any encoding transform (base64 vs raw, hidden Unicode chars)

**Check C — call LiveKit's `RoomServiceClient.listRooms()` from the Worker.** This uses the exact same key/secret pair against a completely different LiveKit API path (`/twirp/livekit.RoomService/ListRooms`). If it also returns "invalid API key", the credentials are genuinely wrong for the project regardless of what the dashboard shows (points at a stale-cache or wrong-account issue on LiveKit's side). If it succeeds, the problem is scoped to `/rtc/validate` and we escalate to LiveKit support with a narrow repro.

## What to build

Extend `realtimePreflight` in `src/lib/realtime.functions.ts` with three additional read-only checks. No code path outside `/lab/pilot-realtime` is touched, no secrets are logged.

- `signal-header` — repeat `/rtc/validate` with `Authorization: Bearer <JWT>` instead of query param. Report status + body snippet.
- `jwt-detail` — echo `alg`, ISO-formatted `iat`/`nbf`/`exp`, Worker `now`, and an 8-char SHA-256 fingerprint of the secret bytes (not the secret itself).
- `room-service` — call `RoomServiceClient.listRooms()` from `livekit-server-sdk` (already in deps). Report success or the exact error message.

All three run inside the existing `realtimePreflight` handler so a single "Run preflight" click surfaces them.

## Decision tree from the results

| signal (?access_token) | signal-header (Bearer) | room-service | Conclusion |
| --- | --- | --- | --- |
| 401 | 401 | 401 | Credentials genuinely invalid for this project on LiveKit's side. Open a LiveKit support ticket with the repro; do not touch our env. |
| 401 | 200 | 200 | Bug in query-param encoding — fix in preflight only. |
| 401 | 401 | 200 | `/rtc/validate` misconfigured on that LiveKit node — escalate to LiveKit. Real signal-socket connection may still work. |
| 200 | 200 | 200 | Auth is actually fine now; earlier 401 was transient. Try Start Conversation. |

## Files affected

- `src/lib/realtime.functions.ts` — add the three checks to the existing `realtimePreflight` handler, extend the `RealtimePreflightCheck["id"]` union
- `src/routes/_authenticated/lab.pilot-realtime.tsx` — no change (renders any check the handler returns)

## Confidence

High that the diagnostic will conclusively locate the fault. Given all prior eliminations, my prior on the outcomes is roughly: 60% "credentials genuinely rejected by LiveKit despite dashboard showing key present" (support ticket), 30% "one of the alternate auth paths succeeds and pinpoints an encoding/signature quirk", 10% "transient / now works".

## Waiting for approval

Awaiting your go-ahead to implement the three preflight checks. Also awaiting your one confirmation that `API7Md` is currently listed under Settings → Keys in project `restpilot-ai-6jvalz9y`.
