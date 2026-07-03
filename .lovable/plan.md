# LiveKit Connection & Companion Integration Plan

## What's already done (no work needed)

- ✅ `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_REALTIME_API_KEY` all stored as Lovable Cloud secrets
- ✅ Token-minting server function (`mintRealtimePilotToken`) built and deployed
- ✅ Preflight diagnostics endpoint (`realtimePreflight`) built
- ✅ Browser client hook (`useRealtimePilot`) with mic publish, transcript, TTFA metrics
- ✅ Hidden beta route `/lab/pilot-realtime` gated by `VITE_ENABLE_REALTIME_PILOT`
- ✅ External agent worker code in `agent-worker/` (OpenAI Realtime `gpt-realtime`, voice "marin", barge-in, transcript events)

## What's actually blocking the Companion

Two things, in this order:

1. **The stored `LIVEKIT_*` secrets may point to an older/different LiveKit project** than the one your CLI just authenticated ("RestPilot AI"). If they don't match, tokens are signed for the wrong project → clients can't join rooms.
2. **The agent worker in `agent-worker/` has never been deployed** to LiveKit Cloud. Without it, clients connect to empty rooms and hear nothing.

## Step-by-step

### Step 1 — Confirm secrets match the authenticated project (no code)
You run **one** command in your terminal:
```
lk project list
```
Paste me the output. I compare the URL/API key against the stored `LIVEKIT_URL` / `LIVEKIT_API_KEY`. If they match, we skip to Step 2. If they don't, I'll ask you to run `update_secret` for the three LiveKit values (secure form, you paste values from `lk project list --reveal`).

### Step 2 — Preflight from Lovable (no terminal)
I temporarily flip `VITE_ENABLE_REALTIME_PILOT=true` in the preview so you can open `/lab/pilot-realtime` and click **Run preflight**. Expected: all 4 checks green (env, url, jwt, reachability). This proves the app can talk to LiveKit before we spend time on the worker.

### Step 3 — Deploy the agent worker (you run 3 commands)
From your `shiftrestAI` folder in the terminal:
```
cd agent-worker
npm install
lk agent create
```
`lk agent create` walks you through a prompt (project = RestPilot AI, entry = `worker.ts`), pushes secrets, and deploys. It prints an agent ID and status. Paste me the output.

Then set the 4 runtime secrets on the agent (one command, it opens a prompt for each value — copy from Lovable Cloud → Backend → Secrets, or from `lk project list --reveal`):
```
lk agent update-secrets
```
Values needed: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_REALTIME_API_KEY`.

### Step 4 — End-to-end test on the hidden beta route
Still with `VITE_ENABLE_REALTIME_PILOT=true`, you open `/lab/pilot-realtime`, click **Start conversation**, and say "hello". Expected: Pilot voice responds in <1500ms, transcript appears, barge-in works. Paste me the "Time to first audio" number and any transcript.

### Step 5 — Wire the Companion (code, after Step 4 passes)
Only after the beta works, I make these minimal frontend edits (no business logic changes):

- Add a "Voice mode: Realtime (beta)" toggle in `AssistantSettings` → writes to a local flag `useRealtimeVoice`
- In `CompanionDock` / `CompanionQuickAsk` voice handlers, branch on that flag: if true, mount `useRealtimePilot` instead of the existing TTS+Whisper path; existing pipeline stays as fallback
- Default the flag OFF for everyone so nothing changes for existing users until you flip it on

Files touched (frontend only): `src/components/AssistantSettings.tsx`, `src/components/companion/CompanionDock.tsx`, `src/components/CompanionQuickAsk.tsx`, one new hook `src/hooks/useVoiceMode.ts`. No server function, DB, or API route changes.

### Step 6 — Production flip
Once you're happy, we set `VITE_ENABLE_REALTIME_PILOT=true` for production and you toggle the setting on your account. Zero-risk rollback: toggle it off, falls back to current voice.

## What I need from you, in order

1. Output of `lk project list` (Step 1)
2. Output of `lk agent create` (Step 3)
3. Output of `lk agent update-secrets` — just "done", don't paste values (Step 3)
4. Time-to-first-audio number from `/lab/pilot-realtime` (Step 4)

I'll handle every code change and every secret comparison. You never touch code or paste a secret in chat.

## Technical notes

- `agent-worker/` is deliberately outside the Vite bundle (uses `@livekit/rtc-node`, incompatible with Cloudflare Workers). LiveKit Cloud runs it as a Node.js process.
- Room naming: `pilot-<userId>`. Worker auto-dispatches on any participant join.
- Token TTL: 90s, refreshed by `useRealtimePilot`. No long-lived credentials on the client.
- Existing `/lab/pilot-realtime` preflight is the fastest way to catch a secret mismatch without deploying the worker.
