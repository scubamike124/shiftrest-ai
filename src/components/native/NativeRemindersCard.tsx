// Reminders inside the RestPilot iPhone app: local notifications scheduled on
// the phone (they fire with no signal and with the app closed). Replaces the
// Web Push controls in the app shell, where Web Push does not exist.

import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PREFS, fetchPrefs } from "@/lib/prefs";
import { fetchShifts } from "@/lib/shifts";
import {
  DAILY_CAP_RANGE,
  LEAD_OPTIONS,
  NATIVE_REMINDER_DESC,
  NATIVE_REMINDER_KINDS,
  NATIVE_REMINDER_LABEL,
  planNativeReminders,
  type NativeReminderSettings,
} from "@/lib/native/reminders";
import {
  loadReminderSettings,
  reminderPermission,
  requestReminderPermission,
  saveReminderSettings,
} from "@/lib/native/sync";
import type { PermissionState } from "@/lib/native/capacitor";

function fmtWhen(d: Date): string {
  return d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

export function NativeRemindersCard({ signedIn }: { signedIn: boolean }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<NativeReminderSettings>(() =>
    loadReminderSettings(null),
  );
  const [perm, setPerm] = useState<PermissionState | "unavailable" | "unknown">("unknown");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const id = data.session?.user.id ?? null;
      setUserId(id);
      setSettings(loadReminderSettings(id));
    });
    void reminderPermission().then((p) => active && setPerm(p));
    return () => {
      active = false;
    };
  }, []);

  const { data: shifts = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: fetchShifts,
    enabled: signedIn,
  });
  const { data: prefs = DEFAULT_PREFS } = useQuery({
    queryKey: ["prefs"],
    queryFn: fetchPrefs,
    initialData: DEFAULT_PREFS,
  });
  const next = useMemo(
    () => planNativeReminders({ shifts, prefs, settings, now: new Date() })[0] ?? null,
    [shifts, prefs, settings],
  );

  function update(patch: Partial<NativeReminderSettings>) {
    if (!userId) return;
    const merged = { ...settings, ...patch };
    setSettings(merged);
    saveReminderSettings(userId, merged);
  }

  async function setEnabled(on: boolean) {
    if (!on) {
      update({ enabled: false });
      toast.success("Reminders are off on this iPhone.");
      return;
    }
    setBusy(true);
    try {
      // Asked here, when the person turns reminders on: never on app launch.
      const p = perm === "granted" ? "granted" : await requestReminderPermission();
      setPerm(p);
      if (p !== "granted") {
        toast.error("Notifications are off for RestPilot. You can turn them on in Settings.");
        return;
      }
      update({ enabled: true });
      toast.success("Reminders are on. They work even without signal.");
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">Reminders</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to get reminders for your shifts and sleep.
        </p>
      </section>
    );
  }

  const on = settings.enabled && perm === "granted";

  return (
    <section
      className="rounded-2xl border border-border bg-card"
      aria-labelledby="native-reminders-title"
    >
      <div className="flex items-start gap-3 p-4">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"
          aria-hidden="true"
        >
          {on ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="native-reminders-title" className="text-base font-semibold">
            Reminders on this iPhone
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Sent by the app on this phone, from your shifts and sleep plan. They work without
            signal.
          </p>
        </div>
        <SwitchControl
          label="Reminders on this iPhone"
          checked={on}
          disabled={busy || !userId}
          onChange={setEnabled}
        />
      </div>

      {perm === "denied" && (
        <div className="mx-4 mb-4 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
          <p className="font-semibold">Notifications are turned off for RestPilot</p>
          <p className="mt-1 text-muted-foreground">
            Turn them on in Settings, then come back here.
          </p>
          <a
            href="app-settings:"
            className="mt-2 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Open Settings
          </a>
        </div>
      )}

      {on && (
        <>
          <p className="px-4 pb-3 text-sm text-muted-foreground" aria-live="polite">
            {next
              ? `Next: ${NATIVE_REMINDER_LABEL[next.kind]}, ${fmtWhen(next.at)}`
              : shifts.length
                ? "Nothing in the next 7 days with these settings."
                : "Add your shifts to get reminders."}
          </p>
          <div className="h-px bg-border" />
          <ul className="divide-y divide-border">
            {NATIVE_REMINDER_KINDS.map((k) => (
              <li key={k} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{NATIVE_REMINDER_LABEL[k]}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{NATIVE_REMINDER_DESC[k]}</p>
                </div>
                <SwitchControl
                  label={NATIVE_REMINDER_LABEL[k]}
                  checked={settings.kinds[k]}
                  onChange={(v) => update({ kinds: { ...settings.kinds, [k]: v } })}
                />
              </li>
            ))}
          </ul>
          <div className="h-px bg-border" />
          <div className="grid gap-4 p-4">
            <SelectRow
              label="Shift reminder"
              value={String(settings.upcomingShiftLeadMin)}
              options={LEAD_OPTIONS.map((m) => ({
                value: String(m),
                label: m < 60 ? `${m} min before` : `${m / 60} h before`,
              }))}
              onChange={(v) => update({ upcomingShiftLeadMin: Number(v) })}
            />
            <SelectRow
              label="Most reminders per day"
              value={String(settings.dailyCap)}
              options={Array.from(
                { length: DAILY_CAP_RANGE.max - DAILY_CAP_RANGE.min + 1 },
                (_, i) => {
                  const n = DAILY_CAP_RANGE.min + i;
                  return { value: String(n), label: String(n) };
                },
              )}
              onChange={(v) => update({ dailyCap: Number(v) })}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Quiet hours</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  No reminders between these times.
                </p>
              </div>
              <SwitchControl
                label="Quiet hours"
                checked={settings.quietHours.enabled}
                onChange={(v) => update({ quietHours: { ...settings.quietHours, enabled: v } })}
              />
            </div>
            {settings.quietHours.enabled && (
              <div className="grid grid-cols-2 gap-3">
                <TimeField
                  label="From"
                  value={settings.quietHours.start}
                  onChange={(v) => update({ quietHours: { ...settings.quietHours, start: v } })}
                />
                <TimeField
                  label="Until"
                  value={settings.quietHours.end}
                  onChange={(v) => update({ quietHours: { ...settings.quietHours, end: v } })}
                />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function SwitchControl(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      // 44pt touch target around a 28pt switch.
      className="relative -m-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center p-2 disabled:opacity-50"
    >
      <span
        className={`relative block h-7 w-12 rounded-full transition ${props.checked ? "bg-primary" : "bg-secondary"}`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-background shadow transition ${props.checked ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </span>
    </button>
  );
}

function SelectRow(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm font-semibold">
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="min-h-11 rounded-lg border border-border bg-background px-3 text-base"
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TimeField(props: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">
        {props.label}
      </label>
      <input
        id={id}
        type="time"
        value={props.value}
        onChange={(e) => e.target.value && props.onChange(e.target.value)}
        className="min-h-11 rounded-lg border border-border bg-background px-3 text-base"
      />
    </div>
  );
}
