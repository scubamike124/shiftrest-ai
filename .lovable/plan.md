# Phase 3A — Agent Worker Deployment Investigation

No app code changes proposed. This is a deployment-path analysis only.

## What already exists

- `agent-worker/` builds cleanly (`npm run build` → `dist/worker.js`), pinned to `@livekit/agents@^1.5.0` with the OpenAI Realtime plugin.
- Preflight route `/lab/pilot-realtime` can validate `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_REALTIME_API_KEY` and JWT signing before we point real traffic at a worker.
- Feature flag `VITE_ENABLE_REALTIME_PILOT` is still `false`. Production Companion untouched.

## The hard constraint

The agent worker is a **long-lived Node process** that holds outbound WebSockets to both LiveKit and OpenAI Realtime for the entire duration of every call. That rules out:

- Lovable Cloud runtime (Cloudflare Workers-class; no long-lived Node process, no persistent WS egress at the shape agents-js expects).
- Vercel / Netlify / Cloudflare Pages Functions (same reason — request-scoped).
- Supabase Edge Functions (Deno, short-lived).

So the worker **cannot run inside Lovable**. It has to live on a host that offers an always-on Node runtime.

## Deployment options, ranked by how little Terminal you have to touch

### Option 1 — LiveKit Cloud Agents (recommended, near-zero Terminal)

LiveKit Cloud has a first-party Agents hosting product. You give it a Git repo containing `agent-worker/`, it builds and runs it, and it handles autoscaling + dispatch into rooms automatically.

What you do:
1. In the LiveKit Cloud dashboard → **Agents** → **New agent** → connect the RestPilot repo, point it at the `agent-worker/` subdirectory.
2. In the same dashboard, paste the 4 env vars (`OPENAI_REALTIME_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).
3. Click Deploy. Dashboard shows build logs and a green "running" state.

Terminal required: **none**. Everything is dashboard-driven. This is the option I'd pick.

Caveat: LiveKit Cloud Agents is billed per agent-minute on top of your LiveKit bandwidth. If your current LiveKit plan doesn't include Agents hosting you'll be prompted to enable it — no card change beyond that.

### Option 2 — Railway / Render / Fly.io (zero Terminal on Railway & Render, one command on Fly)

All three can deploy a Node service from a GitHub repo through their web UI.

- **Railway**: New Project → Deploy from GitHub → pick repo → set Root Directory to `agent-worker` → paste 4 env vars → Deploy. No Terminal.
- **Render**: New → Background Worker → connect repo → root `agent-worker`, build `npm install && npm run build`, start `node dist/worker.js` → paste env vars. No Terminal.
- **Fly.io**: Requires `flyctl` locally (`fly launch` + `fly deploy`). Two commands, but only if you specifically want Fly.

Downside vs Option 1: you lose LiveKit's built-in agent dispatch/autoscaling — the worker connects as a participant to any room matching its config, which is fine for the beta but less polished at scale.

### Option 3 — LiveKit CLI (`lk agent create`)

This is what I described last turn. It does work but it needs `@livekit/cli` installed on your machine plus `lk cloud auth login`. Superseded by Option 1's dashboard flow — same product, no Terminal.

## What *cannot* be avoided on your side

Regardless of option:
- You must paste the 4 secrets into whichever host you pick (LiveKit Cloud, Railway, Render, Fly). Lovable can't push env vars to a third-party host.
- After the worker is live, you must set `VITE_ENABLE_REALTIME_PILOT=true` in the Lovable **preview** environment (not production) so the hidden route renders. I can do that flip from here once you say go.

## What I can do from Lovable after your deploy

- Run the Preflight card on `/lab/pilot-realtime` and read pass/fail per check.
- Drive a full test conversation from a headless browser (Playwright in the sandbox) to measure TTFA, verify barge-in, verify clean teardown, and screenshot transcripts.
- Report back with latency numbers and any blockers before Phase 3B.

## Cost / complexity / risk

- Cost: LiveKit Cloud Agents ~ pennies/minute on top of existing LiveKit + OpenAI Realtime charges. Railway/Render free tiers cover the beta.
- Complexity: Option 1 is a 5-minute dashboard task.
- Risk: worker crash-loops if any of the 4 env vars is wrong — Preflight catches 3 of 4 before you deploy. OpenAI Realtime key can only be verified by actually running the worker.
- Rollback: delete the agent in the host's dashboard, or leave it running and just keep `VITE_ENABLE_REALTIME_PILOT=false`. Production Companion is unaffected either way.

## Recommendation

Go with **Option 1 (LiveKit Cloud Agents dashboard)**. Zero Terminal, first-party integration, easiest rollback. If for any reason LiveKit Cloud Agents isn't available on your plan, fall back to **Railway** — also zero Terminal.

Awaiting approval before I make any code or config changes.
