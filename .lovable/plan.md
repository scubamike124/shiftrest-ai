# Batch D — Final Phase 1 Investigation

Investigation only. No code changes until approval.

## Current Phase 1 Completion: **~96%**

Batches A (auth guards + marketing scrub), B (og:image + coming-soon hide + .env.example), and C (robots/sitemap/error boundaries) are shipped and production-verified on build `b-1782953414953`. Remaining work is small and mostly non-code operator verification.

---

## 1. Critical Launch Blockers (must complete before public launch)

These are **operator/manual verification** items — zero code changes required. Carried over from the Batch C plan, still not executed.

| # | Item | Type | Effort |
|---|---|---|---|
| D1 | **Stripe live-mode end-to-end test** — confirm `STRIPE_SECRET_KEY` in production is `sk_live_*`, webhook endpoint targets `shift-rest-ai.lovable.app`, run one real $0.50 purchase → success → refund. | Operator | ~15 min |
| D2 | **Auth flow smoke on production** — from an incognito device: sign-up → email confirm → sign-in → password reset → sign-out → refresh session persistence. Verifies Batch A auth guards did not regress the happy path. | Operator | ~10 min |

**Note:** No code-level launch blockers remain. Everything below is polish.

---

## 2. High-Priority Launch Tasks (recommended before launch, small code)

| # | Item | Files | Effort |
|---|---|---|---|
| D3 | **True favicon set** — `favicon.ico` (multi-size) + `favicon-32.png` + `favicon-16.png` derived from the aurora brand. Today `__root.tsx` points both `icon` and `apple-touch-icon` at the same `/icon-512.png`, so browser tabs render a scaled 512px PNG. | `public/favicon.ico`, `public/favicon-32.png`, `public/favicon-16.png`, `src/routes/__root.tsx` (3 link tag updates) | ~15 min |
| D4 | **Meta description audit for `/pricing` and `/features`** — both currently ship only the root default description (no route-level `meta`). Add a route-specific `head()` with title + description + og:title + og:description. | `src/routes/pricing.tsx`, `src/routes/features.tsx` | ~10 min |

---

## 3. Minor Polish Items (ship together if D3+D4 approved, otherwise defer)

| # | Item | Files | Effort |
|---|---|---|---|
| D5 | **JSON-LD `Organization` + `WebSite`** on root; `Product` schema on `/pricing`. Zero currently in the app (`rg application/ld+json` = 0 hits). Improves Google rich results. | `src/routes/__root.tsx`, `src/routes/pricing.tsx` | ~10 min |
| D6 | **`/legal/index` polish** — currently a bare link list. One-paragraph intro + grouped sections. | `src/routes/legal.index.tsx` | ~10 min |

---

## 4. Post-Launch Improvements (Phase 2 — do NOT touch now)

- Smart Alarm re-enable + push backstop verification
- Wearable OAuth expansion (Apple Health, Garmin, Whoop)
- Native iOS/Android wrappers
- Partner Mode multi-user invites
- Shift Swap Copilot marketplace
- AI voice cloning per user
- Web Push notifications beyond alarms
- Team/employer admin dashboard
- Empty-state redesigns (`/inbox`, `/decisions`, `/memory`)
- Loading skeletons on `/dashboard` and `/companion`

---

## Grouped Implementation Batches (minimize credits)

**Batch D-1 — Operator only (no code, no publish):** D1 + D2. Run in parallel, ~25 min total. **Recommended: do this first.**

**Batch D-2 — Branding polish (single edit pass + one publish):** D3 + D4. Grouped because both touch head/metadata concerns and can be verified in one production HTML curl. ~25 min edit + one verification. **Recommended second.**

**Batch D-3 — SEO polish (optional, single edit pass + one publish):** D5 + D6. Only ship if you want SEO polish before launch; otherwise defer indefinitely. ~20 min edit + one verification.

---

## Recommended Final Implementation Order

1. **Batch D-1** (D1 Stripe live test + D2 auth smoke) — **you** run these, no Lovable credits spent, unblocks launch.
2. **Batch D-2** (D3 favicons + D4 meta descriptions) — one small code batch, one publish, one verify.
3. **Batch D-3** (D5 JSON-LD + D6 legal index) — optional, ship only if credits allow before launch.
4. **Launch.**
5. Phase 2 planning after live user signal.

---

## Estimated Totals

| Batch | Code effort | Operator effort | Publish cycles |
|---|---|---|---|
| D-1 | 0 | ~25 min | 0 |
| D-2 | ~25 min | ~5 min verify | 1 |
| D-3 (optional) | ~20 min | ~5 min verify | 1 |

Max path to launch: **D-1 + D-2 = ~55 min, one publish.** D-3 is deferrable.

---

## Files Likely to Change (if D-2 + D-3 both approved)

- `src/routes/__root.tsx` (favicon link tags + JSON-LD script)
- `src/routes/pricing.tsx` (meta + Product JSON-LD)
- `src/routes/features.tsx` (meta)
- `src/routes/legal.index.tsx` (copy + layout)
- `public/favicon.ico`, `public/favicon-32.png`, `public/favicon-16.png` (new assets)

No changes to: `src/lib/flags.ts`, Smart Alarm code, Companion, auth middleware, Stripe routes, DB migrations, any Phase 2 feature.

---

Awaiting approval. Recommend approving **D-1 + D-2** minimum; D-3 optional.
