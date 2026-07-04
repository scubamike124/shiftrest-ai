# LIVEKIT_URL secret not updating — investigation plan

## What I already verified (no code change needed)

- Only ONE `LIVEKIT_URL` exists in the Lovable Cloud secret store for this project (confirmed via secret listing — 17 total secrets, one `LIVEKIT_URL`).
- No `.env`, `.env.production`, `.env.development`, or source file hardcodes a LiveKit URL. Repo-wide search finds `LIVEKIT_URL` only in `src/lib/realtime.functions.ts` (read as `process.env.LIVEKIT_URL` inside `.handler()`, no fallback) and in docs/plan text. There is no code override.
- Only one Lovable project (id `8243527a-…`) — published URL `shift-rest-ai.lovable.app` and custom domains `restpilotai.com` both serve the same deployment.
- Prior canary test proved runtime does read the current secret store (when `wss://canary-test-value-123…` was set, Preflight showed it).

So the "old malformed value still showing" must be caused by the **saved secret value itself still being the old string** — not code, not a second env, not a stale deployment.

## Most likely causes (in order)

1. **Mobile secret editor didn't save.** iOS Safari sometimes autocorrects `wss://restpilot-kohl1f996…` (inserts a dot, capitalization, or drops characters) or the Save tap missed. The stored value is unchanged from the previous update.
2. **Hidden whitespace / smart-quote from clipboard.** A trailing space or a Unicode lookalike would still "look" different, but here the runtime is showing the *previous* value verbatim, which points to save-not-committed rather than paste corruption.
3. **Wrong field edited.** Editing `LIVEKIT_API_KEY` or a similarly-named field instead of `LIVEKIT_URL`.
4. **Not #1 in list, ruled out:** multiple secrets, code fallback, wrong project — all disproved above.

## What I'll do (no app code changes)

1. Re-open the secret editor for `LIVEKIT_URL` from desktop (not mobile) via `update_secret`. This forces the secure form to appear so you can paste the value fresh. I cannot type the value for you — `update_secret` requires you to enter it in the form — but I can trigger the form.
2. You paste **exactly**: `wss://restpilot-kohl1f996.livekit.cloud` — from a desktop browser, not iPhone, to eliminate mobile autocorrect. Verify the visible characters before hitting Save.
3. Publish.
4. I re-run Preflight against the published deployment and report the exact `url` value the runtime sees. If it now shows `restpilot-kohl1f996.livekit.cloud`, the mobile editor was the culprit. If it still shows the old value, we've proven the secret store isn't accepting the write for this key and I'll escalate (Lovable Cloud secrets backend issue).
5. If the new URL lands but TLS still fails, that's a LiveKit dashboard question (the hostname LiveKit gave you must resolve + present a matching cert) — separate from this investigation.

## Note on your question #6

You asked if I can set the value myself. The secrets tool that updates an existing secret (`update_secret`) is designed to require you to enter the value in a secure form — I can open the form, but the value must come from you. `set_secret` (which lets me pass a value directly) only creates new secrets and silently no-ops on existing names, so it can't overwrite `LIVEKIT_URL`. That's why we keep hitting the "did the save actually land?" question — the only way to be sure is a desktop re-entry followed by a Preflight readback, which is step 1–4 above.
