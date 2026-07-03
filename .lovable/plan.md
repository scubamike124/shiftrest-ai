
# Phase 3A — Agent Worker Deployment Path (Investigation Only)

No code changes proposed. Answering: can Lovable deploy `agent-worker/` from the GitHub repo directly, and if not, what are the exact no-Terminal steps.

## Short answer

**No — Lovable cannot deploy `agent-worker/` for you.** Not a permission issue; a runtime issue. But you do **not** need the LiveKit CLI or any Terminal. You can deploy from the GitHub repo through the **LiveKit Cloud dashboard** in a browser.

## Why Lovable can't host it

Lovable's runtime is Cloudflare Workers (edge, request-scoped, ~30s max, no persistent outbound WebSockets at the shape agents-js needs). `agent-worker/` is a long-lived Node.js process that must hold two WebSockets open for the entire call (LiveKit ↔ worker ↔ OpenAI Realtime). Those two runtimes are incompatible. This is why the worker lives in its own folder outside the app bundle — it was always intended for an external Node host.

Lovable also has no deploy pipeline that targets third-party hosts like LiveKit Cloud, Railway, or Render. It only publishes the TanStack app to its own edge.

## Recommended path: LiveKit Cloud Agents (browser dashboard, zero Terminal)

Prerequisite: your GitHub repo containing `agent-worker/` is connected (from the previous turn).

Steps you take, all in a browser:

1. Go to https://cloud.livekit.io → sign in → pick your project.
2. Left sidebar → **Agents** → **New agent** (or **Create agent**).
3. Choose **Deploy from GitHub**. Authorize the LiveKit GitHub App for the org that owns your repo (one-time OAuth, same pattern as Lovable's GitHub connect).
4. Select the repo. Set:
   - **Root directory**: `agent-worker`
   - **Build command**: `npm install && npm run build`
   - **Start command**: `node dist/worker.js`
   - **Runtime**: Node 20+
5. **Environment variables** — paste these four:
   - `LIVEKIT_URL`
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`
   - `OPENAI_REALTIME_API_KEY`
6. Click **Deploy**. Watch the build log until status is **Running** (green). First build takes ~2–3 min.

That's it. No CLI, no `lk` command, no local Node install.

## What I do after you confirm "Running"

1. Store the same 4 values as Lovable runtime secrets so `/lab/pilot-realtime` can mint LiveKit JWTs server-side.
2. Flip `VITE_ENABLE_REALTIME_PILOT=true` in the **preview** environment only. Production stays false.
3. Run the Preflight card on `/lab/pilot-realtime` and report per-check pass/fail.
4. Drive an end-to-end voice test via headless Playwright: measure TTFA, verify barge-in, verify clean end-session, confirm no duplicate greeting, capture transcript screenshots.
5. Return the full test report before we discuss enabling the feature for anyone.

## Fallback if LiveKit Cloud Agents isn't on your plan

Railway (also zero Terminal, browser only): New Project → Deploy from GitHub → pick repo → set Root Directory `agent-worker` → paste the same 4 env vars → Deploy. You lose LiveKit's built-in agent dispatch/autoscaling, but for the hidden beta that's fine.

## What cannot be avoided on your side

- Pasting the 4 secrets into whichever host you pick — Lovable cannot push env vars into a third-party runtime.
- Clicking Deploy in that host's dashboard.

## Recommendation

Proceed with the LiveKit Cloud Agents dashboard flow above. Reply with the `owner/repo` slug (or confirm the connection) and whether you want me to prepare the 4 secrets in Lovable now (so they're ready the moment the agent turns green) or wait until after deploy.
