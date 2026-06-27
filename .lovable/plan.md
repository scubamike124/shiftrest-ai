## Root cause

`POST /api/brief` is a thin legacy wrapper that re-fetches its own origin (`/api/ai`) as a Worker self-subrequest. That subrequest is fragile on Cloudflare workerd: the forwarded URL/headers can mis-resolve, the response is opaque on failure, and any upstream error (missing `LOVABLE_API_KEY`, 402 credits, 429 rate-limit, gateway 5xx) is rethrown as a generic 500 with no captured stack — exactly what QA hit. `VoicePlayer` then treats the 500 as a hard crash and surfaces the dev error screen.

## Fix scope (no new features, no redesign)

### 1. Rewrite `src/routes/api/brief.ts` so it calls the AI gateway directly

- Drop the self-subrequest to `/api/ai`. Import `chatJSON` from `@/lib/ai/gateway.server` and the same `BRIEF_SYSTEM` prompt (extract it to `src/lib/ai/prompts.server.ts` so `/api/ai` and `/api/brief` share one source — no behavior change in `/api/ai`).
- Validate body, run the call inside `try/catch`, log the real error server-side with `console.error("brief failed", { status, message })`.
- On success: return `{ script }` (200, JSON) — same shape `VoicePlayer` already expects.
- On failure, always return **200** with a structured fallback the client can render cleanly:
  - `{ fallback: true, reason: "credits" | "rate_limit" | "unavailable", message: <user-friendly string> }`
  - Map gateway 402 → `credits`, 429 → `rate_limit`, everything else → `unavailable`.
- Best-effort `logAIRequest` (already swallows its own errors); skip if no auth header.

### 2. Harden `src/routes/api/tts.ts` the same way

- Keep the audio response on success.
- On upstream failure, return **200 JSON** `{ fallback: true, reason, message }` instead of forwarding the raw status. This prevents the voice step from crashing after a successful brief.

### 3. `src/components/VoicePlayer.tsx` — graceful UX, no double-tap

- After parsing the `/api/brief` response, check `Content-Type` / `fallback` flag. If `fallback: true`, show the friendly `message` via `toast.info` and reset state — no audio call, no crash.
- Same check after `/api/tts`: if JSON `fallback`, show toast and reset.
- Disable the "Voice briefing" button while `loading` is true (currently it swaps to a spinner row so the button is gone, but the disabled state on the action button itself is added defensively in case of fast re-clicks during state transition). Guard `generateAndPlay` with an early `if (loading) return;`.
- Keep existing `resetAudio()` + `finally { setLoading(false) }` behavior.

### 4. Verification

- Mobile preview at 375×599: open `/plan`, tap Voice briefing.
  - Happy path: audio plays.
  - Forced failure (temporarily set bad key in a local probe): toast shows "Voice briefing is temporarily unavailable. Try again shortly." and the UI returns to the idle button — no 500 screen.
- Confirm `/dashboard`, `/plan`, `/coach`, `/events`, `/profile` still load.
- Confirm AI Activity Feed still renders (we only touched `/api/brief` body; `ai_log` writes are preserved).

## Files changed

- `src/routes/api/brief.ts` — direct gateway call + fallback envelope.
- `src/routes/api/tts.ts` — fallback envelope on upstream failure.
- `src/lib/ai/prompts.server.ts` *(new, tiny)* — exports `BRIEF_SYSTEM` so `/api/ai` and `/api/brief` share it. `/api/ai` updated to import from it (no logic change).
- `src/components/VoicePlayer.tsx` — handle `fallback` JSON, guard re-entry while loading.

## Out of scope

No changes to legal, pricing, onboarding, layout, AI coach prompts, recommendation persistence, or Supabase schemas.
