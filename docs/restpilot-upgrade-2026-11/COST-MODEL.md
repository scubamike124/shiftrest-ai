# RestPilot AI cost model

Phase 7 of the November 14, 2026 upgrade authorization. No new paid provider or service is added by this work. Prices are list prices read on 2026-11-14 (sources in `AI-BENCHMARK.md` §3 and §6). **Usage per customer is an assumption** until it is replaced with real data using the query in §5.

## 1. Per-customer monthly AI cost (current models)

Assumptions:
- Token counts are measured from the production prompt builder: system prompts of about 1.4k–2.1k tokens for coach, voice and JSON intents, and about 0.6k for briefings. Conversation history is added on top.
- Output includes Gemini thinking tokens, which are billed as output and cannot be turned off on Gemini 3.

| Activity (typical engaged customer) | Calls / month | Tokens in / out per call | Model | $ / month |
|---|---|---|---|---|
| Text coach turns | 60 | 3,000 / 800 | gemini-3-flash-preview ($0.50 / $3.00 per 1M) | 0.234 |
| Spoken companion replies (LLM part) | 60 | 2,000 / 400 | same | 0.132 |
| JSON intents (right-now, previews, reviews, alarm, commute…) | 90 | 2,200 / 900 | same | 0.342 |
| Voice briefing scripts | 30 | 700 / 500 | same | 0.056 |
| Memory extraction (memory on) | 120 | 500 / 200 | gemini-3.1-flash-lite ($0.25 / $1.50) | 0.051 |
| **Text LLM subtotal** | | | | **0.82** |
| Text-to-speech: 60 replies × ~12 s + 30 briefings × ~60 s = 42 min | | | gpt-4o-mini-tts (~$0.015/min) | 0.63 |
| Speech-to-text: 60 × ~8 s = 8 min | | | gpt-4o-mini-transcribe ($0.003/min) | 0.02 |
| **Typical total** | | | | **≈ $1.47** |

Heavy customers are modelled at 3× typical (≈ $4.41). The **blended** figure assumes 80% typical and 20% heavy, giving **≈ $2.06** per active customer per month.

If a customer opts into ElevenLabs voice, TTS for the same minutes is about $1.51 instead of $0.63 ($0.04 per 1k characters).

Realtime voice (lab and private beta) is not included above. At list token prices, `gpt-realtime` audio costs about $0.10 per fully-talking minute (`gpt-realtime-2.1-mini` about $0.03; `gpt-live-1` $0.05 flat). 30 minutes per customer per month would add about $0.90–$3.00, so Realtime must stay metered and capped if it is offered.

## 2. Scale vs plan revenue

Revenue is gross list price. App Store / Google Play take 15% (small-business rate) or 30%; Stripe checkout is currently disabled on the Railway branch. The annual plan is $49.99 / 12 = $4.17 per month.

| Active customers | Revenue, all on $7.99 monthly | Revenue, all on $49.99 annual (per month) | AI cost, blended ($2.06) | AI % of revenue (monthly / annual) | AI cost with routing + caching (≈ $1.78) |
|---|---|---|---|---|---|
| 100 | $799 | $417 | $206 | 26% / 49% | $178 |
| 1,000 | $7,990 | $4,166 | $2,056 | 26% / 49% | $1,778 |
| 10,000 | $79,900 | $41,658 | $20,559 | 26% / 49% | $17,777 |

At 15% store fees, net revenue is $6.79 (monthly) or $3.54 per month (annual) per customer.

Readings:
- The **monthly plan carries AI costs comfortably**.
- The **annual plan is thin**: a heavy annual customer ($4.41 per month) costs more than the $3.54 net. Usage limits matter most there.
- AI cost scales linearly with customers; there are no volume tiers at list price. Hosting (Railway), database (Supabase), email and push are fixed or near-fixed and are not modelled here.

**Model-choice sensitivity** (text LLM subtotal per typical customer; speech unchanged; candidates are not benchmarked yet):

| Main model | Text LLM / month | Note |
|---|---|---|
| gemini-3-flash-preview (current) | $0.82 | Preview; no shutdown announced |
| gemini-3.5-flash-lite (memory on 3.5 Flash-Lite too) | $0.65 | Stable |
| gemini-3.6-flash, 2026 prices | $1.10 | Google's named successor |
| gemini-3.6-flash, **from 2027-01-01** | **$2.12** | 2.6× current |
| gpt-6-luna / claude-haiku-5-5 | ≈ $0.15 | Before reasoning tokens. Luna's default `medium` reasoning adds output. |
| gpt-6.1-terra | $1.54 | |

## 3. Cost controls, without degrading the experience

Already in place:
- Per-user rate limits: AI 20/min; TTS and STT 30/min.
- Atomic admission: 30 requests/min and 300/day.
- Daily token cap from `ai_log`: 15,000 tokens free, 500,000 premium; admins and testers are unlimited.
- Trial voice-minute accounting.
- A client-side TTS cache for fixed phrases.

Added in this PR:
1. **Streamed chat now counts toward the token cap.** It requests a usage frame; without this, the most frequent call logged 0 tokens on direct OpenAI/Gemini endpoints.
2. **Per-task routing** (`AI_MODEL_<TASK>`) with one-step rollback (`AI_ROUTING=off`). Moving JSON intents and briefings to a Flash-Lite model would cut the text LLM cost by about 25% ($0.82 → $0.62), **but only after the benchmark shows no regression** (the §2 "routing" column assumes this).
3. **Commute times are computed by the server**, so errors there can't cause a retry.

Recommended for the owner to decide (not implemented: they change limits, schema or prompt order):
- **The premium daily cap is very loose.** 500k tokens/day allows about 15M tokens/month (≈ $15). The 300 requests/day admission limit allows about $35/month of coach turns. A typical customer uses about 25k tokens/day (the §1 calls). A **premium cap of 100k tokens/day** is 4× that, enough for about 25 extra coach turns on a hard day, and bounds the worst case at about $3/month of text LLM. That is below the annual plan's net revenue, so no unexpected recurring charge is possible. This needs a migration, which another agent owns.
- **Count TTS/STT seconds** in the same allowance (today only tokens count), or cap briefing narration at 2 minutes per day.
- **Prompt caching**: Gemini and OpenAI discount repeated prompt prefixes by about 90%. The system prompt begins with the user's chosen name ("You are Lisa…"), so no prefix is shared across users. Moving static rules (data honesty, chat format, voice rules) ahead of per-user blocks would make about 1k tokens per call cacheable, roughly 15–25% of input cost. This changes prompt order, so it needs a benchmark pass first.
- **Cache JSON intents** per user for their natural lifetime: tomorrow-preview and daily-review once per day, right-now for 15–30 minutes. Opening the app shouldn't regenerate them every time.
- **Provider-side spend caps**:
  - Set a monthly budget and hard limit on the OpenAI project and on Google Cloud billing.
  - Keep using workspace credits on Lovable (it returns 402 when they run out, and the app already reports that).
  - Set a usage alert at 2× the expected monthly cost.

## 4. No new recurring charges

This work adds no subscription, provider or service. The benchmark runs only when the owner supplies a key: about $0 on the Gemini free tier, about $1–2 for the decisive OpenAI subset, and under $20 for every candidate with a cross-vendor judge. Production keeps the current models and spend until the owner approves a benchmark-backed change.

## 5. Replace the assumptions with real usage

`ai_log` already records tokens per call. Run this read-only query against production (owner or database agent) and substitute the results into §1:

```sql
select intent, model,
       count(*)                                         as calls_30d,
       count(distinct user_id)                          as users,
       round(avg(prompt_tokens))                        as avg_in,
       round(avg(completion_tokens))                    as avg_out,
       percentile_cont(0.9) within group (order by total_tokens) as p90_total
from public.ai_log
where created_at > now() - interval '30 days' and status = 'ok'
group by intent, model
order by calls_30d desc;
```

Divide `calls_30d` by the number of active subscribers to get calls per customer. Note that streamed `coach` rows logged before this PR may show 0 tokens if the provider did not include usage in the stream.
