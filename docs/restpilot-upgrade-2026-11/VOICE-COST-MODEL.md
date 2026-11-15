# Live voice cost model and maximum exposure

_Nov 15 2026. Code: `src/lib/realtime/voice-pricing.ts` (constants, one place), `src/lib/realtime/session-cost.server.ts` (enforcement), migration `20261115070000_voice_session_ledger_and_budget_rpc_lockdown.sql`. Prices were read from OpenAI and ElevenLabs pages on 2026-11-15 and can change; re-check before relying on them._

## Sources
| Fact | Value used | URL |
|---|---|---|
| gpt-realtime audio input / cached audio input / audio output, per 1M tokens | $32.00 / $0.40 / $64.00 (text in $4, text out $16) | https://developers.openai.com/api/docs/pricing |
| Audio to tokens | input 1 token per 100 ms (10/s, 600/min); output 1 token per 50 ms (20/s, 1,200/min) | https://developers.openai.com/api/docs/guides/realtime-costs |
| The whole conversation is re-sent as input on every response | cost grows with context and with responses per minute | same page |
| Maximum Realtime session | 60 minutes | https://developers.openai.com/api/docs/guides/realtime-conversations |
| Ephemeral token `expires_after` | 10 to 7,200 s (default 600) | https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create |
| Context cap `truncation.token_limits.post_instructions`, `max_output_tokens` (1 to 4,096) | documented fields, used below | same page |
| gpt-4o-mini-transcribe | about $0.003 per minute | pricing page |
| gpt-4o-mini-tts | text in $0.60 / audio out $12.00 per 1M tokens (no per-minute figure published) | pricing page |
| ElevenLabs TTS (Flash/Turbo) | $0.04 per 1,000 characters | https://elevenlabs.io/pricing/api |

Not found in the docs I could read: the model's context window size, and whether the ephemeral token ends an already-connected session (the docs do not say it does; I assume it does not). I have not made any paid call to measure real spend.

## Formula
Per minute of an honest, unmodified client in the worst case (every response re-sends the capped context as uncached audio input; the model speaks as much as real time allows):

```
ctx            = INSTRUCTION_TOKENS_ASSUMED (1,500) + post_instructions cap (2,000) = 3,500 tokens
input  tokens  = R x 3,500                       (R = responses per minute, assumed 6)
output tokens  = min(R x max_output_tokens(400), 20 tokens/s x 60) = 1,200
USD per minute = input x $32/1M + output x $64/1M + $0.006 (whisper-1 input transcription)
```
Our system prompt measures about 850 tokens (default) and is capped near 1,500 with a custom override; a test fails if it grows past the 1,500 assumed.

**Sensitivity** (USD per minute, same formula): R=2 $0.28, R=3 $0.41, **R=6 $0.75 (used)**, R=12 $1.42, R=60 (scripted) $6.80. Real typical use is far lower (cached input at $0.40/M and fewer responses per minute); this is deliberately a worst case, not an expected bill.

## Token-equivalent and the debit
`TOKEN_EQUIVALENT_USD = $0.00002` (1 token-equivalent = $20 per 1M). That makes the existing daily caps dollar ceilings: premium 500,000 = **$10/day**, free 15,000 = **$0.30/day**.

| Quantity | Value |
|---|---|
| Worst-case USD per minute (R=6, includes $0.006/min input transcription) | $0.7548 |
| Token-equivalents per minute | 37,740 |
| Deadline given to the client | 180 s (3 min) |
| **Debit at mint** | **113,220 token-equivalents (about $2.26)** |
| Voice sessions per day at worst-case debit, premium (500,000) | 4 |
| Voice sessions per day, free tier (15,000) | 0 (voice is refused: the cap cannot cover one session) |

A mint is refused when `used + 113,220` would not stay under the cap. On a clean finish the server charges the real elapsed minutes (server clock, never less than what the server saw) and refunds half of the unused debit; the other half is kept on purpose (see residuals).

TTS and speech-to-text accrue in the same unit through `USAGE_ESTIMATE` in `src/lib/ai/log.server.ts`: OpenAI TTS 1 character per token-equivalent (about $0.017/1K chars), ElevenLabs 0.5 characters per token-equivalent ($0.04/1K chars), speech-to-text 2 token-equivalents per KB of audio (conservative against $0.003/min). Text tokens from Gemini are recorded as raw tokens.

## Maximum exposure (read this first)

**For a modified premium client, live-voice spend is NOT bounded by this system.** The honest-client numbers below are bounded by the cap. The hostile numbers are not. The only hard bound is a spend limit on the OpenAI project that holds the Realtime key. That is why live voice is **disabled by default** (`REALTIME_VOICE_ENABLED` must be exactly `1`).

### Honest client (obeys the deadline)
| | Value |
|---|---|
| Worst-case traffic, $0.7548/min (a reasonable high estimate) | about $2.26 per 3-minute mint |
| Premium sessions per day at the worst-case debit | 4 (500,000 cap / 113,220) |
| Free tier | no live voice (the cap cannot cover one session) |

### Hostile client: what the cap does and does not bound
1. **Refund loop.** The finish call is client-controlled. "Mint, finish immediately, repeat" keeps half of the unused debit each time (75,480 net per session here, because sub-minute use rounds up to one minute). Under a 500,000 cap that is **6 sessions a day** (pinned by a test; a reviewer's rougher estimate was about 7), not 4. After `end_voice_session` the "one active session" check stops blocking, so each of those sessions can be a real, still-running session at OpenAI: **up to about 6 concurrent real sessions** for one user.
2. **One ephemeral token can open several concurrent sessions until it expires** (OpenAI docs: "A secret can be used to create multiple sessions until it expires"). Our claim counts one.
3. **`expires_after` does not end a connected session** (OpenAI docs: "The session itself may continue after that time once started"). Nothing on our side ends a session that ignores the deadline; only OpenAI's 60-minute cap does.
4. **Our per-session limits may not hold.** The 400-token output cap and the 2,000-token context cap are sent in the mint, but I found no OpenAI statement that the browser cannot override them with `session.update`. **Treat as unknown.** My earlier "$408 per hostile mint" assumed they hold and is **withdrawn**.
5. **Reviewer's re-derivation (not independently verified by me):** a modified client making responses of up to 4,096 output tokens over a roughly 28,000-token context can cost about $0.37 to $1.20 per response. At 60 responses a minute that is roughly **$22 to $70 per minute, about $1,300 to $4,200 per 60-minute session**, bounded only by OpenAI's own rate and token limits. Multiply by up to about 6 sessions per user per day and by every premium account that does it.
6. **Omitted before, now included:** input transcription (whisper-1, about $0.006 per minute of user audio) is now in the honest-client figure.

### What actually limits the damage
- Free users cannot mint at all; premium users only with a signed-in session, consent, a rate limit (6 mints/min) and budget for at least one debit.
- Late heartbeats are charged and told to end; the real bound on a hostile client is **an OpenAI project spend limit**.

### Required before turning voice on
1. Create a **dedicated OpenAI project and API key** used only for Realtime.
2. Set a **hard monthly budget / spend limit** on that project (and alerts).
3. Put that key in the server environment (`OPENAI_API_KEY` or `OPENAI_REALTIME_API_KEY`).
4. Only then set `REALTIME_VOICE_ENABLED=1`. Unset or any other value: minting is refused before any debit or provider call, the client shows "Voice is temporarily unavailable. You can keep using the text coach.", and the text coach and the local crisis card are unaffected.
5. The durable fix is to put voice behind our server: see VOICE-SERVER-MEDIATED-CALLS-PLAN.md.

## Owner decisions
1. The dollar ceiling for the honest case: `TOKEN_EQUIVALENT_USD` ($20/M) and the caps. Today premium voice is about $10/day worst case for honest use.
2. Whether 3-minute sessions (re-mint to continue) are acceptable, or whether to raise the deadline (debit grows linearly).
3. Approve the server-mediated calls follow-up (it is the only design that makes voice cost server-bounded).
