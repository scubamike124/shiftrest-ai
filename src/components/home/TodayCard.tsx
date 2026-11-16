// Home "Today" card: answers, at a glance and one-handed,
//   1. When is my next shift?   2. When should I sleep?
//   3. What is my next reminder? 4. What do I do if my shift changed?
// Times come from the shared schedule engine via home-summary.ts.
import { useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  BellRing,
  BriefcaseMedical,
  CalendarClock,
  Moon,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  clearOverride,
  computeHomeSummary,
  deviceTimeZone,
  OVERRIDES_EVENT,
  readOverrides,
  saveOverride,
  type StoredOverride,
} from "@/lib/home-summary";
import type { Shift } from "@/lib/shifts";
import type { ScheduledShift } from "@/lib/schedule-core";

type Props = {
  shifts: Shift[];
  prefs: {
    sleepHours: number;
    windDownMin: number;
    cycleAnchor: string | null;
    cycleWeeks: number;
  };
  userId: string | null;
  now: Date;
  /** Open the weekly schedule editor (for changes that repeat). */
  onEditSchedule: () => void;
};

const EXTEND_OPTIONS = [
  { min: 30, label: "+30 min" },
  { min: 60, label: "+1 h" },
  { min: 120, label: "+2 h" },
  { min: 180, label: "+3 h" },
];

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function time(d: Date) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function dayTime(d: Date, now: Date) {
  if (sameDay(d, now)) return `Today ${time(d)}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(d, tomorrow)) return `Tomorrow ${time(d)}`;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${time(d)}`;
}
function until(d: Date, now: Date) {
  const min = Math.round((d.getTime() - now.getTime()) / 60000);
  if (min <= 0) return "now";
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

function Row({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail?: React.ReactNode;
  tone?: "warn";
}) {
  return (
    <div className="flex min-h-14 items-start gap-3 py-3">
      <span
        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          tone === "warn" ? "bg-amber/15 text-amber" : "bg-primary/15 text-indigo-glow"
        }`}
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-lg font-semibold leading-snug text-foreground">{value}</p>
        {detail ? <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}

export function TodayCard({ shifts, prefs, userId, now, onEditSchedule }: Props) {
  const [overrides, setOverrides] = useState<StoredOverride[]>([]);
  const [open, setOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [customEnd, setCustomEnd] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);

  useEffect(() => {
    setOverrides(readOverrides(userId));
    const onChange = () => setOverrides(readOverrides(userId));
    window.addEventListener(OVERRIDES_EVENT, onChange);
    return () => window.removeEventListener(OVERRIDES_EVENT, onChange);
  }, [userId]);

  const tz = useMemo(() => deviceTimeZone(), []);
  const summary = useMemo(
    () =>
      computeHomeSummary({
        shifts: shifts.map((s) => ({
          id: s.id,
          day: s.day,
          weekIndex: s.weekIndex,
          start: s.start,
          end: s.end,
          title: s.title,
        })),
        prefs,
        now,
        tz,
        overrides,
      }),
    [shifts, prefs, now, tz, overrides],
  );

  // The sheet acts on the picked candidate (defaults to the most likely one).
  const candidates = summary.changeCandidates;
  const target: ScheduledShift | null =
    candidates.find((c) => c.id === pickedId) ?? summary.changeTarget;
  const hasShifts = shifts.length > 0;
  const hasChanges = summary.appliedChanges.length > 0;
  function candidateLabel(c: ScheduledShift) {
    if (summary.onShift && c.id === summary.onShift.id) return "Current shift";
    return c.startsAt.getTime() > now.getTime() ? "Next shift" : "Last shift";
  }

  function extendTo(endsAt: Date) {
    if (!target) return;
    if (endsAt.getTime() <= target.endsAt.getTime()) {
      toast.error("Pick an end time later than the current one.");
      return;
    }
    if (endsAt.getTime() - target.startsAt.getTime() > 24 * 3_600_000) {
      toast.error("A shift cannot be longer than 24 hours.");
      return;
    }
    saveOverride(userId, {
      kind: "extend",
      shiftId: target.id,
      endsAt: endsAt.toISOString(),
      savedAt: new Date().toISOString(),
    });
    setOpen(false);
    toast.success(`Shift now ends ${time(endsAt)}. Today's sleep plan moved to match.`);
  }

  function extendBy(min: number) {
    if (target) extendTo(new Date(target.endsAt.getTime() + min * 60_000));
  }

  function extendToTime(value: string) {
    if (!target || !/^\d{2}:\d{2}$/.test(value)) return;
    const [h, m] = value.split(":").map(Number);
    const d = new Date(target.endsAt);
    d.setHours(h, m, 0, 0);
    // The new end is the first such clock time after the scheduled end.
    while (d.getTime() <= target.endsAt.getTime()) d.setDate(d.getDate() + 1);
    extendTo(d);
  }

  function cancelShift() {
    if (!target) return;
    saveOverride(userId, { kind: "cancel", shiftId: target.id, savedAt: new Date().toISOString() });
    setConfirmCancel(false);
    setOpen(false);
    toast.success("Shift marked as called off. Today's plan updated.");
  }

  function undo(shiftId: string) {
    clearOverride(userId, shiftId);
    toast.success("Change undone.");
  }

  const s = summary.sleep;
  const shiftValue = summary.onShift
    ? `On shift until ${time(summary.onShift.endsAt)}`
    : summary.nextShift
      ? dayTime(summary.nextShift.startsAt, now)
      : hasShifts
        ? "No shift in the next week"
        : "No shifts added yet";
  const shiftDetail = summary.onShift
    ? summary.nextShift
      ? `Next: ${dayTime(summary.nextShift.startsAt, now)}`
      : undefined
    : summary.nextShift
      ? `${until(summary.nextShift.startsAt, now)} · ends ${time(summary.nextShift.endsAt)}`
      : undefined;

  return (
    <section aria-labelledby="today-title" className="glass-card glass-card-accent p-5 sm:p-6">
      <p className="card-eyebrow">Today</p>
      <h2 id="today-title" className="sr-only">
        Today at a glance
      </h2>

      <div className="mt-1 divide-y divide-border">
        <Row
          icon={<BriefcaseMedical className="h-5 w-5" />}
          label="Next shift"
          value={shiftValue}
          detail={shiftDetail}
        />
        <Row
          icon={<Moon className="h-5 w-5" />}
          label="Sleep"
          value={
            s ? `${dayTime(s.sleepStart, now)} – ${time(s.sleepEnd)}` : "Keep your usual bedtime"
          }
          detail={
            s
              ? `Wind down ${time(s.windDownStart)} · last caffeine ${time(s.caffeineCutoff)}`
              : hasShifts
                ? undefined
                : "Add your shifts to get a sleep plan."
          }
        />
        {s?.shortTurnaround ? (
          <Row
            tone="warn"
            icon={<TriangleAlert className="h-5 w-5" />}
            label="Short turnaround"
            value={`Only ${Math.floor(s.sleepMinutes / 60)} h ${s.sleepMinutes % 60} min to sleep`}
            detail="Protect this window: blackout, no caffeine, phone on Do Not Disturb."
          />
        ) : null}
        <Row
          icon={<BellRing className="h-5 w-5" />}
          label="Next on your plan"
          value={summary.reminder ? summary.reminder.label : "Nothing scheduled"}
          detail={
            summary.reminder
              ? `${dayTime(summary.reminder.at, now)} · ${until(summary.reminder.at, now)}${
                  hasChanges ? " · phone reminders follow your weekly schedule" : ""
                }`
              : undefined
          }
        />
      </div>

      {summary.appliedChanges.map(({ override, original }) => (
        <div
          key={override.shiftId}
          className="mt-3 flex min-h-11 items-center justify-between gap-3 rounded-xl bg-primary/10 px-3 py-2 text-sm"
        >
          <span className="min-w-0 text-foreground">
            {override.kind === "cancel"
              ? `Called off: ${dayTime(original.startsAt, now)}`
              : `Extended: ends ${time(new Date(override.endsAt))} (was ${time(original.endsAt)})`}
          </span>
          <button
            type="button"
            onClick={() => undo(override.shiftId)}
            aria-label={`Undo change to the ${dayTime(original.startsAt, now)} shift`}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 font-semibold text-indigo-glow"
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Undo
          </button>
        </div>
      ))}

      {hasShifts ? (
        <button
          type="button"
          onClick={() => {
            setPickedId(summary.changeTarget?.id ?? null);
            setOpen(true);
          }}
          // Wait for the signed-in user, so the change is saved under their key.
          disabled={!target || !userId}
          className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition active:scale-[0.99] disabled:opacity-50"
        >
          <CalendarClock className="h-5 w-5" aria-hidden />
          My shift changed
        </button>
      ) : (
        <button
          type="button"
          onClick={onEditSchedule}
          className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-base font-semibold text-primary-foreground"
        >
          <CalendarClock className="h-5 w-5" aria-hidden />
          Add your shifts
        </button>
      )}

      <Drawer
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setConfirmCancel(false);
        }}
      >
        <DrawerContent className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-sans text-lg">My shift changed</DrawerTitle>
            <DrawerDescription>
              {target
                ? `${target.title ? `${target.title}: ` : ""}${dayTime(target.startsAt, now)} – ${time(target.endsAt)}`
                : "No shift to change."}
            </DrawerDescription>
          </DrawerHeader>
          {target ? (
            <div className="space-y-5 px-4">
              {candidates.length > 1 ? (
                <div
                  role="radiogroup"
                  aria-label="Which shift changed?"
                  className="grid grid-cols-2 gap-2"
                >
                  {candidates.map((c) => {
                    const selected = c.id === target.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setPickedId(c.id);
                          setConfirmCancel(false);
                        }}
                        className={`min-h-14 rounded-xl border px-3 py-2 text-left ${
                          selected ? "border-primary bg-primary/15" : "border-border bg-card"
                        }`}
                      >
                        <span className="block text-xs text-muted-foreground">
                          {candidateLabel(c)}
                        </span>
                        <span className="block text-sm font-semibold">
                          {dayTime(c.startsAt, now)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <AlarmClock className="h-4 w-4 text-primary" aria-hidden /> Running late or
                  extended
                </p>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {EXTEND_OPTIONS.map((o) => (
                    <button
                      key={o.min}
                      type="button"
                      onClick={() => extendBy(o.min)}
                      className="min-h-[52px] rounded-xl border border-border bg-card text-base font-semibold active:scale-95"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    extendToTime(customEnd);
                  }}
                >
                  <label className="sr-only" htmlFor="shift-new-end">
                    New end time
                  </label>
                  <input
                    id="shift-new-end"
                    type="time"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="min-h-12 flex-1 rounded-xl border border-border bg-input px-3 text-base"
                  />
                  <button
                    type="submit"
                    disabled={!customEnd}
                    className="min-h-12 rounded-xl bg-secondary px-4 text-sm font-semibold disabled:opacity-50"
                  >
                    Set end time
                  </button>
                </form>
              </div>

              <div>
                <p className="text-sm font-semibold">Called off</p>
                {confirmCancel ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={cancelShift}
                      className="min-h-12 rounded-xl border border-destructive bg-destructive/10 px-3 text-sm font-semibold text-destructive"
                    >
                      Yes, called off
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmCancel(false)}
                      className="min-h-12 rounded-xl border border-border px-3 text-sm font-semibold"
                    >
                      Keep shift
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    className="mt-2 min-h-12 w-full rounded-xl border border-border px-3 text-sm font-semibold"
                  >
                    This shift was called off
                  </button>
                )}
              </div>

              <div>
                <p className="text-sm font-semibold">Different times from now on</p>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onEditSchedule();
                  }}
                  className="mt-2 min-h-12 w-full rounded-xl border border-border px-3 text-sm font-semibold"
                >
                  Edit my weekly schedule
                </button>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                One-off changes update today&apos;s plan on this screen and are kept on this device
                for two days. Your weekly schedule and the reminders already set on your phone
                follow your regular shifts; edit the weekly schedule if the change repeats.
              </p>
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>
    </section>
  );
}
