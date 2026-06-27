# RestPilot — Before Launch Master Checklist

> **Development standard:** RestPilot is an AI that actively makes intelligent decisions for shift workers throughout the day — not just another sleep tracker or alarm clock. Before shipping any feature, ask:
> 1. Does this make the AI feel smarter?
> 2. Does it increase user trust?
> 3. Does it clearly demonstrate why RestPilot is different from every other sleep app?
>
> If the answer is no, improve it before shipping.

---

## 1. AI Intelligence (Trust Layer)
- [ ] Every AI recommendation is tappable (opens a detail sheet, not just text).
- [ ] "Why did I recommend this?" explanation attached to every AI decision.
- [ ] AI confidence score shown on every recommendation (High / Medium / Low + %).
- [ ] "What changed" diff when a recommendation updates (sleep, HRV, traffic, calendar, weather, etc.).
- [ ] Live AI activity feed showing decisions made throughout the day.

## 2. Dashboard
- [ ] Personalized greeting tied to schedule.
  - e.g. "Good evening, Michael." / "You're beginning Night Shift #3 tomorrow."
- [ ] Daily AI Readiness / Optimization Score (0–100).
- [ ] Projected recovery if today's recommendations are followed.
- [ ] Every dashboard card is interactive (tap → drill-in), no static tiles.

## 3. AI Coach
- [ ] "Why?" button on every recommendation.
- [ ] Follow-up questions supported by voice **and** text.
- [ ] Coach explains its reasoning in natural language (not bullet jargon).

## 4. Smart Alarm
- [ ] Animated sleep-cycle graph.
- [ ] Live countdown until the alarm fires.
- [ ] Inline explanation of why the selected wake point is optimal.
- [ ] Preview of what the AI plans immediately after wake-up (light, caffeine, hydration, briefing).

## 5. Long Clock
- [ ] Weekly forecast is interactive.
- [ ] Tap any day to see how today's decisions affect future recovery.

## 6. AI Decision Center (new surface)
- [ ] Dashboard card: "Decisions Automated Today" (clickable).
- [ ] Full log of every decision the AI made today with timestamps.
- [ ] Users can review accepted / changed / ignored recommendations.

## 7. Homepage (Marketing)
- [ ] Add a short "A Day With RestPilot" animated walkthrough.
- [ ] Show the AI making real-time decisions before the sign-up CTA.

---

## Implementation order (recommended)

1. **Trust Layer foundation** — shared `<WhyButton />`, `<ConfidenceBadge />`, `<WhatChanged />`, `<RecommendationDetailSheet />` components. Wired through `ai_recommendations` evidence_json (already persisted).
2. **AI Decision Center** route + dashboard card — reads from `ai_recommendations` + `ai_log`.
3. **Dashboard upgrades** — greeting, Readiness Score, projected recovery, interactive cards.
4. **Smart Alarm polish** — animation, countdown, post-wake plan preview.
5. **Long Clock interactivity** — day-tap drill-in.
6. **AI Coach** — Why buttons, voice follow-ups (reuse `/api/tts` + existing STT path).
7. **Live activity feed** — surfaces `ai_log` writes in real time.
8. **Homepage walkthrough** — last, after the product itself proves the promise.

Each item ships behind the three-question gate above.

---

*Previous PWA app-shell rollout: complete and in QA — see git history.*
