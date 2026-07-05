# RestPilot Pre-Launch QA Plan

One-pass end-to-end test. For every item: **Test → Expected → Bug if → Priority** (Blocker / Major / Minor).

Priorities:
- **Blocker** — cannot launch (auth broken, payments broken, data loss, crashes, security hole).
- **Major** — core feature degraded but launchable with a workaround.
- **Minor** — polish, copy, layout, non-critical UX.

Test on: latest Chrome desktop, latest Safari iOS, latest Chrome Android. Use one fresh test account per flow.

---

## 1. Homepage
1. Load `/` on desktop and mobile; check hero, nav, CTAs, footer, images, fonts, no console errors.
2. **Expected:** Renders under 2s, all links resolve, no layout shift, correct title/meta, favicon present.
3. **Bug if:** Broken image, dead link, wrong brand copy, CLS jump, missing meta/OG tags, hydration warning in console.
4. **Priority:** Blocker (crash / white screen), Major (dead primary CTA), Minor (spacing, copy).

## 2. Signup
1. Email+password signup, Google signup, weak-password rejection, duplicate-email rejection, verification email delivery, redirect after signup.
2. **Expected:** Account created, verification email arrives < 60s, user lands on dashboard or "check email" screen, profile row exists.
3. **Bug if:** No email, silent failure, account created without profile, error text is a raw stack, verification link 404s, user session not established.
4. **Priority:** Blocker (any signup path fails or no email), Major (Google works but email doesn't or vice versa), Minor (copy/validation message).

## 3. Login
1. Correct creds, wrong password, unknown email, Google login, "remember me" across reload, logout, session persistence after browser restart.
2. **Expected:** Correct creds land on dashboard; wrong creds show clear error; logout clears session and redirects to `/`.
3. **Bug if:** Infinite spinner, token not cleared on logout, protected route accessible after logout, session lost on reload.
4. **Priority:** Blocker (login broken or session leaks after logout), Major (Google broken), Minor (error wording).

## 4. Password Reset
1. Request reset from forgot-password page, receive email, follow link, land on `/reset-password`, set new password, log in with new password, confirm old password no longer works.
2. **Expected:** Email arrives, `/reset-password` shows form (not auto-login), new password works, old fails.
3. **Bug if:** User auto-logged in without entering a new password, link 404s, new password not saved, no email.
4. **Priority:** Blocker (auto-login without reset — security), Major (no email), Minor (copy).

## 5. Dashboard
1. First-load state for new user, populated state for returning user, all widgets/cards render, navigation between sections, refresh preserves state, unauthenticated user redirected to login.
2. **Expected:** Data loads with skeleton, no flicker, all links work, empty states are friendly.
3. **Bug if:** Unauth user sees data, RLS error surfaced to UI, widget stuck loading, wrong user's data visible.
4. **Priority:** Blocker (cross-user data leak), Major (widget broken), Minor (empty-state copy).

## 6. AI Companion
1. Send a message, receive streamed reply, long conversation (>10 turns), error handling on empty input, rate-limit behavior, message history persists across reload.
2. **Expected:** Reply streams within 2s, history saved to user's account only, errors surfaced clearly.
3. **Bug if:** No reply, reply from another user's context, streaming hangs, history lost, key exposed in network tab.
4. **Priority:** Blocker (key exposed or cross-user leak), Major (no reply / hangs), Minor (typing indicator polish).

## 7. Voice / LiveKit
1. Grant mic permission, start voice session, agent greets, two-way conversation, turn-taking, barge-in (interrupt agent), end session, mic released, reconnect after network blip, mobile Safari + Android Chrome.
2. **Expected:** Agent connects < 5s, greeting plays, latency feels natural (< ~1s), interruption stops agent audio, session ends cleanly, mic indicator turns off.
3. **Bug if:** No audio, one-way audio, agent talks over user without stopping, echo, mic stays hot after end, session won't reconnect, LiveKit token errors in console.
4. **Priority:** Blocker (no audio either direction, mic not released, token failure), Major (bad latency, no barge-in), Minor (greeting wording).

## 8. Smart Alarm
1. Create alarm, edit, delete, alarm triggers at correct time (foreground and background), snooze, notification permission flow, alarm survives reload, timezone correctness.
2. **Expected:** Fires at exact local time, notification shown, snooze reschedules, deleted alarms don't fire.
3. **Bug if:** Fires late/early/never, fires in wrong timezone, deleted alarm still rings, no permission prompt.
4. **Priority:** Blocker (alarm never fires or wrong time), Major (snooze broken), Minor (icon/label).

## 9. Payments
1. Open checkout on test card, complete successful payment, decline card, cancel mid-checkout, verify entitlement unlocks in-app immediately, verify webhook updates DB, verify receipt email, try duplicate payment, verify subscription renewal state (if applicable), refund/cancellation flow.
2. **Expected:** Success unlocks feature within seconds, DB reflects state, receipt email arrives, decline shows clear message, cancel returns user to prior state with no charge.
3. **Bug if:** Charge succeeds but entitlement not granted, feature unlocked without payment, double-charge, webhook silently failing, price mismatch vs displayed price.
4. **Priority:** Blocker (any money/entitlement mismatch), Major (receipt missing, slow unlock > 30s), Minor (copy).

## 10. Emails / Notifications
1. Signup confirmation, password reset, transactional (payment receipt, alarm summary, etc.), unsubscribe link works, from-address is branded domain, not in spam (Gmail + Outlook).
2. **Expected:** All emails arrive < 60s from correct sender, render on mobile and desktop clients, links resolve, unsubscribe honored.
3. **Bug if:** Landed in spam, wrong sender, broken template, unsubscribe doesn't stop mail, dead link.
4. **Priority:** Blocker (auth emails missing), Major (spam folder, payment receipt missing), Minor (template polish).

## 11. Legal Pages
1. Terms, Privacy, Cookie/consent (if EU), refund policy, contact — reachable from footer, up-to-date date, correct company name, no lorem ipsum.
2. **Expected:** All present, indexed, readable on mobile, linked from signup and footer.
3. **Bug if:** 404, placeholder text, missing from signup flow, outdated date.
4. **Priority:** Blocker (missing Terms/Privacy at signup — legal), Major (placeholder text), Minor (typo).

## 12. Mobile Home Screen App Behavior
1. iOS Safari "Add to Home Screen": correct name, icon, splash color, standalone display, status-bar style, no browser chrome. Same on Android Chrome install.
2. **Expected:** Installs with correct branding, opens standalone, safe-area respected (notch/home indicator), no white flash.
3. **Bug if:** Generic icon, wrong name, opens in browser tab, content hidden behind notch, no manifest.
4. **Priority:** Major (broken install), Minor (icon polish, splash color).

## 13. Error Handling
1. Kill network mid-request, submit invalid forms, hit unknown route, force a server 500, expired session while using app, offline reload.
2. **Expected:** Friendly error UI, retry option where applicable, 404 page for unknown routes, expired session redirects to login without data loss where possible.
3. **Bug if:** White screen, raw stack trace shown, unhandled promise rejection in console, silent data loss on submit.
4. **Priority:** Blocker (white screen on common error), Major (stack traces visible), Minor (wording).

## 14. Performance
1. Lighthouse mobile run on homepage + dashboard, LCP, CLS, TBT, bundle size, image formats, cached reload, cold reload on 4G throttling.
2. **Expected:** LCP < 2.5s, CLS < 0.1, TBT < 300ms, images lazy/optimized, no > 500KB single JS chunk.
3. **Bug if:** LCP > 4s, CLS > 0.25, unoptimized images, blocking third-party scripts.
4. **Priority:** Major (LCP > 4s on mobile), Minor (image format, small CLS).

## 15. Security Sanity Checks
1. Try to read another user's data via direct API call, check RLS on every user-scoped table, inspect network for exposed service-role/admin keys, check auth email link expiry, verify HTTPS everywhere, verify logout invalidates token server-side, look for secrets in client bundle, run built-in security scan.
2. **Expected:** All cross-user reads denied, only publishable/anon key in client, no secrets in bundle, scan clean.
3. **Bug if:** Any cross-user read succeeds, service-role key in client, admin routes reachable without auth, mixed content.
4. **Priority:** Blocker (any of the above), Major (scan warnings), Minor (best-practice hardening).

---

## Exit Criteria
- Zero Blockers open.
- Majors triaged with owner + fix-or-defer decision.
- Minors listed in a post-launch polish backlog.

## Suggested Order
Homepage → Signup → Login → Password reset → Dashboard → Payments → Emails → AI Companion → Voice → Smart Alarm → Legal → Mobile install → Error handling → Performance → Security.

Run each section once end-to-end and log findings in a shared sheet (columns: Section, Step, Result, Priority, Owner, Status) before any code changes.
