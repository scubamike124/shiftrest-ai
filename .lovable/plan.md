# Plan

## 1) Greeting fix — time-of-day salutation

Change the auto-greeting sent right after the WebRTC data channel opens so it uses the user's actual local time-of-day label ("Good morning" / "Good afternoon" / "Good evening") followed by their name, instead of the current generic "Hi {name}."

### Where

- `src/lib/realtime/openai.functions.ts` — the `mintRealtimeSession` server function that returns the session payload consumed by the client. It already returns `greetingName`; it will also return `greetingLabel` derived from the caller's local time.
  - Accept an optional `localTime` (ISO string) and `timezone` input from the client (same shape used elsewhere via `buildTimeDirective`).
  - Compute the label server-side using the existing canonical helper `greetingForHour` from `src/lib/ai/time-directive.ts` (which delegates to `getDayPart` in `src/lib/time/day-part.ts`) so it stays consistent with every other greeting surface in the app. Collapse "night" → "Good evening" as that helper already does.
  - Return `greetingLabel: "Good morning" | "Good afternoon" | "Good evening"` (fallback `"Hi"` if time is missing).

- `src/lib/realtime/useOpenAIRealtime.ts` — the `connect()` flow and `dc.onopen` greeting trigger.
  - Pass `localTime: new Date().toISOString()` and `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone` into `mint()`.
  - In `dc.onopen`, build the greeting instructions from `session.greetingLabel` + `session.greetingName`:
    - With name: `Greet {name} warmly in exactly two words: "{label}, {name}." No second sentence. Do not ask how you can help until the user speaks.`
    - Without name: `Greet the user warmly in exactly two words: "{label}." No second sentence. Do not ask how you can help until the user speaks.`
  - Keep the existing once-per-session guard (`greetingSent`) so it never fires twice.

No other surfaces or business logic change.

## 2) Silent-stop — investigate only, no code changes

Before touching anything, capture what the Realtime API actually reported for the turn that ended on "…relaxing your body and mind."

### How I'll investigate

- Read the AI Gateway logs for the most recent Realtime session and inspect the `response.done` event for that turn (`status`, `status_details.type`, `status_details.reason`, `usage.output_tokens`). The client already logs and surfaces these in the debug HUD (`src/lib/realtime/useOpenAIRealtime.ts` → `debugEvents`), and the same info is available in the gateway request detail.
- Compare against a real cutoff turn (mid-word "gentle stretch") to confirm the signature difference.

### Decision matrix (no fix applied yet — will report back first)

- `status: "completed"` → model finished its turn normally. Root cause is conversation design (assistant treated it as a natural pause and is waiting for the user). Fix would live in the session `instructions` / turn-detection settings, not `max_output_tokens`. I will propose that fix in a follow-up plan.
- `status: "incomplete"`, `reason: "max_output_tokens"`, `output_tokens: 2000` → same category as the earlier cutoffs, 2000 still not enough. Fix would be another bump (or removing the hard cap and relying on prompt discipline).
- Anything else (e.g. `content_filter`, `interruption`, transport error, no `response.done` at all) → separate root cause; I'll report the exact event and propose a targeted fix.

I will report the raw event fields back to you before implementing anything for #2.

## Out of scope

- No changes to token limits, turn detection, VAD, or system instructions in this plan.
- No changes to any other greeting surface (Home, Companion cards, briefs) — those already use the canonical helper.
