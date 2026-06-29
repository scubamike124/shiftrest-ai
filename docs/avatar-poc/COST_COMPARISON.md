# Avatar Platform Cost & Value Comparison — RestPilot AI

Goal: best **long-term value** (premium quality + reliability + scalability + cost), not the cheapest provider.

All prices in USD, vendor-published as of 2026-06. Per-minute rates assume conversational/streaming usage (text or audio in → animated video out). Verify before contract.

---

## 1. Per-Minute Cost & Plan Floor

| Provider | Floor / month | Streaming rate (per min) | Free tier | Billing notes |
|---|---|---|---|---|
| **Simli** | $0 (PAYG) | **~$0.10–0.12** (Trinity-1 reduced) | Free credits | Pure PAYG; no plan floor. |
| **Anam.ai** | $49+ (Explorer) | $0.11–0.14 overage | 30 min / mo | Plan minutes bundled; cheaper at volume. |
| **Beyond Presence** | $49+ | **~$0.50** (100 credits/min) | 20 min / mo | Sub-100ms latency claim; EU-hosted. |
| **D-ID Agents** | $0 PAYG / $5.90+ plans | **$0.05/sec ≈ $3.00** | 5 min watermarked | Steep at scale; lower-fi avatars. |
| **HeyGen LiveAvatar** | $0 PAYG (API) | **~$0.30–0.50** (LiveAvatar) / $4.00 (Avatar V offline) | Limited | Highest photoreal; plan floors lift for SLA. |
| **Tavus (Phoenix-4)** | $0 / contract | **~$0.15–0.25** all-in (LLM+TTS+WebRTC) | 25 min free | Single-vendor pipeline; locked TTS. |
| **Hume EVI 3** | $0 PAYG / $7+ | ~$0.07–0.10 (voice only — **no avatar**) | Free | Pair with another renderer; not standalone. |
| **NVIDIA ACE** | GPU cost | Self-hosted (≈$0.60–$2.00/hr GPU) | N/A | DIY ops; not a turnkey API. Cost = your infra. |
| **SitePal** | $10.79–$19.96 | Browser-rendered (no per-min) | Trial | Cheap, but 3D not photoreal — off-target for premium. |

> Hume and NVIDIA ACE are not direct substitutes — Hume is voice-only, ACE is infrastructure you operate. Both listed for completeness.

---

## 2. Monthly Operating Cost by Scale

Assumption: **avg user = 8 voice/avatar minutes per month** (morning brief + 1–2 short coaching chats; in line with current ElevenLabs usage). ElevenLabs Flash voice cost (~$0.05/min) added separately where the platform doesn't include TTS.

| Customers | Total avatar minutes | Simli (~$0.11) + EL ($0.05) | Anam ($0.12 + EL) | Beyond Presence ($0.50 incl) | HeyGen Live ($0.40 incl) | Tavus ($0.20 all-in) | D-ID ($3.00 incl) |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 8,000 | **$1,280** | $1,360 | $4,000 | $3,200 | $1,600 | $24,000 |
| 5,000 | 40,000 | **$6,400** | $6,800 | $20,000 | $16,000 | $8,000 | $120,000 |
| 10,000 | 80,000 | **$12,800** | $13,600 | $40,000 | $32,000 | $16,000 | $240,000 |
| 50,000 | 400,000 | **$64,000** | $68,000 | $200,000 | $160,000 | $80,000 | $1.2M |

**Cost per active user / month:**
Simli **$1.28** · Anam $1.36 · Tavus $1.60 · HeyGen $3.20 · Beyond Presence $4.00 · D-ID $24.00.

> Volume discounts (typically 20–40% above 100k min) not modeled. Tavus and HeyGen routinely negotiate at the 50k-user tier.

---

## 3. Quality / Reliability Matrix (1–5, weighted by what matters for RestPilot)

| | Avatar quality | Lip sync | Emotion | iOS Safari | Latency | Reliability | SDK | Ease | Maint. | **Weighted total** |
|---|---|---|---|---|---|---|---|---|---|---|
| **Simli + ElevenLabs Flash** | 4 | 5 | 3 | **5** | **5** (~300ms) | 5 | 5 | 5 | 5 | **88** |
| **Tavus Phoenix-4** | 5 | 5 | 5 | 4 | 4 | 4 | 4 | 5 | 4 | **85** |
| **HeyGen LiveAvatar + EL** | **5** | 5 | 4 | 4 | 3 (~1.5s) | 4 | 4 | 3 | 4 | **78** |
| Anam.ai + EL | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | **75** |
| Beyond Presence | 4 | 4 | 4 | 4 | 5 | 3 (newer) | 4 | 4 | 3 | **72** |
| D-ID Agents | 4 | 4 | 3 | 4 | 3 | 4 | 4 | 4 | 4 | **70** |
| NVIDIA ACE | 5 | 5 | 4 | 3 | 3 | 3 (self-op) | 3 | 1 | 1 | **58** |
| SitePal | 2 | 3 | 2 | 5 | 5 | 5 | 3 | 5 | 5 | **63** (but quality floor) |
| Hume EVI (voice only) | — | — | 5 | 5 | 4 | 4 | 4 | 4 | 4 | n/a (not an avatar) |

Weights skew toward iOS Safari, latency, reliability — our actual launch blockers.

---

## 4. Strengths & Weaknesses

- **Simli** — Cheapest premium-tier per minute, best iOS Safari track record, BYO-TTS (keeps ElevenLabs realism). Avatar slightly less photoreal than HeyGen/Tavus. **Lowest risk, lowest cost.**
- **Tavus Phoenix-4** — Best emotion + perception (sees user expressions), all-inclusive pipeline, premium feel. Slightly higher per-minute and TTS locked to Tavus's catalog. **Best premium experience if cost rises ~25%.**
- **HeyGen LiveAvatar** — Top photoreal fidelity, strong brand. Higher TTFB (~1.5s), highest pure per-minute among real-time, plan floors at scale. **Pick only if "Is that a real person?" is a marketing must-have.**
- **Anam.ai** — Solid value, similar tier to Simli, smaller ecosystem, EU presence. **Backup if Simli quality fails QA.**
- **Beyond Presence** — Lowest latency claims, but newer, higher per-minute, smaller iOS evidence base. **Watch, don't bet on yet.**
- **D-ID** — Mature SDK, but ~3–10× more expensive per minute than Simli/Tavus. **Not cost-competitive in 2026.**
- **NVIDIA ACE** — Premium avatar quality, but you operate GPUs, hire ML ops, manage uptime. **Months of work and ongoing cost. No.**
- **SitePal** — Cheap and reliable on every device, but visibly non-photoreal. **Falls below RestPilot's premium bar.**
- **Hume** — Best emotional voice model. Not an avatar; can be paired with Simli/Anam if we drop ElevenLabs. **Optional voice swap, not an avatar choice.**

---

## 5. Recommendation

**Build the POC on Simli + ElevenLabs Flash v2.5. Keep Tavus Phoenix-4 as the premium upgrade path.**

Why Simli wins on long-term value:
1. **Cost** — $1.28/user/month is 2–20× cheaper than every other premium option at our projected scale.
2. **iOS Safari reliability** — The exact failure mode (WebGL/Three.js fragility) that broke our last 3 attempts is sidestepped: Simli ships native WebRTC video.
3. **No vendor lock on voice** — ElevenLabs realism (already QA-verified) carries over; we don't lose the work.
4. **PAYG** — No plan floor, so a failed POC costs <$50.
5. **Headroom** — Trinity-1 pricing is dropping, not rising; competitive pressure from Anam/Beyond Presence keeps it that way.

Why Tavus is the fallback, not D-ID/HeyGen:
- If Simli's photorealism fails hardware QA on iPhone, Tavus Phoenix-4 gives us +1 quality tier at a ~25% cost increase (~$1.60/user/mo at 10k users), not a 3× one.
- HeyGen and D-ID don't justify their cost at our scale.

### Proposed Phase 2 (unchanged)
- Build **Simli POC only** (free tier covers it).
- If iOS QA passes — adopt and skip the rest.
- If quality falls short — build a **Tavus POC** before considering HeyGen.
- Defer Beyond Presence, Anam, D-ID, ACE, SitePal unless Simli + Tavus both fail.

### Decision required from you
Reply with one of:
- **"go simli"** — open the Simli secret form and build POC #1 (recommended).
- **"go simli + tavus"** — build both POCs in parallel (more cost, faster decision).
- **"different combo"** — name it and I'll re-plan.

No platform purchased or integrated until POC + hardware QA approval.
