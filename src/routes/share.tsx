import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Moon, ChevronLeft } from "lucide-react";
import { DAYS, fmt, fetchShifts, endAbsolute, type Shift } from "@/lib/shifts";
import { DEFAULT_PREFS, fetchPrefs, type Prefs } from "@/lib/prefs";
import { toast } from "sonner";

export const Route = createFileRoute("/share")({
  head: () => ({
    meta: [
      { title: "Partner Mode — ShiftRest AI" },
      {
        name: "description",
        content:
          "Share a read-only view of your sleep windows so your partner or roommate knows when you're recovering.",
      },
    ],
  }),
  component: SharePage,
});

type Payload = { name: string; shifts: Shift[]; sleepHours: number; windDownMin: number };

function encode(p: Payload): string {
  const json = JSON.stringify(p);
  if (typeof window === "undefined") return "";
  return btoa(unescape(encodeURIComponent(json)));
}
function decode(s: string): Payload | null {
  try {
    const json = decodeURIComponent(escape(atob(s)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function SharePage() {
  const [hashPayload, setHashPayload] = useState<Payload | null>(null);
  const [hashChecked, setHashChecked] = useState(false);
  const { data: shifts } = useQuery({
    queryKey: ["shifts"],
    queryFn: fetchShifts,
    enabled: hashChecked && !hashPayload,
  });
  const prefs = useMemo<Prefs>(() => loadPrefs(), []);
  const mine = !hashPayload && shifts ? { shifts, prefs } : null;

  useEffect(() => {
    const h = window.location.hash.replace(/^#p=/, "");
    if (h) setHashPayload(decode(h));
    setHashChecked(true);
  }, []);

  const link = useMemo(() => {
    if (!mine) return "";
    const payload: Payload = {
      name: mine.prefs.partnerName || "Your partner",
      shifts: mine.shifts,
      sleepHours: mine.prefs.sleepHours,
      windDownMin: mine.prefs.windDownMin,
    };
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/share#p=${encode(payload)}`;
  }, [mine]);

  if (hashPayload) {
    return <PartnerView payload={hashPayload} />;
  }

  if (!mine) return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed — long-press to copy");
    }
  }

  async function nativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "My ShiftRest sleep windows",
          text: "Heads up — these are my recovery windows this week.",
          url: link,
        });
      } catch {
        /* user cancelled */
      }
    } else {
      copyLink();
    }
  }

  return (
    <main className="flex flex-col gap-5 px-5 pt-12">
      <Link to="/plan" className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to Plan
      </Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Partner Mode
        </p>
        <h1 className="mt-2 text-3xl font-bold leading-tight">
          So nobody vacuums during your sleep.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send a read-only view of your sleep windows. No account needed on their end.
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Your link</p>
        <p className="mt-2 break-all rounded-xl bg-secondary p-3 text-xs text-foreground">
          {link}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={nativeShare}
            className="h-12 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground active:scale-[0.99]"
          >
            Share
          </button>
          <button
            onClick={copyLink}
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card"
            aria-label="Copy link"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        The link encodes your schedule directly — no data is uploaded. Anyone with the
        link can see your sleep windows, so share thoughtfully.
      </p>
    </main>
  );
}

function PartnerView({ payload }: { payload: Payload }) {
  return (
    <main className="flex min-h-screen flex-col gap-5 px-5 pt-12 pb-12">
      <header className="text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary shadow-[var(--shadow-glow)]">
          <Moon className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-2xl font-bold">{payload.name}'s sleep windows</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quiet hours this week. Read-only — shared via ShiftRest AI.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        {DAYS.map((d, i) => {
          const s = payload.shifts.find((x) => x.day === i);
          if (!s) {
            return (
              <div
                key={d}
                className="flex items-center justify-between rounded-2xl border border-border bg-card p-3 opacity-60"
              >
                <span className="text-sm font-semibold">{d}</span>
                <span className="text-xs text-muted-foreground">Off — normal hours</span>
              </div>
            );
          }
          const endAbs = endAbsolute(s);
          const sleepStart = endAbs + payload.windDownMin;
          const sleepEnd = sleepStart + payload.sleepHours * 60;
          return (
            <div key={d} className="rounded-2xl border border-primary/30 bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{d}</span>
                <span className="text-xs text-muted-foreground">
                  Shift {fmt(s.start)}–{fmt(s.end)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <Moon className="h-3.5 w-3.5 text-primary" />
                <span className="font-semibold text-primary">
                  Quiet: {fmt(sleepStart)} – {fmt(sleepEnd)}
                </span>
              </div>
            </div>
          );
        })}
      </section>

      <a
        href="/"
        className="mx-auto mt-2 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
      >
        Powered by ShiftRest AI
      </a>
    </main>
  );
}
