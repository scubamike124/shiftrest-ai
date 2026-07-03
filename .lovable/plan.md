
# LiveKit Agent Deployment — Handoff Plan

You are not a developer and should not be running CLI commands. Lovable cannot deploy the agent worker either — its runtime (Cloudflare Workers) physically cannot host a long-lived Node process that holds WebSockets open for the length of a voice call. That is why `agent-worker/` was built as a separate folder from day one: it was always going to run somewhere else.

Below is the smallest possible path that keeps your involvement to credentials and approval clicks.

## What is actually left

One task: get the code in `agent-worker/` running as a Node.js process on a host that can reach LiveKit Cloud and OpenAI, with the 4 secrets set. That is it. No app code changes. No RestPilot changes.

## Recommended: LiveKit Cloud Sandbox (zero developer, zero CLI)

LiveKit Cloud has a browser dashboard flow called **Agents → Deploy from GitHub** that does exactly what the CLI does, without a terminal. Your GitHub repo `ScubaMike124/shiftrestAI` is already connected, so:

Your steps (all clicks in a browser):
1. Go to cloud.livekit.io → your project → Agents → New Agent → Deploy from GitHub.
2. Authorize the LiveKit GitHub App for `ScubaMike124` (one OAuth approval).
3. Pick the `shiftrestAI` repo. Set Root Directory `agent-worker`, Build `npm install && npm run build`, Start `node dist/worker.js`, Runtime Node 20.
4. Paste the 4 values you already have: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_REALTIME_API_KEY`.
5. Click Deploy. Wait for green Running (about 2–3 minutes).
6. Tell me it is Running.

No terminal. No VS Code. No CLI. If your LiveKit plan does not expose "Deploy from GitHub" in the dashboard, fall back to the developer option below.

## Fallback: Hire a developer for 30 minutes

If the LiveKit dashboard route is not available on your plan, the remaining work truly requires someone with local terminal access. Scope for the hire:

- Skill: any Node.js developer, junior is fine.
- Time: 30 minutes end to end.
- Access needed from you: read access to `ScubaMike124/shiftrestAI`, and you paste the 4 secrets into whatever host they pick (or you share them via 1Password / Bitwarden — never plain email).
- Deliverable: agent shows Running in LiveKit Cloud, they send you the agent ID.

Cheapest hosts a developer can use if LiveKit dashboard deploy is unavailable: Railway, Render, Fly.io. All three have browser dashboards that deploy from GitHub. Cost ~$5/month.

Where to find one: Upwork, Fiverr ("deploy Node.js worker to Railway from GitHub repo"), or any developer friend. Show them `agent-worker/README.md` — it already contains the deploy instructions.

## What I do the moment the agent is Running

You send me one message: "Agent is running, ID is X." From that point I take over entirely:

1. Flip `VITE_ENABLE_REALTIME_PILOT=true` in preview only. Production stays off.
2. Run the Preflight card on `/lab/pilot-realtime` and post per-check pass/fail.
3. Drive a headless Playwright end-to-end voice test: measure time-to-first-audio, verify barge-in cuts off the assistant mid-sentence, verify clean end-session, confirm no duplicate greeting, capture transcript screenshots.
4. Return the full test report.
5. Only after you approve the report, resume RestPilot Phase 3B: wiring the tool bridge (memory, signals, sleep, recovery, schedule) into the running agent, then the rest of the RestPilot roadmap.

## What I will not do

Ask you to open a terminal. Ask you to run `lk`, `node`, `npm`, or any command. Ask you to fix a PATH variable. Ask you to troubleshoot Windows.

## Decision needed from you

Pick one:
- **A.** Try the LiveKit Cloud dashboard "Deploy from GitHub" flow yourself (6 clicks, no terminal). If the option is not visible on your plan, tell me and we switch to B.
- **B.** Hire a developer for 30 minutes. I will draft the exact job description you paste into Upwork/Fiverr if you want.

No code changes will be made until you pick.
