// Slice 7 — Afternoon Check-In card components. Each card hides itself
// when there's no payload; client-only reminders (hydration, movement,
// battery) live entirely in the browser to avoid server noise.

import { useEffect, useState } from "react";
import {
  Calendar,
  CloudRain,
  Droplet,
  Footprints,
  BatteryLow,
  Clock,
  MoonStar,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { AfternoonBriefDTO } from "@/lib/companion/types";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function RemainingCard({ remaining }: { remaining: AfternoonBriefDTO["remaining"] }) {
  if (!remaining || remaining.items.length === 0) return null;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Rest of today</p>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {remaining.items.map((it) => (
          <li key={it.id} className="flex items-baseline gap-2">
            <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
              {fmtTime(it.atISO)}
            </span>
            <span className="min-w-0 truncate text-foreground">{it.title}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function NextTrafficCard({ nextTraffic }: { nextTraffic: AfternoonBriefDTO["nextTraffic"] }) {
  if (!nextTraffic) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Clock className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Next appointment</p>
          <p className="mt-0.5 text-sm">
            Leave by{" "}
            <span className="font-semibold text-foreground">{fmtTime(nextTraffic.leaveByISO)}</span>{" "}
            for {nextTraffic.eventTitle}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            ~{nextTraffic.baselineMin} min · arrives by {fmtTime(nextTraffic.eventISO)}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function WeatherShiftCard({ shift }: { shift: AfternoonBriefDTO["weatherShift"] }) {
  if (!shift) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CloudRain className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Weather change</p>
          <p className="mt-0.5 text-sm">
            {shift.rainSoon
              ? "Rain likely in the next few hours."
              : `Temperature shifting — currently ${Math.round(shift.nowC)}°.`}
          </p>
          {shift.later.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {shift.later
                .map((p) => `${fmtTime(p.hourISO + ":00")} ${Math.round(p.tempC)}°`)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function WorkingLateCard({ workingLate }: { workingLate: AfternoonBriefDTO["workingLate"] }) {
  if (!workingLate) return null;
  return (
    <Card className="border-amber/40 bg-amber/5 p-4">
      <div className="flex items-start gap-3">
        <MoonStar className="mt-0.5 h-4 w-4 text-amber" />
        <div className="min-w-0">
          <p className="text-sm">
            Looks like a late one — last item is{" "}
            <span className="font-medium">{workingLate.lastEventTitle}</span> at{" "}
            {fmtTime(workingLate.lastEventISO)}.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            I&apos;ll help you wind down whenever you&apos;re ready.
          </p>
        </div>
      </div>
    </Card>
  );
}

const HYDRATION_KEY = "afternoon:hydration:done";
const MOVEMENT_KEY = "afternoon:movement:done";
function isToday(iso: string | null) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export function HydrationCard() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    try {
      setDone(isToday(localStorage.getItem(HYDRATION_KEY)));
    } catch { /* noop */ }
  }, []);
  if (done) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Droplet className="mt-0.5 h-4 w-4 text-sky-500" />
        <div className="flex-1 min-w-0">
          <p className="text-sm">Hydration check — grab a glass of water.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            try { localStorage.setItem(HYDRATION_KEY, new Date().toISOString()); } catch { /* noop */ }
            setDone(true);
          }}
          className="rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-muted"
        >
          Done
        </button>
      </div>
    </Card>
  );
}

export function MovementCard() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    try {
      setDone(isToday(localStorage.getItem(MOVEMENT_KEY)));
    } catch { /* noop */ }
  }, []);
  if (done) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Footprints className="mt-0.5 h-4 w-4 text-emerald-500" />
        <div className="flex-1 min-w-0">
          <p className="text-sm">Stand and stretch for two minutes.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            try { localStorage.setItem(MOVEMENT_KEY, new Date().toISOString()); } catch { /* noop */ }
            setDone(true);
          }}
          className="rounded-md border border-border/60 px-2 py-1 text-xs hover:bg-muted"
        >
          Done
        </button>
      </div>
    </Card>
  );
}

type BatteryLike = {
  level: number;
  charging: boolean;
  addEventListener?: (event: string, listener: () => void) => void;
  removeEventListener?: (event: string, listener: () => void) => void;
};

export function BatteryCard() {
  const [info, setInfo] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    let battery: BatteryLike | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    nav.getBattery?.().then((b) => {
      if (cancelled) return;
      battery = b;
      const sync = () => setInfo({ level: b.level, charging: b.charging });
      sync();
      b.addEventListener?.("levelchange", sync);
      b.addEventListener?.("chargingchange", sync);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      battery?.removeEventListener?.("levelchange", () => undefined);
      battery?.removeEventListener?.("chargingchange", () => undefined);
    };
  }, []);
  if (!info) return null;
  if (info.charging) return null;
  if (info.level > 0.2) return null;
  return (
    <Card className="border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <BatteryLow className="mt-0.5 h-4 w-4 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm">
            Battery is at {Math.round(info.level * 100)}% — a top-up before your next outing might help.
          </p>
        </div>
      </div>
    </Card>
  );
}
