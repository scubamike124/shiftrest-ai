## Investigation Findings

### Where LiveKit is used
- `src/lib/realtime.functions.ts` — reads `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` from `process.env` inside the handler (correct pattern — reads per-request, not cached at module load), then mints a JWT via `livekit-server-sdk`'s `AccessToken`.
- `src/routes/_authenticated/lab.pilot-realtime.tsx` — invokes `realtimePreflight` and `mintRealtimePilotToken`.
- No edge functions involved. Token minting runs in the TanStack Start server (Cloudflare Worker).

### What the existing preflight already proves
The preflight (`realtimePreflight`) already reports:
1. env vars present
2. URL shape valid (`wss://…`)
3. JWT signs + decodes locally with correct identity/room/exp
4. LiveKit host HTTPS reachability

If preflight is fully green but the browser still gets "invalid API key" from the LiveKit signal server, the JWT is being signed with a key/secret pair that does **not** belong to the LiveKit project at the URL. LiveKit rejects at signal-connect time because it looks up the `iss` (API key) inside its project and doesn't find it (or the HMAC signature doesn't verify against that project's secret).

### Most likely root causes (in order)
1. **Key/URL mismatch** — the new `LIVEKIT_API_KEY` (`APIy7eHJeNA34Jz`) belongs to a different LiveKit project than `wss://restpilot-ai-6jvalz9y.livekit.cloud`. LiveKit CLI can be authenticated to project A while the URL points at project B; nothing prevents that.
2. **Secret update didn't propagate to the running Worker** — Cloudflare Workers pick up new env only on redeploy. If the last publish happened before the secret write committed, the Worker still holds the old values.
3. **API secret got truncated / has stray whitespace** when pasted into the secure form (leading/trailing space breaks HMAC signature; symptom is identical to "invalid API key").

### Files involved
- `src/lib/realtime.functions.ts` (token minting + preflight)
- `src/routes/_authenticated/lab.pilot-realtime.tsx` (UI that displays checks)
- No other file reads these three secrets.

### Diagnostics to add (safe, no secret exposure)
Extend `realtimePreflight` with a new `identity` check block that returns, non-sensitively:
- `livekitHost` — the host portion of `LIVEKIT_URL` (already public).
- `apiKeyPrefix` — first 6 chars of `LIVEKIT_API_KEY` (e.g. `APIy7e`) so we can eyeball-match against what LiveKit dashboard shows.
- `apiKeyLength` and `apiSecretLength` — catch truncation / whitespace (LiveKit keys are typically ~15 chars, secrets ~43).
- `jwtIssuer` — decode the `iss` claim of the minted JWT and confirm it equals `apiKeyPrefix`'s full value; proves the SDK used the key we expect.
- `signalProbe` — perform a real WebSocket `GET /rtc/validate?access_token=<minted>` request against the LiveKit host (LiveKit responds `200` when the key is valid for that project, `401`/`403` with `invalid API key` when it isn't). This is the definitive check — it exercises the exact path the browser fails on, from the server, without WebRTC.

The `signalProbe` result will directly distinguish cause #1 (key belongs to a different project) from cause #2 (stale env in Worker — Worker's prefix wouldn't match what you just pasted).

### Restart / propagation
A publish IS the "restart" on this platform — each publish deploys a fresh Worker instance with the current secret snapshot. There is no separate restart button. If the publish that ran after the secret update finished successfully (visible in the deploy log), the new values are live. If in doubt, one more publish forces a redeploy.

### Proposed minimal change (pending approval)
Add the four diagnostic fields above to `realtimePreflight` in `src/lib/realtime.functions.ts` and render them in the existing preflight panel in `src/routes/_authenticated/lab.pilot-realtime.tsx`. No changes to `mintRealtimePilotToken`, no changes to secrets, no new files.

Once you rerun preflight we'll see one of:
- `signalProbe: 200` → key is valid; browser failure is elsewhere (network / client SDK version).
- `signalProbe: 401 invalid API key` + `apiKeyPrefix` matches what you pasted → key genuinely doesn't belong to the `restpilot-ai-6jvalz9y` project. Fix: generate a new key **inside that project** in LiveKit Cloud and paste both key + secret.
- `apiKeyPrefix` does **not** match what you pasted → Worker is running stale secrets; one more publish fixes it.
- `apiSecretLength` unexpectedly short → paste got truncated; re-enter secret.

Awaiting approval before editing.