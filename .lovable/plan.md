# Batch B — Launch Polish (Isolated)

Scope is limited to the three approved items. No unrelated edits, no refactors, no logic changes to working features.

---

## 1. og:image metadata

**Problem:** `src/routes/__root.tsx` (line 116) currently sets `og:image` to a Lovable preview screenshot URL. Because the root's `head()` concatenates into every route, that stale screenshot overrides every leaf's share preview.

**Change:**
- Generate one branded 1200×630 social card via `imagegen` (RestPilot AI wordmark + tagline over the existing Aurora palette). Save to `src/assets/og-cover.jpg`, upload via `lovable-assets`, commit the `.asset.json` pointer.
- Remove `og:image` and `twitter:image` from `src/routes/__root.tsx` (leaf-only rule).
- Add `og:image` + `twitter:image` (absolute CDN URL) to `src/routes/index.tsx`'s existing `head()` only. Other leaf routes stay unchanged; hosting will inject the project's og:image at serve time.

No other files touched.

---

## 2. `.env.example`

**Problem:** No file documents the required env vars, so self-hosters and reviewers have no reference.

**Change:** Create `.env.example` at project root listing only the names (no values) of secrets already referenced by the codebase, grouped by purpose (Supabase, Lovable AI, ElevenLabs TTS, Simli avatar, VAPID push, Fitbit, Oura, Stripe). Include a top comment stating the file is documentation-only — real values are managed via Lovable Cloud secrets.

No code imports change.

---

## 3. Hide "Coming Soon" skill tiles (Phase 1)

**Problem:** `src/routes/settings.skills.tsx` renders every skill in `SKILL_CATALOG`, including those with `status === "coming_soon"`. These tiles preview Phase 2 features and clutter the Phase 1 experience.

**Change (single-flag, fully reversible):**
- Add `HIDE_COMING_SOON_SKILLS = true` to `src/lib/flags.ts` (alongside existing `SMART_ALARM_ENABLED`).
- In `src/routes/settings.skills.tsx`, filter the grouped skills list: when the flag is on, drop skills where `status === "coming_soon"` before render. All existing conditional-render code (`skill.status !== "coming_soon"` guards, `SkillRow` internals, coming-soon `Badge`) is preserved untouched — flipping the flag to `false` restores Phase 2 behavior with zero code changes.

No changes to `SKILL_CATALOG`, `registry.ts`, `connections.ts`, or any skill runtime. If every skill in a group is coming-soon, the group heading is skipped by the existing `skills.length === 0` guard.

---

## Verification

1. `bunx tsgo --noEmit` — must be clean.
2. `curl -s https://shift-rest-ai.lovable.app/api/public/version` — confirm Build ID rotated.
3. `curl -s https://shift-rest-ai.lovable.app/ | grep -o 'og:image[^>]*' | head -3` — confirm new absolute CDN URL, no stale preview screenshot.
4. Manually confirm `/settings/skills` shows no "Coming soon" badges on production.
5. Auth Companion smoke — unchanged code path, no expected regression.

Report new Build ID. Stop. Wait for Batch C approval.

---

## Non-goals (explicitly excluded)

- No `.env.example` values, only names.
- No og:image on leaf routes other than `/` (hosting fallback covers the rest).
- No edits to skill definitions, runtime, connection flow, or Phase 2 code.
- No unrelated meta/SEO polish, no router `defaultPendingComponent`.
