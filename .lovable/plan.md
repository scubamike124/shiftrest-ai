# Phase 1 Bundle — Coach History + Account Basics

Three independent web-launch basics, each safe on its own. No payments, RevenueCat, iOS, OAuth, redesign, or new AI features touched.

---

## 1. What you'll see in the app

- **Coach screen**: when signed in, your past conversation reloads automatically and every new message is saved. Sign out and chat works as a throwaway guest session (nothing saved).
- **Auth screen**: new "Forgot password?" link under the sign-in form. Tapping it asks for your email and sends a reset link.
- **New `/reset-password` page**: where the email link lands; lets you pick a new password and bounces you back to the app.
- **Profile → Delete account**: the existing button now actually deletes the server data, signs you out, clears the device, and sends you to the sign-in page.

---

## 2. Database schema

One new table. No changes to `shifts`, `user_prefs`, or `profiles` — their existing `ON DELETE CASCADE` on `auth.users(id)` already cleans them up when an account is removed.

```text
coach_messages
  id            uuid pk
  user_id       uuid  → auth.users(id) ON DELETE CASCADE
  role          text  ('user' | 'assistant')
  content       text
  created_at    timestamptz default now()

  index (user_id, created_at)
```

RLS: users can SELECT / INSERT / DELETE only their own rows. No UPDATE policy (messages are immutable).

### Migration SQL

```sql
CREATE TABLE public.coach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX coach_messages_user_created_idx
  ON public.coach_messages (user_id, created_at);

GRANT SELECT, INSERT, DELETE ON public.coach_messages TO authenticated;
GRANT ALL ON public.coach_messages TO service_role;

ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own coach messages"
  ON public.coach_messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own coach messages"
  ON public.coach_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own coach messages"
  ON public.coach_messages FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
```

---

## 3. Files to change / add

**New**
- `src/lib/coach-history.ts` — `fetchHistory()`, `saveMessage(role, content)`, `clearHistory()`.
- `src/lib/account.ts` — `deleteAccount()` server function (privileged Auth Admin call) + client wrapper that signs out and clears local data.
- `src/lib/account.functions.ts` — `createServerFn` wrapping `requireSupabaseAuth`, then dynamic-imports `supabaseAdmin` to call `auth.admin.deleteUser(userId)`. Cascades cleanup of `shifts`, `user_prefs`, `profiles`, `coach_messages` automatically via FK.
- `src/routes/reset-password.tsx` — public route, reads `type=recovery` from URL hash, prompts for new password, calls `supabase.auth.updateUser({ password })`, redirects to `/`.

**Edit**
- `src/routes/coach.tsx` — on mount, if session → `useQuery(['coach-history'], fetchHistory)` and hydrate `messages` (prepend SEED only when empty). After each successful exchange, call `saveMessage('user', …)` and `saveMessage('assistant', finalText)`. Guests keep current local-only behavior.
- `src/routes/auth.tsx` — add "Forgot password?" link → `supabase.auth.resetPasswordForEmail(email, { redirectTo: ${origin}/reset-password })`. Small inline form or a tiny modal; no new route needed for the request side.
- `src/routes/profile.tsx` — replace the local-only delete button with `await deleteAccount()`; on success: `queryClient.clear()`, `localStorage.clear()`, `clearPrefsMigrationFlag()`, `supabase.auth.signOut()`, `navigate('/auth', { replace: true })`.
- `src/routes/__root.tsx` — on `SIGNED_OUT`, also invalidate `['coach-history']` (already invalidates shifts/prefs). On `SIGNED_IN`, no extra work — TanStack Query refetches.

**Untouched**
- `src/routes/api/coach.ts` — streaming endpoint stays as-is. History is persisted client-side after stream completes, not inside the route, so timing/back-pressure don't change.
- `src/lib/shifts.ts`, `src/lib/prefs.ts` — no changes.

---

## 4. Implementation plan (order)

1. Run migration → `coach_messages` table + RLS + grants.
2. Add `src/lib/coach-history.ts` (3 small functions over `supabase` browser client; RLS handles scoping).
3. Wire coach screen: hydrate via TanStack Query, persist after streaming completes, no-op for guests.
4. Add `src/routes/reset-password.tsx`. Add "Forgot password?" affordance on `auth.tsx`.
5. Add `account.functions.ts` server fn + `account.ts` client wrapper. Replace the profile delete handler.
6. Update root listener to invalidate coach history on sign-out.
7. Verify no TypeScript errors; smoke-test each flow.

---

## 5. Technical details

- **Server fn auth**: `deleteAccount` uses `.middleware([requireSupabaseAuth])` to get `userId`, then `await import("@/integrations/supabase/client.server")` to call `supabaseAdmin.auth.admin.deleteUser(userId)`. Per project rules, the dynamic import keeps the service-role module out of the client bundle.
- **Cascade**: `shifts.user_id`, `user_prefs.user_id`, `profiles.id`, `coach_messages.user_id` all `ON DELETE CASCADE` against `auth.users(id)`, so deleting the auth user wipes every owned row in one shot. Coach messages migration adds the same.
- **SEED message**: not written to DB. Rendered only when history is empty so existing/restored conversations don't get a phantom "Hi — I'm your Sleep Coach" inserted mid-thread.
- **History window**: load most recent 100 messages (`order created_at desc limit 100`, then reverse). Coach API request already truncates to last 20 for the model.
- **Reset link**: `redirectTo: ${window.location.origin}/reset-password`. Route is public (not under `_authenticated/`) so the recovery session lands cleanly. After `updateUser` succeeds, route navigates to `/` and the existing root auth listener handles the rest.
- **Sign-out hygiene on delete**: `queryClient.cancelQueries()` → `queryClient.clear()` → `supabase.auth.signOut()` → `localStorage.clear()` → `navigate('/auth', { replace: true })`, matching the project's documented order.

---

## 6. Risks

- **Service-role key on Lovable Cloud**: `supabaseAdmin.auth.admin.deleteUser` requires the service-role key. It's present in this project's secrets, so the server fn works; if a future environment lacks it, deletion silently 500s. Mitigation: surface the error toast and don't clear local data until the server call succeeds.
- **Coach race condition**: if the user navigates away mid-stream, the assistant `saveMessage` won't fire and that turn is lost. Acceptable for v1; fix later by saving from the API route.
- **Recovery link reuse**: Supabase recovery tokens are single-use and short-lived; users who click an old link will see an error on `/reset-password`. We'll show a clear "Link expired — request a new one" message.
- **localStorage clear scope**: blowing away all of localStorage also drops the migration guard flags. That's intentional on delete (no account left to migrate to) but worth noting.
- **No undo**: account deletion is immediate at the auth level. The existing UI copy mentions "within 30 days" — we'll update it to reflect immediate deletion to match reality and avoid App Store rejection over misleading copy.

---

## 7. Test checklist

Coach history
- [ ] Signed out → send 2 messages → refresh → conversation is gone (guest mode preserved).
- [ ] Sign in → send 2 messages → refresh → both reload in order with SEED hidden.
- [ ] Sign in browser A, chat; open browser B → same history appears.
- [ ] Mid-stream error → user message stays, no half-written assistant row saved.
- [ ] 100+ message thread loads quickly; only last 100 shown.

Password reset
- [ ] "Forgot password?" with unknown email → no leak, generic success toast (Supabase default).
- [ ] Real email → reset email arrives → link opens `/reset-password` → set new password → redirected and signed in.
- [ ] Expired/used link → friendly "expired" message, link back to auth.
- [ ] Direct visit to `/reset-password` with no recovery token → friendly message + back to auth.

Account deletion
- [ ] Confirm dialog cancellation at any of the 3 steps leaves account intact.
- [ ] Type "DELETE" → spinner → server fn succeeds → toast, localStorage cleared, redirected to `/auth`.
- [ ] Attempt to sign back in with same email/password → fails ("invalid credentials").
- [ ] After deletion, sign up with the same email again → fresh account, no leftover shifts/prefs/coach history.
- [ ] Server fn failure path → toast shows the error, user stays signed in, no local data wiped.

Regression
- [ ] Shifts CRUD still works for a signed-in user (no schema collision).
- [ ] Preferences read/write still works.
- [ ] Onboarding modal still gates only first-time users.
- [ ] No new TypeScript errors; build passes.
