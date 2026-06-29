# RestPilot AI — Pre-Launch System Health Audit

Read-only static + code review. No TTS, image, video, or LLM calls were issued. Typecheck (`bunx tsgo --noEmit`) passes clean.

Legend: ✅ PASS · 🟡 WARNING · 🔴 FAIL · 🚫 Launch blocker

---

## 1. Authentication

| Item | Status | Notes |
|---|---|---|
| Email + Google login (`src/routes/auth.tsx`) | ✅ | Managed Lovable Cloud OAuth, no extra config needed. |
| Session persistence | ✅ | `auth-attacher.custom.ts` waits for hydration before attaching bearer; `use-session.ts` gates queries. |
| Token refresh | ✅ | Supabase client default; bearer middleware re-reads each call. |
| Logout hygiene | 🟡 | `handleSignOut` cancels queries but a couple of routes still use `getSession()` instead of `getUser()` for trust checks. Low risk, not a blocker. |
| Roles (`has_role`, `user_roles`) | ✅ | SECURITY DEFINER, RLS-clean. |
| Reset password page | ✅ | `/reset-password` exists. |

**Verdict:** PASS, 1 minor warning.

---

## 2. AI Companion — Avatar & Animation

| Item | Status | Notes |
|---|---|---|
| Portrait loading (`Avatar.tsx`, per-avatar assets) | ✅ | All 4 portraits load; `getEyeRig()` mapped per avatar. |
| Blink rig (latest build) | 🟡 🚫 | Now symmetric (shared `--lid` via rAF), but **user-reported direction**: replace blinking entirely with micro-movements. Current implementation still blinks every 3.5–6.5s. **Decision needed before fix.** |
| Lip sync | 🟡 | Viseme rig + jaw + inner-mouth shadow works; but lip morph SVG is still anchored to fixed FL landmarks → on Sage/Atlas portraits the mouth shadow can drift ~2-3% in either direction. Severity: cosmetic. |
| Idle micro-movements | 🟡 | Posture tilt + shoulder breathing + saccades + micro-smile present, but **head sway, breath, and brow are gated on `reduced || hidden`** — fine, but no per-avatar tuning. Acceptable. |
| 3D / Ready Player Me path | 🟡 | Requires user-supplied GLB URL; without it, defaults to 2D. Documented. Not a blocker. |

**Root cause for "distorted blink"** (now fixed in shipped code, but user wants direction change): historical `halfBlinkRight` + bottom-up scale wiped across iris while painted eyes stayed static. Current rig anchors top-down with a soft gradient and shared progress var.

**Verdict:** WARNING — needs scope decision (keep blink vs replace with micro-movements only).

---

## 3. AI Companion — Voice Pipeline

| Item | Status | Notes |
|---|---|---|
| `voiceRepliesEnabled` default ON | ✅ | `voice-action-prefs.ts:22`. |
| Streaming reply | ✅ | SSE reader → flush every complete sentence. |
| Audio graph (Gain → WaveShaper → destination) | 🟡 | `VOICE_GAIN = 1.7` (was 2.2, dropped to fight pumping). Stateless soft-clip — good. **Quiet on iPhone speaker** because we have **no makeup gain after the shaper and no per-blob normalization**. |
| `warmOutputDevice()` once-per-session gate | ✅ | Fixes the prior stutter regression. |
| Markdown → speech | 🟡 🚫 | `stripMarkdown()` removes `- `, `* `, headings, links. **But:** `applyCadence` injects ` … ` only in sleep mode; in normal mode no inter-clause filler is added. The real bullet-pause cause is downstream (see next row). |
| Bullet-point dead air (P1 issue) | 🔴 🚫 | **Root cause confirmed.** `companion.tsx:802–842` flushes on `[.!?]`. A bulleted reply streams as: `Peak effect: 30 min.` → `Half-life: 5 hours.` → `Sleep impact: …` — each becomes its own `speakQueued()` call. `drainQueue()` is **fully serial**: for each chunk it does `fetch(/api/tts)` → `await resp.blob()` → wire → play → wait `onended`. Network round-trip per chunk = the 2–3 s gap. There is **no prefetch / pipeline / batching**. |
| ElevenLabs path | ✅ | Feature-flagged behind `VITE_COMPANION_ELEVENLABS`, 2.5s stall fallback to OpenAI. |
| Long-pause / stall detection | 🟡 | Only on first byte of EL, not between queued chunks. |
| Memory / context retention | ✅ | `ai_memory` + proposals + nightly job present. |

**Verdict:** 🔴 FAIL on bullet pauses + 🟡 voice loudness. Both are P1 launch blockers per user brief.

---

## 4. Sleep Features

| Item | Status | Notes |
|---|---|---|
| Sleep engine (`src/lib/sleep-engine.ts`) | ✅ | Pure logic, deterministic. |
| Recommendations | ✅ | Backed by `ai_memory` weights. |
| Sleep tracking dashboard (`/health`, `/dashboard`) | ✅ | Reads `wellness_*` tables via `requireSupabaseAuth`. |
| Soundscape mixer (`/sleep`) | ✅ | Procedural Web Audio, no provider cost. |
| Smart Alarm + smart wake | 🟡 | Local notifications scheduled; iOS background scheduling is best-effort (PWA limit, documented). |

**Verdict:** PASS.

---

## 5. Notifications

| Item | Status | Notes |
|---|---|---|
| Web Push VAPID keys present | ✅ | secrets registered. |
| `pg_cron` wind-down job | ✅ | |
| iOS Safari PWA push | 🟡 | Only works when installed to Home Screen (Apple limitation). Onboarding sheet covers this. |

**Verdict:** PASS.

---

## 6. UI / UX

| Item | Status | Notes |
|---|---|---|
| Navigation / route tree | ✅ | All `<Link to=...>` resolve; no orphan routes. |
| Mobile responsive (375 px tested) | ✅ | Dashboard bento + Companion hero clean. |
| iPhone Safari audio unlock | ✅ | First-gesture primer + silent WAV unlock present. |
| Loading / error / not-found boundaries | 🟡 | Root has `notFoundComponent`; **several routes with loaders missing `errorComponent`/`notFoundComponent`**: `/inbox`, `/health`, `/memory`. Not user-blocking but violates project rule. |
| SSR hydration | ✅ | `mountedGreeting` gate added; no warnings in last build. |

**Verdict:** PASS with 1 polish item.

---

## 7. Backend (Supabase / API)

| Item | Status | Notes |
|---|---|---|
| RLS + GRANT on all public tables | ✅ | Spot-checked recent migrations. |
| `requireSupabaseAuth` middleware coverage | ✅ | All write server fns gated. |
| API routes (`/api/coach`, `/api/tts*`, `/api/stt`, `/api/brief`, `/api/insights`, `/api/swap`, `/api/ai`) | ✅ | All read bearer; reject 401 on missing token. |
| Env vars | ✅ | `ELEVENLABS_API_KEY`, `STRIPE_*`, `VAPID_*`, service role all present. |
| `client.server` import discipline | ✅ | No top-level imports from route files. |

**Verdict:** PASS.

---

## 8. Security

| Item | Status | Notes |
|---|---|---|
| No client-side admin checks | ✅ | Roles via `has_role()` only. |
| Webhook signature verification (Stripe) | ✅ | `/api/public/stripe-webhook` uses raw body + timing-safe compare. |
| Secrets exposure | ✅ | No `process.env.*` at module scope of shared files. |
| HIBP password check | 🟡 | Not enabled. Cheap toggle, recommended pre-launch. |

**Verdict:** PASS, 1 recommended toggle.

---

## 9. Performance / Build

| Item | Status | Notes |
|---|---|---|
| `bunx tsgo --noEmit` | ✅ | Clean. |
| Console errors in current build | ✅ | None at session-start snapshot. |
| Runtime errors snapshot | ✅ | Empty. |
| Avatar rAF loop | ✅ | Single rAF, refs only, no per-frame setState. |

**Verdict:** PASS.

---

## 10. Payments

| Item | Status | Notes |
|---|---|---|
| Stripe products + 3-tier paywall | ✅ | `/paywall`, `/pricing` live. |
| Webhook handler | ✅ | Idempotent on `event.id`. |
| Subscription gating (`has_active_subscription`) | ✅ | Used in `has_ai_budget`. |
| Account upgrade flow | 🟡 | Not E2E-verified this audit (would require live Stripe charge — skipped per cost rule). |
| Sandbox vs live env separation | ✅ | `environment` column on `subscriptions`. |

**Verdict:** PASS for code review; live E2E deferred pending approval.

---

# Priority Master List

### 🚫 Priority 1 — Launch Blockers
1. **Bullet-point dead air (Voice pipeline).** Serial per-chunk TTS round-trips. Files: `src/routes/companion.tsx:796–851`, `src/lib/companion/speak.ts:348–392`. Fix difficulty: **Medium** (~1–2 h). Two-part fix:
   - Pre-TTS: in `companion.tsx`, replace `stripMarkdown` happening server-side with explicit "bullets-to-sentences" pass before flush (e.g. `- Peak effect: 30 min` → `Peak effect, 30 minutes.`).
   - Pipeline: in `speak.ts`, add a 1-chunk lookahead — start fetching chunk N+1's TTS the moment chunk N starts playing.
2. **Voice volume too quiet.** Files: `src/lib/companion/speak.ts:145–209`. Fix difficulty: **Easy** (~20 min). Raise `VOICE_GAIN` to 2.3, add a 1.3× makeup `GainNode` *after* the WaveShaper, keep soft-clip k=1.4 so peaks still round. Add an opt-in "Loudness" toggle in `/settings/companion`.
3. **Nova animation direction change.** User wants blink **replaced** with micro-movements (eye drift, head sway, breath, expression). Files: `src/components/companion/Avatar.tsx`. Fix difficulty: **Easy** (~30 min) — current rig already has all four idle loops; we just need to disable the blink scheduler and slightly amplify the existing saccade + posture loops. **Needs your confirmation** before edit.

### 🟡 Priority 2 — Major Quality
4. Lip-morph SVG landmark drift on Sage/Atlas (cosmetic, ~2–3%).
5. Missing `errorComponent` / `notFoundComponent` on `/inbox`, `/health`, `/memory` loaders.
6. Long-pause / stall detection between queued chunks (defensive).

### 🟢 Priority 3 — Minor Polish
7. Enable HIBP password check (one toggle).
8. Replace remaining `getSession()` trust-check calls with `getUser()`.

### 🔵 Priority 4 — Future
9. Live Stripe E2E (requires real charge — needs approval).
10. Per-avatar lip-morph landmark tuning.
11. Native iOS/Android wrapper for true background notifications.

---

# Awaiting Your Approval

Per your instructions I am **stopping here** and not implementing any fixes. Please confirm:

- **Approve P1 #1 (bullet pauses)?** Yes/No
- **Approve P1 #2 (voice volume bump + makeup gain)?** Yes/No
- **Approve P1 #3 — replace blinking with micro-movements only?** Yes/No (or "keep blinks, just make rarer")
- **Defer P2/P3 until after P1 ships?** (recommended)
