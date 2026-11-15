# Follow-up plan: server-mediated live voice calls

_Nov 15 2026. Proposed next PR, not built. Goal: make live-voice spend truly server-bounded, which the current browser-to-OpenAI design (see VOICE-COST-MODEL.md) cannot do._

## Problem
Today the server mints an ephemeral client secret and the browser opens the WebRTC session straight to OpenAI. After that the server cannot end the call, cannot meter it, cannot force the session settings (a modified client may override them), and the secret itself is exposed to the browser and can open several sessions until it expires.

## Design
1. **Browser sends its SDP offer to our server** (new authenticated, rate-limited endpoint, e.g. `POST /api/voice/call`), never to OpenAI. Same checks as today: auth, consent, kill switch (`REALTIME_VOICE_ENABLED`), per-user rate limit, atomic `claim_voice_session` debit.
2. **Server calls OpenAI `POST /v1/realtime/calls`** with the real API key, the SDP offer and the session configuration (model, instructions, voice, truncation, `max_output_tokens`, transcription). The key and the configuration never reach the browser. The server returns OpenAI's SDP answer to the browser.
3. **Server stores the `call_id`** (from the response `Location` header) in the ledger beside the session id (new column or `ai_log` row `rt-call:<sid>:<call_id>`).
4. **Hard deadline by hang-up.** A sweeper (scheduled job, every 15-30 s, plus a check on each heartbeat) lists sessions past `deadline + grace` with no end row and calls `POST /v1/realtime/calls/{call_id}/hangup`, then writes the end row. This ends sessions even if the client ignores the deadline.
5. **Optional sideband WebSocket** `wss://api.openai.com/v1/realtime?call_id=...` opened by the server to (a) read `response.done` usage and meter real tokens into the ledger instead of estimating, (b) re-assert settings with `session.update` (so a client cannot raise output limits), (c) hang up on overage or budget exhaustion mid-call.
6. **Removes client-secret exposure**: no ephemeral token is issued, so the "one secret, many sessions" and "token expiry does not end a session" problems disappear.
7. Keep the daily-cap accounting: debit worst case at claim, true up with metered usage (sideband) or elapsed time (no sideband), refund only what was truly unused.

## Scope
- New endpoint, sweeper job, ledger changes (`call_id`), client change in `useOpenAIRealtime.ts` (post the offer to our endpoint, set the remote description from the answer), removal of the client-secret mint path (or keep it behind the flag for rollback).
- Out of scope: changing models, voice UX, the text coach, the local crisis card (none depend on this).

## Risks
- Our server is in the media path for signaling only (SDP); audio still flows browser-to-OpenAI, so no media proxy cost. A sideband WebSocket needs a long-lived connection per call (serverless limits; may need a small worker).
- The sweeper is a new moving part: if it stops, calls run to OpenAI's 60-minute cap. Needs monitoring and an alert.
- The exact request shape of `/v1/realtime/calls` (unified interface) and the hang-up endpoint must be verified against OpenAI's docs at build time; I have not made any call to them.
- Added latency on call setup (one extra hop) and a new failure point; keep the kill switch and a rollback.

## Tests
- Kill switch off: no offer is forwarded, no debit.
- Over-budget, active-session, wrong-user, and RPC-failure paths refuse before any provider call.
- The OpenAI request carries the server-chosen session config and never a client-supplied one.
- Sweeper: a session past deadline gets exactly one hang-up call and one end row; idempotent on replay; a provider error leaves the session eligible for retry.
- Sideband (if built): `response.done` usage is written once per response; `session.update` re-asserts limits.
- PostgreSQL: ledger rows with `call_id` obey the existing claim/end locking; concurrent claims still produce one active session.
- Client: SDP answer is applied; deadline timer still hangs up locally as a second line of defence.

## Done when
A modified client cannot keep a call alive past the deadline, cannot change session limits, and per-user daily voice spend is bounded by the cap, with the OpenAI project spend limit as a final backstop.
