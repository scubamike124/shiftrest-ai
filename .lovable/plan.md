# LiveKit Canary Secret Test

Goal: prove whether the deployed runtime is reading the current Lovable `LIVEKIT_URL` secret, or a stale/cached value.

## Repo findings (already verified)

- `restpilot-ai-6jvalz9y` — **not present anywhere in the codebase**.
- `LIVEKIT_URL` is read in exactly one place: `src/lib/realtime.functions.ts` (lines 25 and 103), both via `process.env.LIVEKIT_URL` inside `.handler()` — no module-scope cache, no fallback string.
- No `import.meta.env.*LIVEKIT*` anywhere. LiveKit URL is server-only; there is no client build-time inlining.
- Agent worker (`agent-worker/`) reads its own env from its deploy target — separate from the app.

Conclusion from static analysis: there is no code path that could return the old URL. If it still appears, it must come from the secret store the runtime actually binds to.

## Steps

1. Update the runtime app secret `LIVEKIT_URL` to the canary value:
   `wss://canary-test-value-123.livekit.cloud`
2. Publish/redeploy the app.
3. Open `/lab/pilot-realtime` on the **published** URL (signed in) and click **Preflight**.
4. Read the `url` check line.

## Interpretation

| Preflight shows                                    | Meaning                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `wss://canary-test-value-123.livekit.cloud`        | Runtime is reading the current Lovable secret. Previous mismatch was a paste/typo issue.    |
| `wss://restpilot-kohl.f996.livekit.cloud` (intended) | Something replayed the earlier update; still fine — runtime is live.                        |
| `wss://restpilot-ai-6jvalz9y.livekit.cloud` (old)  | Runtime is bound to a stale secret store / wrong environment. Not a code fallback (proven). |

## Cleanup

5. Immediately restore `LIVEKIT_URL` to the correct value:
   `wss://restpilot-kohl.f996.livekit.cloud`
6. Publish again and rerun Preflight to confirm.

## Deliverable

Report containing: canary Preflight output, restored Preflight output, confirmation that no code fallback exists, and the conclusion (live secret vs stale deployment).

## Risks

- LiveKit realtime will be broken between step 2 and step 6 (a few minutes). Acceptable for a diagnostic.
- No code changes required.
