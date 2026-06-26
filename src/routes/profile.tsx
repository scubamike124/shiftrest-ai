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
import {
  fetchEmployers,
  addEmployer,
  updateEmployer,
  deleteEmployer,
  EMPLOYER_COLORS,
  type Employer,
} from "@/lib/employers";
import { Briefcase, Plus as PlusIcon, Star } from "lucide-react";
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
      { title: "Profile & Preferences — RestPilot AI" },
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
  const navigate = useNavigate();
  const deleteAccount = useServerFn(deleteAccountFn);
  const [deleting, setDeleting] = useState(false);
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
  const [cityDraft, setCityDraft] = useState("");
  const [geocoding, setGeocoding] = useState(false);

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
    showNotification("RestPilot test 🌙", "Your wind-down pings will look like this.");
  }

  async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
    try {
      const r = await fetch(
        `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&count=1&language=en&format=json`,
      );
      const j = await r.json();
      const hit = j?.results?.[0];
      if (!hit) return null;
      const region = hit.admin1 ?? hit.country_code ?? hit.country;
      return region ? `${hit.name}, ${region}` : hit.name;
    } catch {
      return null;
    }
  }

  async function geocodeCity(name: string): Promise<{ lat: number; lon: number; label: string } | null> {
    try {
      const r = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`,
      );
      const j = await r.json();
      const hit = j?.results?.[0];
      if (!hit) return null;
      const region = hit.admin1 ?? hit.country;
      return {
        lat: hit.latitude,
        lon: hit.longitude,
        label: region ? `${hit.name}, ${region}` : hit.name,
      };
    } catch {
      return null;
    }
  }

  function detectLocation() {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation not supported — enter your city below.");
      return;
    }
    toast.info("Detecting location…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const label =
          (await reverseGeocode(lat, lon)) ?? `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        mutation.mutate({ lat, lon, locationLabel: label });
        toast.success(`Location set to ${label}`);
      },
      () => toast.error("Couldn't detect — enter your city below."),
    );
  }

  async function saveCity() {
    const q = cityDraft.trim();
    if (!q) return;
    setGeocoding(true);
    try {
      const hit = await geocodeCity(q);
      if (!hit) {
        toast.error("City not found — try a nearby larger city.");
        return;
      }
      mutation.mutate({ lat: hit.lat, lon: hit.lon, locationLabel: hit.label });
      setCityDraft("");
      toast.success(`Location set to ${hit.label}`);
    } finally {
      setGeocoding(false);
    }
  }


  return (
    <main className="flex flex-col gap-6 px-5 pt-12">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Profile
        </p>
        <h1 className="mt-2 text-3xl font-bold">Your preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fine-tune how RestPilot plans your recovery windows.
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
              Sign Out
            </button>
          </div>
        ) : (
          <Link to="/auth" className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <LogIn className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold">Sign In or create account</p>
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
              <p className="text-xs text-muted-foreground">
                {prefs.locationLabel || "Not set"}
              </p>
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
        <div className="flex gap-2 px-4 pb-4">
          <input
            type="text"
            placeholder="Or type a city (e.g. Austin, TX)"
            value={cityDraft}
            onChange={(e) => setCityDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveCity();
              }
            }}
            className="h-10 flex-1 rounded-xl border border-border bg-input px-3 text-sm"
          />
          <button
            onClick={saveCity}
            disabled={geocoding || !cityDraft.trim()}
            className="rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {geocoding ? "…" : "Save"}
          </button>
        </div>
      </section>

      <EmployersSection />


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
              <p className="text-sm font-semibold">Wearable & health sync</p>
              <p className="text-xs text-muted-foreground">
                Sync actual sleep to compare against your plan.
              </p>
              <p className="mt-0.5 text-[10px] text-amber">
                Coming soon — connect your watch and sleep tracker.
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
              disabled={perm === "unsupported"}
              className="h-10 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {perm === "unsupported"
                ? "Not available in this browser — try Chrome on desktop"
                : "Enable browser notifications"}
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
          disabled={deleting}
          onClick={async () => {
            const ok = window.confirm(
              "Delete your account?\n\nThis permanently and immediately removes your account, shifts, preferences, and coach history. This cannot be undone.",
            );
            if (!ok) return;
            const sure = window.confirm("Are you absolutely sure? This is final.");
            if (!sure) return;
            const code = window.prompt('Type "DELETE" to confirm:');
            if (code !== "DELETE") {
              toast.error("Account not deleted.");
              return;
            }
            setDeleting(true);
            try {
              await deleteAccount({ data: undefined });
              await queryClient.cancelQueries();
              queryClient.clear();
              await supabase.auth.signOut();
              try {
                localStorage.clear();
                clearPrefsMigrationFlag();
              } catch {}
              toast.success("Account deleted.");
              navigate({ to: "/auth", replace: true });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "We couldn't delete your account. Please try again.");
              setDeleting(false);
            }
          }}
          className="flex w-full items-center justify-between p-4 text-left disabled:opacity-60"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
              <Trash2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-destructive">
                {deleting ? "Deleting…" : "Delete Account"}
              </p>
              <p className="text-xs text-muted-foreground">
                Permanently and immediately remove your account and data.
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

function EmployersSection() {
  const queryClient = useQueryClient();
  const { data: employers = [] } = useQuery({
    queryKey: ["employers"],
    queryFn: fetchEmployers,
  });
  const [editing, setEditing] = useState<Employer | "new" | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["employers"] });
    queryClient.invalidateQueries({ queryKey: ["shifts"] });
  };

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
            <Briefcase className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Employers</p>
            <p className="text-xs text-muted-foreground">
              {employers.length === 0
                ? "Add your first employer"
                : `${employers.length} employer${employers.length === 1 ? "" : "s"} · used for color coding and AI context`}
            </p>
          </div>
        </div>
        <button
          onClick={() => setEditing("new")}
          aria-label="Add employer"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
      {employers.length > 0 && (
        <div className="flex flex-col gap-2 px-4 pb-4">
          {employers.map((e) => (
            <button
              key={e.id}
              onClick={() => setEditing(e)}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 p-3 text-left active:scale-[0.99]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="h-8 w-8 shrink-0 rounded-lg"
                  style={{ background: e.color }}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{e.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {e.isDefault ? "Default employer" : "Tap to edit"}
                  </p>
                </div>
              </div>
              {e.isDefault && <Star className="h-4 w-4 text-amber" fill="currentColor" />}
            </button>
          ))}
        </div>
      )}

      {editing && (
        <EmployerEditor
          employer={editing === "new" ? null : editing}
          existingCount={employers.length}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            if (editing === "new") {
              await addEmployer(patch);
            } else {
              await updateEmployer(editing.id, patch);
            }
            invalidate();
            setEditing(null);
          }}
          onDelete={
            editing !== "new" && employers.length > 1
              ? async () => {
                  await deleteEmployer(editing.id);
                  invalidate();
                  setEditing(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

function EmployerEditor({
  employer,
  existingCount,
  onClose,
  onSave,
  onDelete,
}: {
  employer: Employer | null;
  existingCount: number;
  onClose: () => void;
  onSave: (patch: { name: string; color: string; isDefault: boolean }) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [name, setName] = useState(employer?.name ?? "");
  const [color, setColor] = useState(
    employer?.color ?? EMPLOYER_COLORS[existingCount % EMPLOYER_COLORS.length],
  );
  const [isDefault, setIsDefault] = useState(employer?.isDefault ?? existingCount === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-t-3xl border border-border bg-card p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] max-h-[90vh] overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-bold">
            {employer ? "Edit employer" : "Add employer"}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-sm"
          >
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Employer name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Hospital, Amazon, Fire Dept…"
            className="h-12 rounded-xl border border-border bg-input px-3 text-base font-medium outline-none focus:border-primary"
          />
        </label>

        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Color</p>
          <div className="flex flex-wrap gap-2">
            {EMPLOYER_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Pick ${c}`}
                className={`h-9 w-9 rounded-xl border-2 transition ${
                  color === c ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        <label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl bg-secondary/50 p-3">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber" />
            <span className="text-sm font-semibold">Default employer</span>
          </div>
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-5 w-5 accent-[var(--primary)]"
          />
        </label>

        <button
          onClick={() => onSave({ name: name.trim(), color, isDefault })}
          disabled={!name.trim()}
          className="mt-5 h-14 w-full rounded-2xl text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-[0.99] disabled:opacity-50"
          style={{ background: "var(--gradient-cta)" }}
        >
          Save employer
        </button>

        {onDelete && (
          <button
            onClick={() => {
              if (window.confirm(`Delete "${employer?.name}"? Shifts at this employer will lose their tag but remain on your schedule.`)) {
                onDelete();
              }
            }}
            className="mt-3 h-12 w-full rounded-2xl bg-destructive/15 text-sm font-semibold text-destructive"
          >
            Delete employer
          </button>
        )}
      </div>
    </div>
  );
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
