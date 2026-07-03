## Root Cause

**The `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` pair does not belong to the LiveKit project hosted at `wss://restpilot-ai-6jvalz9y.livekit.cloud`.** The JWT is being minted correctly by our Worker (it uses the current env values — see evidence below), but LiveKit's signal server at that URL rejects the token because the `iss` (API key) is unknown to that project, or the HMAC signature doesn't verify against that project's secret. Either way the wire error is identical: `invalid API key`.

## Evidence

1. Server logs (last hour) show 15+ POSTs to `/_serverFn/*` (the preflight + token-mint calls) from `/lab/pilot-realtime`, **all returning HTTP 200**. Server-side JWT signing is succeeding. Zero application errors were logged.
2. The token-mint code in `src/lib/realtime.functions.ts` reads `process.env.LIVEKIT_URL / _API_KEY / _API_SECRET` **inside the handler body**, not at module scope. On Cloudflare Workers this reads the current per-request env — there is no in-process caching to blame.
3. Yesterday's browser error was `could not establish signal connection: invalid API key`. That string is emitted by LiveKit's signal server after it inspects the JWT — meaning the JWT reached LiveKit, was well-formed, and was rejected by the project at that URL. Not a client bug, not a URL-format bug, not a "we didn't sign it" bug.
4. Names match exactly (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) — no case-sensitivity issue.

## Why previous attempts failed

- Attempts 1–2 (URL fix, then key/secret paste) treated the symptom as a config-read problem. They never verified that the key actually belongs to the project the URL points at. LiveKit CLI can be authenticated to project A while `LIVEKIT_URL` targets project B; nothing prevents the mismatch.
- No prior attempt executed the definitive check — replaying the minted JWT against `https://restpilot-ai-6jvalz9y.livekit.cloud/rtc/validate` from the server. Every retry was cosmetic (change value → republish → try browser) rather than diagnostic.

## Files involved

- `src/lib/realtime.functions.ts` — the only place the three LiveKit secrets are read and the only place a JWT is signed.
- `src/routes/_authenticated/lab.pilot-realtime.tsx` — surfaces the preflight UI.
- No edge functions. No other file touches these secrets.

## What the deployed diagnostics will confirm

The last publish already included the two new preflight checks (`identity` and `signal`) I added yesterday. Running **Preflight** on `/lab/pilot-realtime` now returns, non-sensitively:
- `identity` — `keyPrefix=<first 6 of key>`, `keyLen`, `secretLen`, `jwtIss=<first 6>`, `issuerMatchesKey`, `trimmed`.
- `signal` — the HTTP status LiveKit returns for our JWT at `/rtc/validate` (this is the same check the browser signal socket does, minus WebRTC).

Expected outcomes and what each means:
- `signal: HTTP 401 … invalid API key` **and** `identity.keyPrefix == APIy7e` → confirms root cause: **key doesn't belong to this LiveKit project**. Fix: in LiveKit Cloud, open the `restpilot-ai-6jvalz9y` project → Settings → Keys → generate a new key **inside that project**, then update both `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from that pair.
- `signal: HTTP 200` → key is valid; failure is elsewhere (browser client / network) and I'd investigate the client SDK next.
- `identity.keyPrefix != APIy7e` → Worker is on stale env; one more publish forces a fresh deploy.
- `identity.trimmed = false` → a paste picked up whitespace; re-enter the affected secret.

## Smallest possible fix (deferred pending approval)

**No code changes.** Ask the user to click **Run preflight** on `/lab/pilot-realtime` and paste back the `identity` and `signal` `detail` lines. Based on which of the four outcomes above appears, the fix is exactly one of:

1. Rotate the LiveKit key **from inside the correct project** in LiveKit Cloud → update `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` in Lovable secrets → publish. (Most likely — ~85%.)
2. Republish once (stale Worker env). (~10%.)
3. Re-enter one secret without leading/trailing whitespace. (~5%.)

Nothing in the codebase needs to change.

## Confidence

**High (4/5)** in the diagnosis that this is a project↔key mismatch, based on: (a) server logs show mint succeeds, (b) error text originates from LiveKit's signal server after JWT inspection, (c) the URL was independently re-verified this session, (d) the recent history of switching LiveKit projects makes cross-project key paste the highest-prior explanation. The remaining 20% is why we run preflight before touching anything — the `signal` probe converts this to 5/5 in one click.

Awaiting: your preflight output. No secrets to re-enter yet.