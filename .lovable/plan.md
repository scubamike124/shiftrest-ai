# Production Deployment Plan — Realtime AI Companion

## Goal

Get the LiveKit agent worker off your laptop and running 24/7 in the cloud, then ship one final polished realtime build for you to acceptance-test.

---

## 1. Hosting decision

**Recommendation: LiveKit Cloud Agents.**

Why it's the right fit here:
- The worker already uses `@livekit/agents` v1.5 and registers via `cli.runApp(...)` — this is exactly what LiveKit Cloud Agents runs.
- Same vendor as our LiveKit room infrastructure — no extra networking, no cold-start bridge, lowest latency to OpenAI Realtime.
- Managed autoscaling, health checks, log streaming, and rolling deploys. No servers to babysit.
- Secrets are set once in the LiveKit dashboard; the worker picks them up as env vars — identical to how it runs locally today.

Alternatives (only if LiveKit Cloud Agents isn't enabled on the account):
- **Fly.io Machines** — cheap, always-on Node process, region pinned near LiveKit. Good fallback.
- **Render / Railway background worker** — simplest UI, slightly higher latency.
- Not recommended: Cloudflare Workers (no `@livekit/rtc-node`), Vercel/Netlify (no long-lived processes), Lambda (cold starts kill realtime).

We do NOT move the worker into the TanStack app — it uses Node-only native bindings that the Cloudflare Worker runtime can't run. This is a permanent separation.

## 2. What gets deployed

Only `agent-worker/` — a self-contained Node package. The web app stays on Lovable Cloud unchanged.

Required env vars on the hosted worker:
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `OPENAI_REALTIME_API_KEY`

All four already exist as secrets in the backend; the same values get pasted into the LiveKit Cloud Agents dashboard (or Fly secrets) once.

## 3. Deployment steps (I execute)

1. Add a `livekit.toml` (or Dockerfile, depending on which path LiveKit Cloud Agents requires this month) and a clean `npm run start` entry so LiveKit Cloud can build and run the worker.
2. Deploy the worker to LiveKit Cloud Agents in the same region as our LiveKit project.
3. Register the agent name so the app's existing dispatch (which already targets `pilot-<userId>` rooms) routes to the cloud worker automatically — no frontend code change needed.
4. Verify:
   - Worker shows "registered" in LiveKit dashboard.
   - Test dispatch: open the companion in the deployed web app (with your laptop worker OFF), confirm the cloud worker picks up the job, greeting plays, round-trip works.
   - Tail cloud logs to confirm no errors across a full conversation.

If LiveKit Cloud Agents isn't available on the account, I'll fall back to Fly.io Machines using the same `agent-worker/` package and report back before proceeding.

## 4. Batched realtime polish (same build)

Bundled into the same deploy so you only test once:

- **Latency**: keep tightened VAD (`threshold 0.5`, `silence_duration_ms 500`) already in place; measure end-to-end on the cloud worker and tune only if >3s.
- **Greeting**: keep the short personalized greeting ("Hi {firstName}.") — no second sentence.
- **Full-sentence listening**: `interrupt_response: false` stays; `silence_duration_ms: 500` gives room for natural pauses without cutting you off.
- **No self-interruption**: verify the agent never barges over its own audio (server VAD + `interrupt_response:false` handles this; I'll confirm in logs).
- **Smooth playback**: confirm no transcript-vs-audio desync in the `/lab/pilot-realtime` UI against the cloud worker.

Any tuning needed after measurement happens against the cloud worker directly — you don't rebuild anything locally.

## 5. What you do

Nothing until I return with:
- Cloud worker live and registered.
- Web app published.
- My own end-to-end test log showing greeting + Q&A + latency numbers.

Then one final acceptance test from you. Your local `run-worker.cmd` becomes optional/dev-only after that.

## Technical details

- `agent-worker/worker.ts` uses `cli.runApp(new ServerOptions({...}))` at the bottom of the file — that's the standard LiveKit Agents entrypoint and requires no changes to run on LiveKit Cloud Agents.
- Build command: `npm ci && npm run build`; start command: `npm start` (runs `node dist/worker.js`).
- Node 20+ runtime.
- Agent name and room prefix (`pilot-`) already match what the app dispatches — no app-side wiring change.
- Logs stream to LiveKit Cloud console; I'll use them for verification instead of your local Command Prompt.

---

Approve and I'll execute steps 1–4, verify internally, publish, and then hand you one build for final acceptance.