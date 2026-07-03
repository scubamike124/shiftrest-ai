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

## Deploy (LiveKit Cloud, recommended)

```bash
cd agent-worker
npm install
npm run build
# LiveKit Cloud CLI:
lk agent deploy --project <livekit-project> --entry dist/worker.js
```

Set the following env vars in the LiveKit Cloud agent runtime:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_REALTIME_API_KEY`

## Deploy (self-hosted Node process, alternative)

```bash
LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
OPENAI_REALTIME_API_KEY=... \
node dist/worker.js
```

## Local dev

Point the RestPilot app at the same LiveKit project, run this worker
locally, then open `/lab/pilot-realtime` with `VITE_ENABLE_REALTIME_PILOT=true`.

## Notes

- Persona / instructions live in the worker so the same voice + rules apply
  regardless of which client joins. Phase 3 will inject RestPilot's
  existing system prompt via a startup fetch from the app.
- Tool bridge (memory, signals, sleep, recovery, schedule) is Phase 3 —
  the worker currently runs Realtime with no tools so we can validate the
  transport, voice quality, and barge-in in isolation.
