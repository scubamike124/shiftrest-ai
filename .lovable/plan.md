# Smart Alarm — Investigation (no code changes yet)

## 1. Full flow trace

```
[User]
  └─ picks datetime-local (local tz)  →  targetLocal string "YYYY-MM-DDTHH:mm"
       src/components/SmartAlarmCard.tsx : setTargetLocal (L257)
[Client schedule()]  L137–223
  ├─ target = new Date(targetLocal)                                 (L144, local tz)
  ├─ if adjustmentMode="smart":
  │     aiSmartAlarm({ targetWakeIso: target.toISOString(),
  │                    windowMin })                                 (L155–158)
  ├─ if adjustmentMode="exact":  wakeAt = target                     (L160–168)
  ├─ Client re-clamp: if |wake-target| > cap*60_000 + 999  → reset to target  (L172–183)
  ├─ createEvent({ startsAt: wake.toISOString(), ... })              (L197–203)
  ├─ addAlarm({ firesAt: new Date(saved.startsAt).getTime() })      (L204)
  └─ qc.invalidateQueries(["events"])                                (L205)
[useEffect [alarms]]  L108
  └─ syncAlarms(alarms.map(a → { firesAt: new Date(a.startsAt).getTime() }))
[Server /api/ai  intent=smart_alarm]  src/routes/api/ai.ts L403–411, L513–556
  ├─ Prompt forces wakeAt ∈ [target±windowMin], must move ≥1 min    (L88–95)
  ├─ Safety snap:
  │     if driftMs > windowMs  OR  driftMs < 60_000
  │        → offset = min(windowMs, cycleMs*0.25) = 5min for a 5-min window
  │        → sign: honor model sign if inside window, else alternate by day parity
  │        → parsed.wakeAt = target + sign*offset                    (L517–556)
[Foreground scheduler]  src/lib/alarm/foreground.ts
  ├─ armEntry(id, firesAt):
  │     delay ≤ 250ms       → fire ASAP
  │     delay ≤ 6h          → single setTimeout(fire, delay)
  │     delay >  6h          → hop timer (6h - 60s), then re-arm    (L61–101)
  ├─ Fires: dispatch alarm:fired → startChime(sound, volume, fade)
  │          + vibrate + speakQueued + auto stopRinging in 60s     (L195–222)
```

## 2. What already works (confirmed by code reading)

- Timezone: `datetime-local` → `new Date(str)` parses as local; `.toISOString()` sends UTC; server echoes UTC; client `new Date(res.wakeAt)` renders local. No drift.
- Window enforcement: client re-clamps at ±cap (L172–183). Server snaps if drift < 60s. So "AI ignored" is no longer possible for windowMin ≥ 1.
- 6-hour setTimeout cap: `MAX_HOP_MS = 6h` with hop re-arm. Long-horizon alarms are covered.
- Re-arm on refetch: `syncAlarms` clears existing timer before re-arming (`armEntry` L62–63). No duplicate timers.
- Client immediately calls `addAlarm` after `createEvent`, so ringing does not depend on the query refetch.

## 3. Highest-probability root causes for "does not ring after Smart Adjustment"

Ranked. All are reproducible statically from the code trace above.

### Candidate A — Foreground scheduler is the *only* firing path; the tab must stay open
- `foreground.ts` is a `setTimeout` in the current browser tab. If the PWA is backgrounded, force-quit, or the phone locks and iOS suspends the tab, the timer never resolves.
- The events refetch on tab focus armed a timer that already missed its wall-clock deadline, so `armEntry` sees `delay ≤ 250ms` and fires *late* if the tab returns before the auto-stop, or drops the alarm silently if it returns after the wake time and `syncAlarms` re-armed with a past `firesAt` that iOS timer coalescing skipped.
- There is no background/OS-level alarm path in the codebase (no Web Push firing at wake time, no native scheduler, no service-worker Notification.showNotification).
- **This matches the user's real-device symptom exactly**: alarm rings when app is open, silently misses when app is closed/backgrounded on iOS.

### Candidate B — `stopRinging` from other UI paths cancels a live alarm
- `previewAlarmSound` (sound preview in Settings sheet) calls `stopRinging()` (L174). If the user is inside the Alarm settings sheet at fire time or previewed a sound recently, `ringingStop` gets reassigned, and the *next* fire's `startChime` will call `stopRinging()` again (L225), which nulls the audio graph before the chime is fully connected. This is a race, not the primary bug, but it can look like "silent alarm."

### Candidate C — Server snap window at driftMs < 60s can move alarm into the past
- `smart_alarm` snap picks `sign = day-parity`. If the user schedules an alarm 4 minutes from now with windowMin=5, the earlier branch produces `wakeAt = now - 1 min`. Client clamp at L172 accepts it because `|wake-target| = 5min ≤ cap`. `createEvent` stores past ISO. `addAlarm` sees `delay ≤ 250ms` and fires immediately. To the user this looks like "the alarm went off right after I set it" rather than "didn't ring at the shown time."
- Only affects test-setups where target is close to now; unlikely to be the launch-blocker but worth fixing while we're in the file.

## 4. Why previous fixes didn't resolve it

| Prior fix | What it addressed | Why it didn't fix Candidate A |
|---|---|---|
| Client clamp at ±cap | Model returning too-large moves | Doesn't touch background firing |
| Server snap ≥ 60s + sign honoring | Model echoing target | Doesn't touch background firing |
| 6-hour hop re-arm | Long-horizon `setTimeout` cap | Only helps if tab stays alive; iOS suspends timers regardless of hop count |
| Homepage mock label update | Marketing page mismatch | Cosmetic only |

Every prior fix operated on the *time computation* or *labels*, never on the *delivery mechanism*. The delivery mechanism is a single foreground `setTimeout`.

## 5. Proposed smallest fix (Candidate A)

Two-layer delivery, smallest possible surface:

1. **Wake-time OS notification** — at `createEvent` time, request `Notification.permission` (if not already granted) and schedule a service-worker `showNotification` for `firesAt` using the existing PWA service worker. This is the OS-level backstop for iOS/Android PWAs. Falls back gracefully when permission is denied → user sees the current "keep app open" hint that already exists at L468–472.
2. **Keep the existing foreground `setTimeout`** unchanged as the audible ringer when the tab *is* open.

No changes to the AI/snap logic. No changes to the UI labels. Only adds a permission prompt on first Smart Alarm creation and a service-worker notification scheduler.

## 6. Verification plan (after approval)

End-to-end passes required, not just build:
- Set target 90s out with Smart Adjustment 5 min → confirm displayed wake ≠ target and is within ±5 min.
- Background the tab; confirm the OS notification fires at the displayed wake time.
- Foreground the tab at fire time → confirm audible chime still plays (existing path).
- Snooze → creates a follow-up alarm at now+snoozeMin, both paths re-arm.
- Stop → both audible ringing stops and no second notification.
- Repeat 3× consecutively with different adjustment windows (5, 15, 30) to confirm consistency.

## 7. Ask before I implement

Before I write anything, please confirm the *current* observed failure so I fix the right layer:

- (a) Alarm doesn't ring when the app is **backgrounded / phone locked** → Candidate A. Approve the OS-notification backstop.
- (b) Alarm doesn't ring even with the app **open in the foreground** → Candidate B/C or something new. I'll add instrumentation first (enable `restpilot:debug-alarm=1` and capture `[alarm]` logs) instead of guessing.
- (c) Alarm rings **at the wrong time** (not the displayed time) → Candidate C. Fix the snap floor so it can't move into the past.

I will not touch code until you tell me which of (a)/(b)/(c) matches your last device test.
