import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bell,
  Moon,
  Sun,
  ChevronRight,
  Sparkles,
  MapPin,
  Activity,
  Users,
  Heart,
} from "lucide-react";
import { DISCLAIMER } from "@/lib/shifts";
import { DEFAULT_PREFS, PREFS_KEY, type Prefs } from "@/lib/prefs";
import {
  getPermission,
  requestPermission,
  scheduleNextWindDown,
  showNotification,
  nextWindDownAt,
  type NotifyPermission,
} from "@/lib/notify";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile & Preferences — ShiftRest AI" },
      {
        name: "description",
        content: "Manage your sleep preferences, location, partner share, and wearable sync.",
      },
    ],
  }),
  component: Profile,
});

function Profile() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch {}
  }, []);

  function update<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  }

  function detectLocation() {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not supported");
      return;
    }
    toast.info("Detecting location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = {
          ...prefs,
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          locationLabel: `${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`,
        };
        setPrefs(next);
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
        toast.success("Location updated");
      },
      () => toast.error("Location permission denied"),
    );
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
            <p className="text-xs text-muted-foreground">Unlock unlimited Coach + Crew plans</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
              <MapPin className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Location</p>
              <p className="text-xs text-muted-foreground">{prefs.locationLabel}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                Used for sunrise/sunset in your light plan.
              </p>
            </div>
          </div>
          <button
            onClick={detectLocation}
            className="rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold"
          >
            Detect
          </button>
        </div>
      </section>

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
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Partner mode</p>
              <p className="text-xs text-muted-foreground">
                Send your sleep windows so they know when to be quiet.
              </p>
            </div>
          </div>
          <input
            type="text"
            placeholder="Your name (shown on the share page)"
            value={prefs.partnerName}
            onChange={(e) => update("partnerName", e.target.value)}
            className="h-11 rounded-xl border border-border bg-input px-3 text-sm"
          />
          <Link
            to="/share"
            className="flex h-11 items-center justify-center rounded-xl bg-primary/15 text-sm font-semibold text-primary"
          >
            Generate share link
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-mint">
              <Heart className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Apple Health & Google Fit</p>
              <p className="text-xs text-muted-foreground">
                Sync actual sleep to compare against your plan.
              </p>
              <p className="mt-0.5 text-[10px] text-amber">
                Native app required — coming with iOS & Android wrappers.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-secondary px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Soon
          </span>
        </div>
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
          icon={<Activity className="h-5 w-5" />}
          label="Low-light interface"
          desc="Already on. Toggle off for brighter daytime use."
          checked={prefs.lowLight}
          onChange={(v) => update("lowLight", v)}
        />
      </section>

      <p className="text-[10px] leading-relaxed text-muted-foreground/70">{DISCLAIMER}</p>
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
