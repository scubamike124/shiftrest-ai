import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCircle2, XCircle, Send, MoonStar } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_NOTIF_PREFS,
  ensurePushSubscription,
  fetchNotifPrefs,
  fetchRecentLog,
  pushSupported,
  saveNotifPrefs,
  subscriptionPayload,
  type NotifPrefsRow,
} from "@/lib/notifications/client";
import {
  subscribePush,
  unsubscribePush,
  sendTestNotification,
} from "@/lib/push/subscribe.functions";
import { REMINDER_DESC, REMINDER_LABEL, type ReminderKind } from "@/lib/notifications/copy";

const KINDS: Array<{ key: keyof NotifPrefsRow; rk: ReminderKind }> = [
  { key: "wind_down", rk: "wind-down" },
  { key: "caffeine_cutoff", rk: "caffeine-cutoff" },
  { key: "bright_light", rk: "bright-light" },
  { key: "shift_start", rk: "shift-start" },
  { key: "shift_end_recovery", rk: "shift-end-recovery" },
  { key: "smart_alarm", rk: "smart-alarm" },
  { key: "calendar", rk: "calendar-prep" },
  { key: "commute", rk: "commute-leave" },
];

export function NotificationsSection({ signedIn }: { signedIn: boolean }) {
  const qc = useQueryClient();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(() =>
    typeof window === "undefined" || !pushSupported() ? "unsupported" : Notification.permission,
  );
  const supported = perm !== "unsupported";

  const subscribeFn = useServerFn(subscribePush);
  const unsubscribeFn = useServerFn(unsubscribePush);
  const testFn = useServerFn(sendTestNotification);

  const { data: prefs = DEFAULT_NOTIF_PREFS } = useQuery({
    queryKey: ["notif-prefs"],
    queryFn: fetchNotifPrefs,
    enabled: signedIn,
  });

  const { data: log = [] } = useQuery({
    queryKey: ["notif-log"],
    queryFn: () => fetchRecentLog(10),
    enabled: signedIn && prefs.enabled,
    refetchInterval: prefs.enabled ? 30_000 : false,
  });

  const save = useMutation({
    mutationFn: saveNotifPrefs,
    onMutate: async (partial) => {
      await qc.cancelQueries({ queryKey: ["notif-prefs"] });
      const prev = qc.getQueryData<NotifPrefsRow>(["notif-prefs"]) ?? prefs;
      qc.setQueryData(["notif-prefs"], { ...prev, ...partial });
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notif-prefs"], ctx.prev);
      toast.error(err instanceof Error ? err.message : "Couldn't save preference.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notif-prefs"] }),
  });

  async function enableEverything() {
    if (!signedIn) {
      toast.error("Sign in to enable reminders across devices.");
      return;
    }
    if (!supported) {
      toast.error("This browser doesn't support push. On iPhone: Share → Add to Home Screen, then re-open.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setPerm(permission);
      if (permission !== "granted") {
        toast.error("Permission was not granted. You can re-enable in browser settings.");
        return;
      }
      const sub = await ensurePushSubscription();
      if (!sub) {
        toast.error("Couldn't register for push. Try again or check browser settings.");
        return;
      }
      await subscribeFn({ data: subscriptionPayload(sub) });
      await save.mutateAsync({ enabled: true, timezone: DEFAULT_NOTIF_PREFS.timezone });
      toast.success("Smart reminders are on.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't enable reminders.");
    }
  }

  async function disableEverything() {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribeFn({ data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      await save.mutateAsync({ enabled: false });
      toast.success("Reminders paused.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disable reminders.");
    }
  }

  async function sendTest() {
    try {
      const result = await testFn({});
      if (result.sent > 0) toast.success("Test sent — check your notifications.");
      else toast.error("No active push subscription. Enable reminders first.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed.");
    }
  }

  const enabled = !!prefs.enabled && perm === "granted";

  const quietStart = prefs.quiet_start.slice(0, 5);
  const quietEnd = prefs.quiet_end.slice(0, 5);

  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Bell className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">Smart reminders</h3>
            <p className="text-xs text-muted-foreground">
              AI-timed pings around your shifts. Quiet hours and a daily cap keep it polite.
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            enabled
              ? "bg-mint/15 text-mint"
              : "bg-secondary text-muted-foreground"
          }`}
        >
          {enabled ? "ON" : "OFF"}
        </span>
      </header>

      <div className="px-4 pb-4">
        {!enabled ? (
          <UnenabledState
            perm={perm}
            supported={supported}
            onEnable={enableEverything}
          />
        ) : (
          <div className="flex gap-2">
            <button
              onClick={sendTest}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-secondary text-sm font-semibold"
            >
              <Send className="h-4 w-4" /> Send test
            </button>
            <button
              onClick={disableEverything}
              className="h-11 rounded-xl bg-destructive/10 px-4 text-sm font-semibold text-destructive"
            >
              Pause
            </button>
          </div>
        )}
      </div>

      {enabled ? (
        <>
          <Divider />
          <div className="divide-y divide-border">
            {KINDS.map(({ key, rk }) => (
              <ToggleRow
                key={rk}
                label={REMINDER_LABEL[rk]}
                desc={REMINDER_DESC[rk]}
                checked={!!prefs[key]}
                onChange={(v) => save.mutate({ [key]: v } as Partial<NotifPrefsRow>)}
              />
            ))}
          </div>

          <Divider />
          <div className="space-y-4 p-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <MoonStar className="h-3.5 w-3.5" /> Quiet hours
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Reminders that fall inside this window are skipped, never queued.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="time"
                  value={quietStart}
                  onChange={(e) =>
                    save.mutate({ quiet_start: e.target.value + ":00" })
                  }
                  className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="time"
                  value={quietEnd}
                  onChange={(e) =>
                    save.mutate({ quiet_end: e.target.value + ":00" })
                  }
                  className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Daily cap
                </p>
                <span className="text-sm font-semibold">{prefs.daily_cap}</span>
              </div>
              <input
                type="range"
                min={1}
                max={6}
                value={prefs.daily_cap}
                onChange={(e) => save.mutate({ daily_cap: Number(e.target.value) })}
                className="mt-2 w-full"
              />
              <p className="text-[11px] text-muted-foreground">
                Max number of pings in any 24-hour window.
              </p>
            </div>
          </div>

          <Divider />
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent reminders
            </p>
            {log.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Nothing yet — your next reminder will appear here.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {log.map((entry) => (
                  <LogRow key={entry.id} entry={entry} />
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Divider() {
  return <div className="mx-4 h-px bg-border" />;
}

function ToggleRow(props: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{props.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{props.desc}</p>
      </div>
      <Switch checked={props.checked} onChange={props.onChange} />
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${
        checked ? "bg-primary" : "bg-secondary"
      }`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-background shadow transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function LogRow({
  entry,
}: {
  entry: {
    kind: string;
    scheduled_for: string;
    sent_at: string | null;
    suppressed_reason: string | null;
    title: string | null;
  };
}) {
  const when = useMemo(() => {
    const d = new Date(entry.scheduled_for);
    return d.toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [entry.scheduled_for]);
  const sent = entry.sent_at !== null;
  return (
    <li className="flex items-start gap-3 rounded-xl bg-secondary/60 p-3">
      <span className={sent ? "text-mint" : "text-muted-foreground"}>
        {sent ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">
          {labelOf(entry.kind)} · {when}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {sent ? entry.title ?? "Sent" : `Skipped: ${entry.suppressed_reason ?? "unknown"}`}
        </p>
      </div>
    </li>
  );
}

function labelOf(kind: string): string {
  return (REMINDER_LABEL as Record<string, string>)[kind] ?? kind;
}

// Keep unused imports happy when nothing renders; ensures tree-shake doesn't drop them.
void useEffect;
