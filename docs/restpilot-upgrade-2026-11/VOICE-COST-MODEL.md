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
USD per minute = input x $32/1M + output x $64/1M
```
Our system prompt measures about 850 tokens (default) and is capped near 1,500 with a custom override; a test fails if it grows past the 1,500 assumed.

**Sensitivity** (USD per minute, same formula): R=2 $0.28, R=3 $0.41, **R=6 $0.75 (used)**, R=12 $1.42, R=60 (scripted) $6.80. Real typical use is far lower (cached input at $0.40/M and fewer responses per minute); this is deliberately a worst case, not an expected bill.

## Token-equivalent and the debit
`TOKEN_EQUIVALENT_USD = $0.00002` (1 token-equivalent = $20 per 1M). That makes the existing daily caps dollar ceilings: premium 500,000 = **$10/day**, free 15,000 = **$0.30/day**.

| Quantity | Value |
|---|---|
| Worst-case USD per minute (R=6) | $0.7488 |
| Token-equivalents per minute | 37,440 |
| Deadline given to the client | 180 s (3 min) |
| **Debit at mint** | **112,320 token-equivalents (about $2.25)** |
| Voice sessions per day at worst-case debit, premium (500,000) | 4 |
| Voice sessions per day, free tier (15,000) | 0 (voice is refused: the cap cannot cover one session) |

A mint is refused when `used + 112,320` would not stay under the cap. On a clean finish the server charges the real elapsed minutes (server clock, never less than what the server saw) and refunds half of the unused debit; the other half is kept on purpose (see residuals).

TTS and speech-to-text accrue in the same unit through `USAGE_ESTIMATE` in `src/lib/ai/log.server.ts`: OpenAI TTS 1 character per token-equivalent (about $0.017/1K chars), ElevenLabs 0.5 characters per token-equivalent ($0.04/1K chars), speech-to-text 2 token-equivalents per KB of audio (conservative against $0.003/min). Text tokens from Gemini are recorded as raw tokens.

## Maximum exposure
| Scenario | Per mint | Per user per day | Notes |
|---|---|---|---|
| Honest client, obeys the 3-minute deadline, worst-case traffic | $2.25 | premium: 4 sessions = about $9, bounded by the $10 cap; free: $0 | This is what the cap enforces. |
| Typical honest use | about $0.10 to $0.40 | far below the cap | Fewer responses, cached context. |
| Modified client that ignores the deadline | up to 60 min x $6.80/min = about **$408** | premium: up to 4 mints x $408 = about **$1,600**; free: $0 (cannot mint) | **Not bounded by this system.** |
| Platform worst case, N premium users all attacking | N x about $1,600 per day | | Bounded only by OpenAI account limits. |

### What a modified client can still do, and what actually stops it
- The ephemeral token lasts 60 s and only has to survive the handshake. Once connected, the session talks browser-to-OpenAI; our server cannot hang it up. The only stops are OpenAI's 60-minute session cap, OpenAI's own rate limits, and the account's spend limit.
- Our protections still hold for it: it must be a signed-in paying user (free users cannot mint), each mint costs 112,320 of a 500,000 daily cap (so at most 4 mints a day), one session may be claimed at a time (the server forgets a session 210 s after minting, so a hostile client can start another after that), mints are rate limited, and late heartbeats are charged and told to end.
- It can defeat the refund (call finish immediately and keep talking). It cannot get back more than half of the unused debit, and never more than the debit.
- **Owner action recommended:** set a hard monthly budget on the OpenAI project that holds the Realtime key (and use a dedicated project key). That is the only control that bounds the hostile case without a server-side proxy.

## Owner decisions
1. The dollar ceiling: `TOKEN_EQUIVALENT_USD` ($20/M) and the caps decide it. Today premium voice is about $10/day worst case and free users get no live voice.
2. Whether 3-minute sessions (re-mint to continue) are acceptable, or whether to raise the deadline (debit and ceiling grow linearly).
3. Whether to move live voice behind a media proxy (cost then becomes truly server-metered; large change).
