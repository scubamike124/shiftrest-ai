# RestPilot — Phase 1 Launch Readiness (Investigation Only)

Smart Alarm and all Phase 2 items are excluded per scope.

## 1. Current Phase 1 completion

**~92% complete.** All Phase 1 features are built, wired to backend, and rendering real content. Remaining work is polish, hardening, and one marketing‑copy leak — no missing feature work.

## 2. Remaining Phase 1 tasks (grouped by priority)

### Critical — launch blockers

**C1. Remove Smart Alarm from live marketing copy** (users will expect a Phase 2 feature)
- `src/routes/index.tsx:38` — meta description
- `src/routes/index.tsx:123` — hero body (mobile)
- `src/routes/index.tsx:240` — HeroStack "Smart alarm" chip
- `src/routes/index.tsx:406` — CompanionShowcase "Set smart alarm" chip button
- `src/routes/index.tsx:1026` — testimonial line
- Effort: **~15 min**, string edits only.

**C2. Reject unauthenticated calls to paid AI endpoints**
Today `userId=null` skips the budget check and still returns AI output on some intents. Add a 401 when no valid `Authorization` header is present (or when auth resolution fails) before calling the model.
- `src/routes/api/ai.ts` (~line 265–275)
- `src/routes/api/tts.ts` (~line 39)
- `src/routes/api/brief.ts`
- `src/routes/api/tts-elevenlabs.ts`
- Effort: **~30 min**, small guard block per handler.

**C3. Remove the "Open Simli Test" lab link from the production homepage**
Hardcoded absolute URL to `/lab/avatar-poc/simli` visible on hero.
- `src/routes/index.tsx` (HeroStack CTA)
- Effort: **~5 min**.

### High — should ship at launch

**H1. Social share images (og:image) for public routes**
Root fallback is a Lovable CDN screenshot. Generate one branded 1200×630 social card and wire it on the leaf routes that get shared: `index.tsx`, `features.tsx`, `pricing.tsx`, `paywall.tsx`, `safety.tsx`. Legal pages can stay on the root fallback.
- Files: the 5 route `head()` blocks above; asset in `src/assets/og-*.jpg`.
- Effort: **~30 min** (one image gen + 5 head edits).

**H2. `.env.example` for the 16 required secrets**
Deployment/handoff friction. List every `process.env.*` read by server code (see appendix) with a short comment. Do not include real values.
- New file: `.env.example`
- Effort: **~15 min**.

**H3. Hide or defer "Coming soon" skill tiles**
`/settings/skills` currently ships badges advertising unavailable connections.
- `src/routes/settings.skills.tsx` (~line 10, 316)
- Options: filter the tiles out for launch, or add a "Phase 2" section header so the badge is contextual. Recommend filter‑out.
- Effort: **~15 min**.

### Medium — polish, ship if time permits

**M1. `og:url` canonical on public routes** (currently only on `/`). Add to `features`, `pricing`, `paywall`, `safety`, `sleep`, `coach`, `health`. Effort: **~15 min**.

**M2. Router `defaultPendingComponent`** so slow route transitions don't show a blank screen. `src/router.tsx`. Effort: **~10 min**.

**M3. Remove production `console.log` in server paths**
- `src/routes/api/tts-elevenlabs.ts:111`
- `src/routes/api/public/payments/webhook.ts:113,116` (or gate behind `NODE_ENV !== 'production'`)
- Effort: **~5 min**.

**M4. Dead‑code cleanup** `if (status === 500 && false)` in `src/routes/api/brief.ts:124`. Effort: **~2 min**.

### Low — post‑launch acceptable

**L1. Wearable cron N+1** — `src/routes/api/public/wearables/cron.ts:23` fans out sequentially with no LIMIT. Fine at current scale; revisit at ~500 connected users. Effort: ~1 hr when needed.

**L2. Apple OAuth** hidden at `src/routes/auth.tsx:161`. Google is live. Ship without Apple; add later.

**L3. Router‑level `defaultErrorComponent`/`defaultNotFoundComponent`.** Root route already handles both — redundant with the root, cosmetic best‑practice only.

## 3. Recommended implementation order (credit‑optimal)

Batched so each publish/verify cycle covers multiple items:

```text
Batch A (single edit pass, one publish)  ← Critical
  1. C1  Marketing copy scrub (index.tsx, 5 strings)
  2. C3  Remove Simli lab link from hero
  3. C2  Add auth guard to /api/ai, /api/tts, /api/brief, /api/tts-elevenlabs

Batch B (single edit pass, one publish)  ← High
  4. H1  Generate one og:image, wire into 5 route heads
  5. H2  Write .env.example
  6. H3  Hide "coming soon" skill tiles

Batch C (optional polish, single publish)  ← Medium
  7. M1  og:url on public routes
  8. M2  defaultPendingComponent
  9. M3  Strip console.log lines
 10. M4  Delete && false dead branch
```

Rationale: three publish cycles instead of ten. Batches A and B are the launch gate; Batch C is nice‑to‑have.

## 4. Files likely to change (summary)

- `src/routes/index.tsx` (C1, C3, H1, M1)
- `src/routes/api/ai.ts`, `api/tts.ts`, `api/brief.ts`, `api/tts-elevenlabs.ts` (C2, M3)
- `src/routes/api/public/payments/webhook.ts` (M3)
- `src/routes/features.tsx`, `pricing.tsx`, `paywall.tsx`, `safety.tsx` (H1, M1)
- `src/routes/settings.skills.tsx` (H3)
- `src/router.tsx` (M2)
- `src/routes/api/brief.ts` (M4)
- New: `.env.example`, `src/assets/og-*.jpg`

## 5. Effort estimate

- Batch A: **~50 min**
- Batch B: **~60 min**
- Batch C: **~30 min**
- **Total to launch: ~2 hours implementation + verify**

## 6. Verification per batch (lowest‑cost path)

- Batch A: `rg -i "smart alarm|simli"` on `src/routes/index.tsx`; `curl` each AI endpoint without an `Authorization` header expecting 401.
- Batch B: view rendered `<head>` on `/`, `/features`, `/pricing`; `cat .env.example`; visit `/settings/skills`.
- Batch C: navigate one slow route to see pending UI; `rg "console\.log" src/routes/api`.

No paid E2E test runs required.

## Explicitly out of scope (Phase 2 / deferred)

Smart Alarm, wake automation, Apple OAuth, wearable cron scaling refactor, router‑level default boundaries.

---

Awaiting approval before implementation. On approval, recommended default is Batch A first, verify, then Batch B.
