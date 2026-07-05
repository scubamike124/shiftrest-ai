# Pilot Realtime Agent Worker

**External deploy target.** This folder is NOT bundled into the RestPilot
TanStack app. It runs as a long-lived Node.js worker on LiveKit Cloud (or
any Node host); the app's Cloudflare Worker runtime cannot host it.

## What it does

1. Registers as a LiveKit Agent worker against `LIVEKIT_URL` using
   `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.
2. When a browser client (from `/lab/pilot-realtime`) joins its private
   room (`pilot-<userId>`), LiveKit dispatches this worker into the room.
3. The worker spins up an OpenAI Realtime (`gpt-realtime`) session using
   `OPENAI_REALTIME_API_KEY`, wires the participant's mic track into the
   Realtime input stream, and publishes the model's audio back into the
   room.
4. Emits transcript events on the LiveKit data channel so the browser UI
   can render them.

## Files

- `worker.ts` — LiveKit Agent entry point using `@livekit/agents` +
  `@livekit/agents-plugin-openai`.
- `package.json` — worker dependencies (kept separate from the app so it
  does not pollute the Cloudflare Worker bundle).

## Deploy to LiveKit Cloud Agents (production, 24/7)

The worker is packaged for LiveKit Cloud Agents. Files in this folder:

- `Dockerfile` — production build (Node 20, `npm ci && npm run build`, runs `node dist/worker.js start`).
- `livekit.toml` — LiveKit Cloud Agents manifest (agent name `pilot-realtime`).
- `.dockerignore` — keeps local `.env`, `dist`, `node_modules` out of the image.

### One-time setup (per LiveKit project)

```bash
# 1. Install the LiveKit CLI (one time, any machine)
curl -sSL https://get.livekit.io/cli | bash

# 2. Authenticate against the LiveKit Cloud project
lk cloud auth

# 3. From this folder, create the agent (reads livekit.toml + Dockerfile)
cd agent-worker
lk agent create
```

`lk agent create` uploads the Dockerfile, builds the image in LiveKit Cloud,
starts the worker, and registers it against the project. After this it runs
24/7 with autoscaling and log streaming — no laptop required.

### Required runtime secrets (set once in the LiveKit Cloud dashboard)

Agents → `pilot-realtime` → Secrets, or `lk agent update-secrets`:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_REALTIME_API_KEY`

### Redeploying after worker.ts changes

```bash
cd agent-worker
lk agent deploy
```

No frontend change needed — the app already dispatches into `pilot-<userId>`
rooms and LiveKit routes the job to the cloud worker.

## Deploy (self-hosted Node, alternative)

```bash
LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
OPENAI_REALTIME_API_KEY=... \
node dist/worker.js start
```

## Local dev

Point the RestPilot app at the same LiveKit project, run this worker
locally, then open `/lab/pilot-realtime` with `VITE_ENABLE_REALTIME_PILOT=true`.

### Windows local startup (Command Prompt)

1. Copy the example environment file and fill in your own values:
   ```cmd
   copy .env.example .env
   ```
2. Paste your values into `.env`:
   - `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — from your LiveKit Cloud project.
   - `OPENAI_REALTIME_API_KEY` — from your OpenAI account (must start with `sk-`).
3. Build the worker:
   ```cmd
   npm install
   npm run build
   ```
4. Start the worker:
   ```cmd
   run-worker.cmd
   ```

`run-worker.cmd` reads `.env` and sets the variables before starting `node dist/worker.js`.


## Notes

- Persona / instructions live in the worker so the same voice + rules apply
  regardless of which client joins. Phase 3 will inject RestPilot's
  existing system prompt via a startup fetch from the app.
- Tool bridge (memory, signals, sleep, recovery, schedule) is Phase 3 —
  the worker currently runs Realtime with no tools so we can validate the
  transport, voice quality, and barge-in in isolation.

<!-- deploy-trigger: semantic_vad rollout (2026-07-05) rev2 project-id -->
