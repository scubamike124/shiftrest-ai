import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, Moon, Sun, ChevronRight, Sparkles } from "lucide-react";
import { DISCLAIMER } from "@/lib/shifts";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile & Preferences — ShiftRest AI" },
      { name: "description", content: "Manage your sleep preferences, notifications, and wind-down length." },
    ],
  }),
  component: Profile,
});

type Prefs = {
  windDownMin: number;
  sleepHours: number;
  notifications: boolean;
  lowLight: boolean;
};

const DEFAULTS: Prefs = { windDownMin: 120, sleepHours: 8, notifications: true, lowLight: true };
const KEY = "shiftrest.prefs.v1";

function Profile() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) });
    } catch {}
  }, []);

  function update<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  }

  return (
    <main className="flex flex-col gap-6 px-5 pt-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Profile
        </p>
        <h1 className="mt-2 text-3xl font-bold">Your preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fine-tune how ShiftRest plans your recovery windows.
        </p>
      </header>

      <Link
        to="/paywall"
        className="flex items-center justify-between rounded-2xl border border-primary/30 bg-primary/10 p-4"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Upgrade to Premium</p>
            <p className="text-xs text-muted-foreground">Unlock the AI Sleep Coach</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>

      <section className="rounded-2xl border border-border bg-card">
        <SliderRow
          icon={<Moon className="h-5 w-5" />}
          label="Wind-down window"
          value={`${prefs.windDownMin} min`}
          input={
            <input
              type="range"
              min={60}
              max={180}
              step={15}
              value={prefs.windDownMin}
              onChange={(e) => update("windDownMin", Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
            />
          }
        />
        <Divider />
        <SliderRow
          icon={<Sun className="h-5 w-5" />}
          label="Target sleep"
          value={`${prefs.sleepHours} hrs`}
          input={
            <input
              type="range"
              min={6}
              max={9}
              step={0.5}
              value={prefs.sleepHours}
              onChange={(e) => update("sleepHours", Number(e.target.value))}
              className="w-full accent-[var(--primary)]"
            />
          }
        />
      </section>

      <section className="rounded-2xl border border-border bg-card">
        <ToggleRow
          icon={<Bell className="h-5 w-5" />}
          label="Wind-down notifications"
          desc="Gentle reminders before your sleep window starts."
          checked={prefs.notifications}
          onChange={(v) => update("notifications", v)}
        />
        <Divider />
        <ToggleRow
          icon={<Moon className="h-5 w-5" />}
          label="Low-light interface"
          desc="Already on. Toggle off for brighter daytime use."
          checked={prefs.lowLight}
          onChange={(v) => update("lowLight", v)}
        />
      </section>

      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        {DISCLAIMER}
      </p>
    </main>
  );
}

function Divider() {
  return <div className="mx-4 h-px bg-border" />;
}

function SliderRow({
  icon,
  label,
  value,
  input,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  input: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
            {icon}
          </span>
          <p className="text-sm font-semibold">{label}</p>
        </div>
        <span className="text-sm font-semibold text-primary">{value}</span>
      </div>
      {input}
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  desc,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
          {icon}
        </span>
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <span
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? "bg-primary" : "bg-secondary"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-background shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </label>
  );
}
