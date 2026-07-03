# Plan: Fix LiveKit project ↔ key mismatch

## What the evidence says

- `identity` check: `keyPrefix=API7Md`, `secretLen=44`, `issuerMatchesKey=true`, `trimmed=true` — the Worker is definitely using the new key pair you just saved.
- `signal` check: `HTTP 401 — invalid API key` from `restpilot-ai-6jvalz9y.livekit.cloud`.
- JWT signing is correct, the host is reachable, the secrets are fresh. The only remaining variable is **which LiveKit Cloud project owns key `API7Md…`**. LiveKit returns 401 at `/rtc/validate` in exactly two cases: key belongs to a different project, or key was revoked in this project. Since you just created it, "different project" is overwhelmingly likely.

## The mapping problem

Each LiveKit Cloud project has:
- its own `wss://<slug>.livekit.cloud` URL
- its own independent set of API keys

A key created in project A **cannot** authenticate against project B's URL, even if you're logged into the same LiveKit account. The `<slug>` in the URL and the project the key was created in must match exactly.

Right now:
- `LIVEKIT_URL` = `wss://restpilot-ai-6jvalz9y.livekit.cloud` (project slug: `restpilot-ai-6jvalz9y`)
- `LIVEKIT_API_KEY` = `API7Md…` — LiveKit says this key is not valid for that project

## Investigation you need to do in LiveKit Cloud

I can't see inside your LiveKit dashboard, so this step is yours. Please check:

1. Open LiveKit Cloud → project switcher (top-left).
2. List every project on the account and note each one's URL slug (Settings → Project → shows `wss://<slug>.livekit.cloud`).
3. For each project, open Settings → Keys and find which project contains a key starting with **`API7Md`**.
4. Report back:
   - the slug of the project that owns `API7Md…`
   - whether a project with slug `restpilot-ai-6jvalz9y` still exists
   - whether that `6jvalz9y` project has any keys, and if so their prefixes

## Decision tree once you have that info

**Case A — `API7Md` lives in a different project (e.g. `restpilot-ai-abcd1234`)**
- Smallest fix: update `LIVEKIT_URL` to that project's `wss://…` URL. Keep the key/secret as-is. Republish. Re-run preflight.
- This is the most likely case and requires no new keys.

**Case B — `API7Md` lives in the `6jvalz9y` project, but preflight still says 401**
- The key was somehow rejected (rare — usually a caching/propagation issue on LiveKit's side, or the key was immediately revoked). Delete it in the LiveKit dashboard, create a fresh one **in that same project**, and update the two secrets again.

**Case C — the `6jvalz9y` project no longer exists (deleted, or you're on a different LiveKit account than before)**
- Pick the project you actually want to use, copy its `wss://…` URL into `LIVEKIT_URL`, and create a key inside it. Update all three (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).

## What I'll do once you confirm

- **If Case A**: I'll open the secure secret form to update `LIVEKIT_URL` only, then republish and ask you to re-run preflight.
- **If Case B**: I'll open the secure secret form to update `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` again, republish, re-run preflight.
- **If Case C**: I'll open the secure secret form to update all three, republish, re-run preflight.

No code changes in any case — `src/lib/realtime.functions.ts` is signing correctly; the fix is purely env alignment between URL and key.

## Technical notes

- The preflight `identity` line will always confirm which key the Worker is using (via `keyPrefix`).
- The preflight `signal` line hitting `/rtc/validate` is the ground-truth check for URL↔key alignment. `HTTP 200` = aligned. `HTTP 401` = mismatched.
- LiveKit URL slugs are permanent per project; you can't rename `6jvalz9y` to match a key from elsewhere.

## Awaiting

Your report of: (a) which LiveKit project owns key `API7Md…`, and (b) whether project `restpilot-ai-6jvalz9y` still exists. Then I'll execute the matching case above.
