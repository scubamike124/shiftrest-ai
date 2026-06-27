# Investigation: "Daily AI limit reached" on Coach

## Root cause

The orchestrator at `src/routes/api/ai.ts` (line 263) calls `checkAIBudget()`, which calls the Postgres function `public.has_ai_budget(uuid)`. That function sums `total_tokens` from `ai_log` over the last 24h and compares against `user_prefs.ai_daily_token_cap` (default **60,000**).

Verified against the DB for `scubamike124@gmail.com`:
- Cap: **60,000 tokens / 24h**
- Used in last 24h: **61,929 tokens** across **43 calls**
- Status: over cap → orchestrator returns HTTP 429 with `"Daily AI limit reached. It resets in 24 hours."`

This is the only gate. It's enforced **server-side in the orchestrator** (not client, not RLS, not subscription, not rate limiter). There is currently **no roles table** (`user_roles` / `app_role` do not exist), so no account is recognized as admin or tester. Subscription tier (`free`/`monthly`/`annual`/`lifetime`) is read elsewhere but is **not** consulted by the AI budget gate. So `scubamike124@gmail.com` is effectively a **Free** user from the budget's perspective — there is no admin/tester/premium bypass at all today.

`/api/coach` is a separate route — it has its own gate to inspect (see step 1 below).

## Files involved

- `src/routes/api/ai.ts` — calls `checkAIBudget`, returns the 429.
- `src/routes/api/coach.ts` — separate streaming endpoint (needs same treatment).
- `src/routes/api/brief.ts` — Voice Briefing (needs same treatment).
- `src/lib/ai/log.server.ts` — `checkAIBudget()` wrapper around the RPC.
- `supabase/migrations/.../has_ai_budget` — the SQL function defining the cap formula.
- `user_prefs.ai_daily_token_cap` — per-user override column (already exists).

## Proposed fix

### 1. Introduce roles (admin / tester) — minimal `user_roles` table

Standard Lovable pattern: enum + `user_roles` table + `has_role()` SECURITY DEFINER function. Grant `scubamike124@gmail.com` the `admin` role via migration seed.

### 2. Tiered limits enforced server-side

Rewrite `has_ai_budget(_user_id)` to apply this ladder (token-based, mapped from the requested conversation counts — Coach calls average ~1.5k tokens each, so the per-day token caps below translate to the requested conversation counts):

| Tier | Daily token cap | ~Conversations |
|---|---|---|
| Admin / Tester | **unlimited** (bypass) | unlimited |
| Premium (active subscription) | **500,000** | ~300 |
| Free | **15,000** | ~5 |

Logic in SQL:
1. If user has `admin` or `tester` role → return `true` (bypass).
2. Else if `has_active_subscription(user, 'live')` OR `…('sandbox')` → cap = 500,000.
3. Else cap = `user_prefs.ai_daily_token_cap` (default lowered to 15,000).

### 3. Better client UX

In `src/routes/coach.tsx` and `VoicePlayer.tsx`, when a 429 with the daily-limit message is returned, surface a friendlier message with a link to `/paywall` for Free users. (Admins won't hit it.)

### 4. No code change needed to Voice Coach pipeline

The TTS endpoint (`/api/tts`) is not budget-gated — only text generation is. Once text generation succeeds, voice will work unchanged. Voice Briefing (`/api/brief`) shares the same gate; the new tiered cap fixes it too.

### 5. Verification after implementation

- Sign in as `scubamike124@gmail.com` → `/coach` → send a message → expect text reply (no 429), then audio plays.
- `/plan` → Voice Briefing → expect audio.
- Confirm `ai_log` rows still write.
- Confirm a freshly-created free user is capped at ~5 conversations.

## Awaiting approval

Confirm:
1. Grant `scubamike124@gmail.com` the **admin** role (unlimited).
2. Free cap = **15,000 tokens / day** (~5 conversations).
3. Premium cap = **500,000 tokens / day** (fair-use unlimited).

Reply "approved" and I'll ship it.
