# Plan: Escalate to LiveKit support (no more code/env changes)

## What the diagnostics proved

All three independent server-side auth paths against `wss://restpilot-ai-6jvalz9y.livekit.cloud` return `401 invalid API key` for a JWT signed by `API7Md…`:

- `/rtc/validate?access_token=…` → 401
- `/rtc/validate` with `Authorization: Bearer …` → 401
- Twirp `RoomService.ListRooms` (completely different API path) → 401

Combined with the earlier `jwt-detail` and `identity` checks (alg `HS256`, `iss` = `API7Md…`, unexpired, no clock skew, secret bytes hashed match what's stored, no whitespace, `issuerMatchesKey=true`), there is no code or env path left where the fault could plausibly live. LiveKit itself is rejecting the credential across every endpoint.

## Question 1 — Which LiveKit account and project owns `API7Md`?

I cannot inspect LiveKit's account/project registry from here — only LiveKit knows which project a given key belongs to. The only ways to answer this are:

1. **LiveKit dashboard (you already did this)** — you confirmed you see `API7Md` listed in Settings → Keys of the project whose Settings → Project shows the WebSocket URL `wss://restpilot-ai-6jvalz9y.livekit.cloud`. That is the strongest evidence available on your side.
2. **LiveKit CLI** — `lk project list` prints every project on your CLI-authenticated account with URL + key prefixes. Not usable from iPhone.
3. **LiveKit support ticket** — support can query the internal key-to-project mapping directly and settle it definitively.

Given (1) matches, (3) is now the correct next step.

## Question 2 — Does the configured URL belong to that project?

Yes, verified two ways:
- Dashboard: the Settings → Project → WebSocket URL of the project containing `API7Md` reads `wss://restpilot-ai-6jvalz9y.livekit.cloud`.
- Preflight: `process.env.LIVEKIT_URL` echoes `wss://restpilot-ai-6jvalz9y.livekit.cloud` byte-for-byte, no scheme/host/whitespace issues.

## Question 3 — Prepare the LiveKit support case

### Where to file

- Primary: in-app support chat inside LiveKit Cloud dashboard (fastest, auto-attaches account context)
- Secondary: `support@livekit.io`
- If asked for a plan tier: mention if you're on the paid Cloud tier

### Ticket subject

> All authenticated server APIs return `401 invalid API key` for a key that is present in the project's Keys tab

### Ticket body (copy/paste)

```
Project WebSocket URL: wss://restpilot-ai-6jvalz9y.livekit.cloud
API Key prefix (first 6 chars): API7Md
API Key length: 15
API Secret length: 44 (no leading/trailing whitespace)
Key age: created less than 24 h ago
Key status in dashboard: present in Settings → Keys of the above project

Symptom: every authenticated server call to this host returns
"401 invalid API key" for JWTs signed by this key/secret pair.

Reproduced independently against three endpoints from a Cloudflare
Worker (Node 20 compat), livekit-server-sdk v2.x:

  1. GET https://restpilot-ai-6jvalz9y.livekit.cloud/rtc/validate?access_token=<JWT>
     → HTTP 401  body: invalid API key: API7Md…

  2. GET https://restpilot-ai-6jvalz9y.livekit.cloud/rtc/validate
     Authorization: Bearer <JWT>
     → HTTP 401  body: invalid API key: API7Md…

  3. RoomServiceClient(host, apiKey, apiSecret).listRooms()
     (Twirp /twirp/livekit.RoomService/ListRooms)
     → 401 invalid API key: API7Md…

JWT verification (client-side decode of our own token):
  alg=HS256, typ=JWT
  iss=<same as API key>, sub=<user id>, video.roomJoin=true
  iat, nbf, exp all sane; exp > now by ~55s at send time
  Worker clock within 1s of NTP
  SHA-256 fingerprint of secret bytes matches the value we
  paste in the dashboard (byte-for-byte, no BOM / no whitespace).

We rotated the key/secret pair once after the initial failure; the
regenerated pair exhibits the identical behavior. Reachability check
against https://restpilot-ai-6jvalz9y.livekit.cloud/ returns HTTP 200,
so the host itself is up.

Asks:
- Please confirm from your side that key `API7Md…` is currently
  active and mapped to the project served at
  wss://restpilot-ai-6jvalz9y.livekit.cloud.
- If it isn't, tell us which project it is registered against, so we
  can align LIVEKIT_URL to that project.
- If it is, please investigate why the auth path for this project
  is rejecting a token signed with a listed key/secret.
```

Optional to include if support asks: a fresh preflight screenshot from `/lab/pilot-realtime` showing all six check rows.

### What NOT to do while the ticket is open

- Don't rotate the key again — you'd invalidate the exact key ID (`API7Md…`) support is investigating.
- Don't change `LIVEKIT_URL` — same reason.
- Don't touch `src/lib/realtime.functions.ts` — the diagnostics are the evidence.

## Code/env plan

**No changes.** The plan is purely: send the ticket above, wait for LiveKit's response, then act on their answer.

## Waiting

Your go-ahead to consider this the final diagnostic step and switch to support-case mode. No further edits, publishes, or secret rotations until LiveKit replies.
