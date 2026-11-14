// Simulator end-to-end check of the site's native code against the REAL
// native plugins in the RestPilot app shell.
//
// CI bundles this file (with the site's own src/lib/native modules) into the
// shell's www/ and loads it locally instead of restpilotai.com. Nothing here
// is shipped. ios-e2e/UITests drives the iOS permission alert and reads the
// result line ("E2E PASS" / "E2E FAIL: ...").
import { isNativeApp } from "@/lib/native-app";
import { nativePlatform, nativePlugin, type PreferencesPlugin } from "@/lib/native/capacitor";
import { buildOfflinePlan, OFFLINE_PLAN_KEY, APP_URL_KEY } from "@/lib/native/offline-plan";
import {
  normalizeSettings,
  planNativeReminders,
  DEFAULT_NATIVE_REMINDER_SETTINGS,
} from "@/lib/native/reminders";
import {
  clearNativeUserData,
  localNotifications,
  REMINDER_SOURCE,
  requestReminderPermission,
  rememberAppUrl,
  syncNativeReminders,
  writeOfflinePlan,
} from "@/lib/native/sync";
import {
  appleHealthAvailable,
  clearAppleHealth,
  connectAppleHealth,
  loadAppleHealth,
  refreshAppleHealth,
} from "@/lib/health/apple-health-store";
import { lastNightFrom } from "@/lib/health/apple-health";
import type { Prefs } from "@/lib/prefs";
import type { Shift } from "@/lib/shifts";

const out = document.getElementById("result")!;
const log = document.getElementById("log")!;
const details: Record<string, unknown> = {};
const note = (k: string, v: unknown) => {
  details[k] = v;
  log.textContent = JSON.stringify(details, null, 1);
};
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Every day 07:00–15:00, weekly rotation, so the 7-day plan is never empty.
const shifts: Shift[] = Array.from({ length: 7 }, (_, day) => ({
  id: `e2e-${day}`,
  day,
  weekIndex: 0,
  start: 7 * 60,
  end: 15 * 60,
  title: "E2E Ward",
}));
const prefs = {
  windDownMin: 60,
  sleepHours: 7,
  cycleWeeks: 1,
  cycleAnchor: null,
  currentTz: null,
  homeTz: null,
} as unknown as Prefs;

async function ownPending(): Promise<
  Array<{ id: number; extra?: Record<string, unknown> | null }>
> {
  const { notifications } = await localNotifications()!.getPending();
  return notifications.filter((n) => n.extra?.source === REMINDER_SOURCE);
}

async function run() {
  // Tap handler first, so a tap on the banner below is seen.
  localNotifications()?.addListener("localNotificationActionPerformed", (e) => {
    const p = e.notification.extra?.path;
    document.getElementById("tapped")!.textContent = `TAPPED ${typeof p === "string" ? p : "?"}`;
  });

  check(isNativeApp(), "isNativeApp() is false inside the shell");
  check(nativePlatform() === "ios", `platform is ${nativePlatform()}`);
  for (const name of ["App", "LocalNotifications", "Preferences", "SplashScreen"]) {
    check(nativePlugin(name), `plugin ${name} is not available`);
  }
  note("plugins", "App, LocalNotifications, Preferences, SplashScreen");

  // Permission: the UI test taps "Allow" on the iOS alert.
  const perm = await requestReminderPermission();
  note("permission", perm);
  check(perm === "granted", `notification permission is ${perm}`);

  // Site planner -> real plugin: what is pending must be exactly the plan.
  const now = new Date();
  const all = normalizeSettings({
    ...DEFAULT_NATIVE_REMINDER_SETTINGS,
    enabled: true,
    kinds: {
      "upcoming-shift": true,
      bedtime: true,
      "wind-down": true,
      "shift-change": true,
      recovery: true,
    },
  });
  const planned = planNativeReminders({ shifts, prefs, settings: all, now });
  check(planned.length > 0, "the plan is empty");
  const r1 = await syncNativeReminders(planned);
  const p1 = await ownPending();
  note("scheduled", {
    result: r1,
    planned: planned.length,
    pending: p1.length,
    firstAt: planned[0].at.toString(),
  });
  check(p1.length === planned.length, `pending ${p1.length} != planned ${planned.length}`);
  check(new Set(p1.map((n) => n.id)).size === p1.length, "duplicate ids pending");

  // Re-plan with fewer kinds: the old ones are cancelled, nothing duplicated.
  const fewer = planNativeReminders({
    shifts,
    prefs,
    now,
    settings: normalizeSettings({
      ...all,
      kinds: { ...all.kinds, bedtime: false, "wind-down": false, recovery: false },
    }),
  });
  await syncNativeReminders(fewer);
  const p2 = await ownPending();
  note("replanned", {
    planned: fewer.length,
    pending: p2.length,
    kinds: [...new Set(p2.map((n) => n.extra?.kind))],
  });
  check(p2.length === fewer.length, `after re-plan pending ${p2.length} != ${fewer.length}`);
  check(
    p2.every((n) => n.extra?.kind === "upcoming-shift" || n.extra?.kind === "shift-change"),
    "a switched-off kind is still pending",
  );

  // A notification that is not ours must survive our cleanup.
  const ln = localNotifications()!;
  await ln.schedule({
    notifications: [
      {
        id: 4242,
        title: "RestPilot E2E reminder",
        body: "Tap to open the plan",
        schedule: { at: new Date(Date.now() + 25_000) },
        extra: { source: "e2e", path: "/plan" },
      },
    ],
  });

  // Sign-out cleanup: our reminders and the offline plan are gone.
  const prefsPlugin = nativePlugin<PreferencesPlugin>("Preferences")!;
  await writeOfflinePlan(buildOfflinePlan({ shifts, prefs, now }));
  await clearNativeUserData();
  const p3 = await ownPending();
  const allPending = (await ln.getPending()).notifications;
  const planAfterClear = (await prefsPlugin.get({ key: OFFLINE_PLAN_KEY })).value;
  note("cleared", {
    own: p3.length,
    other: allPending.filter((n) => n.id === 4242).length,
    plan: planAfterClear,
  });
  check(p3.length === 0, "own reminders left after clear");
  check(
    allPending.some((n) => n.id === 4242),
    "clear removed a notification that is not ours",
  );
  check(planAfterClear === null, "offline plan left after clear");

  // rememberAppUrl only accepts https origins (this page is capacitor://localhost).
  await rememberAppUrl(window.location.origin);
  note("appUrlFromLocalPage", (await prefsPlugin.get({ key: APP_URL_KEY })).value);
  check(
    (await prefsPlugin.get({ key: APP_URL_KEY })).value === null,
    "a non-https origin was stored as the app URL",
  );

  // Leave a saved plan for phase B (the offline screen), pointed at a host
  // that cannot resolve so the offline screen stays up.
  await writeOfflinePlan(buildOfflinePlan({ shifts, prefs, now }));
  await prefsPlugin.set({ key: APP_URL_KEY, value: "https://offline.invalid/" });
  const saved = JSON.parse((await prefsPlugin.get({ key: OFFLINE_PLAN_KEY })).value ?? "null");
  note("savedPlanDays", saved?.days?.length);
  check(saved?.days?.length === 14, "offline plan was not saved");
}

run().then(
  () => {
    out.textContent = "E2E PASS";
  },
  (err) => {
    out.textContent = `E2E FAIL: ${err instanceof Error ? err.message : String(err)}`;
  },
);

// ---------------------------------------------------------------------------
// Apple Health: the site's connector, through the real RestPilotHealth plugin,
// against the night the E2E host app wrote into the simulator's Health store.
// Started by the UI test tapping the button (the Health sheet needs a tap).
const healthOut = document.getElementById("health")!;

async function health() {
  check(await appleHealthAvailable(), "Apple Health is not available in the shell");
  const user = "e2e-user";
  const state = await connectAppleHealth(user);
  const last = lastNightFrom(state.nights, new Date());
  note("appleHealthLastNight", last);
  check(last, `no recent night read (nights: ${state.nights.length})`);
  const want = {
    sleepDurationMin: 390,
    awakeMin: 30,
    deepMin: 60,
    remMin: 90,
    lightMin: 240,
    hrvMs: 45,
    restingHr: 57,
  };
  for (const [k, v] of Object.entries(want)) {
    check(
      (last as Record<string, unknown>)[k] === v,
      `${k} is ${(last as Record<string, unknown>)[k]}, expected ${v}`,
    );
  }
  check(last.sleepEfficiency === 0.81, `efficiency ${last.sleepEfficiency}`);

  const again = await refreshAppleHealth(user);
  check(again?.nights.length === state.nights.length, "refresh changed the nights");

  // Disconnect: stop reading and delete the stored copy.
  clearAppleHealth();
  check(loadAppleHealth(user) === null, "data left after Disconnect");
  check((await refreshAppleHealth(user)) === null, "refresh after Disconnect brought data back");
  check(
    !JSON.stringify(Object.keys(window.localStorage)).includes("apple-health"),
    "storage key left",
  );
}

document.getElementById("health-run")!.addEventListener("click", () => {
  healthOut.textContent = "HEALTH RUNNING";
  health().then(
    () => {
      healthOut.textContent = "HEALTH PASS";
    },
    (err) => {
      healthOut.textContent = `HEALTH FAIL: ${err instanceof Error ? err.message : String(err)}`;
    },
  );
});
