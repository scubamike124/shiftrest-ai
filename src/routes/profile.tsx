import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { deleteAccountFn } from "@/lib/account.functions";
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
  Shield,
  FileText,
  Trash2,
  LogIn,
  LogOut,
} from "lucide-react";
import { DISCLAIMER } from "@/lib/shifts";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_PREFS,
  clearPrefsMigrationFlag,
  fetchPrefs,
  savePrefs,
  type Prefs,
} from "@/lib/prefs";
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
  const queryClient = useQueryClient();
  const { data: prefs = DEFAULT_PREFS } = useQuery({
    queryKey: ["prefs"],
    queryFn: fetchPrefs,
    initialData: DEFAULT_PREFS,
  });
  const [perm, setPerm] = useState<NotifyPermission>("default");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // Local draft for the partner-name text input so we don't write on every keystroke.
  const [partnerDraft, setPartnerDraft] = useState(prefs.partnerName);
  useEffect(() => setPartnerDraft(prefs.partnerName), [prefs.partnerName]);

  const mutation = useMutation({
    mutationFn: (partial: Partial<Prefs>) => savePrefs(partial),
    onMutate: async (partial) => {
      await queryClient.cancelQueries({ queryKey: ["prefs"] });
      const prev = queryClient.getQueryData<Prefs>(["prefs"]);
      queryClient.setQueryData<Prefs>(["prefs"], { ...(prev ?? DEFAULT_PREFS), ...partial });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["prefs"], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["prefs"] }),
  });

  useEffect(() => {
    setPerm(getPermission());
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    toast.success("Signed out.");
  }

  function update<K extends keyof Prefs>(k: K, v: Prefs[K]) {
    mutation.mutate({ [k]: v } as Partial<Prefs>);
    if (k === "notifications" || k === "windDownMin") {
      // Re-schedule after the mutation settles — fetchPrefs in the scheduler will see the new value.
      setTimeout(() => scheduleNextWindDown(), 300);
    }
  }

  async function enableNotifs() {
    const res = await requestPermission();
    setPerm(res);
    if (res === "granted") {
      update("notifications", true);
      scheduleNextWindDown();
      const next = await nextWindDownAt();
      toast.success(
        next
          ? `Notifications on. Next ping ${next.at.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
          : "Notifications on. Add a shift to schedule pings.",
      );
    } else if (res === "denied") {
      toast.error("Permission denied — enable in browser settings.");
    } else if (res === "unsupported") {
      toast.error("This browser doesn't support notifications.");
    }
  }

  function testNotif() {
    if (getPermission() !== "granted") {
      toast.error("Enable notifications first.");
      return;
    }
    showNotification("ShiftRest test 🌙", "Your wind-down pings will look like this.");
  }

  function detectLocation() {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not supported");
      return;
    }
    toast.info("Detecting location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mutation.mutate({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          locationLabel: `${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`,
        });
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
            <p className="text-xs text-muted-foreground">Unlock the full AI Sleep Coach</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </Link>

      <section className="rounded-2xl border border-border bg-card p-4">
        {userEmail ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
                <LogOut className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Signed in</p>
                <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold"
            >
              Sign out
            </button>
          </div>
        ) : (
          <Link to="/auth" className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <LogIn className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">Sign in or create account</p>
                <p className="text-xs text-muted-foreground">Sync your shifts across devices</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </Link>
        )}
      </section>

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
            value={partnerDraft}
            onChange={(e) => setPartnerDraft(e.target.value)}
            onBlur={() => {
              if (partnerDraft !== prefs.partnerName) update("partnerName", partnerDraft);
            }}
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
        <div className="flex gap-2 px-4 pb-4">
          {perm !== "granted" ? (
            <button
              onClick={enableNotifs}
              className="h-10 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
            >
              {perm === "unsupported" ? "Not supported" : "Enable browser notifications"}
            </button>
          ) : (
            <>
              <span className="flex h-10 flex-1 items-center justify-center rounded-xl bg-mint/15 text-xs font-semibold text-mint">
                Permission granted
              </span>
              <button
                onClick={testNotif}
                className="h-10 rounded-xl bg-secondary px-4 text-sm font-semibold"
              >
                Test
              </button>
            </>
          )}
        </div>
        <Divider />
        <ToggleRow
          icon={<Activity className="h-5 w-5" />}
          label="Low-light interface"
          desc="Already on. Toggle off for brighter daytime use."
          checked={prefs.lowLight}
          onChange={(v) => update("lowLight", v)}
        />
      </section>

      <section className="rounded-2xl border border-border bg-card">
        <Link
          to="/privacy"
          className="flex items-center justify-between p-4"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
              <Shield className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">Privacy Policy</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
        <Divider />
        <Link
          to="/terms"
          className="flex items-center justify-between p-4"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
              <FileText className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">Terms of Service</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
        <Divider />
        <button
          onClick={() => {
            const ok = window.confirm(
              "Delete your account?\n\nThis permanently removes your shifts, preferences, and all data within 30 days. This cannot be undone.",
            );
            if (!ok) return;
            const sure = window.confirm(
              "Are you absolutely sure? Type OK in the next prompt to confirm.",
            );
            if (!sure) return;
            const code = window.prompt('Type "DELETE" to confirm:');
            if (code !== "DELETE") {
              toast.error("Account not deleted.");
              return;
            }
            try {
              localStorage.clear();
              clearPrefsMigrationFlag();
            } catch {}
            toast.success("Account deletion requested. All data will be removed within 30 days.");
            window.location.href = "/";
          }}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
              <Trash2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-destructive">Delete account</p>
              <p className="text-xs text-muted-foreground">
                Permanently remove your data within 30 days.
              </p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </button>
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
