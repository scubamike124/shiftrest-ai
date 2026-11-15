// Apple Health connection, shown only inside the RestPilot iPhone app.
// Read-only; data stays on the phone; Disconnect deletes the stored copy.

import { useState } from "react";
import { HeartPulse } from "lucide-react";
import { toast } from "sonner";
import { useAppleHealth } from "@/hooks/use-apple-health";
import {
  clearAppleHealth,
  connectAppleHealth,
  refreshAppleHealth,
} from "@/lib/health/apple-health-store";
import { lastNightFrom } from "@/lib/health/apple-health";

function fmtDur(min: number): string {
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "not yet";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function AppleHealthCard() {
  const { available, userId, state } = useAppleHealth();
  const [busy, setBusy] = useState(false);
  if (!available) return null; // web and older app builds: the feature is hidden

  const last = state ? lastNightFrom(state.nights, new Date()) : null;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Apple Health is not responding. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-border bg-card"
      aria-labelledby="apple-health-title"
    >
      <div className="flex items-start gap-3 p-4">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"
          aria-hidden="true"
        >
          <HeartPulse className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="apple-health-title" className="text-base font-semibold">
            Apple Health
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {state
              ? `Connected. Last read ${fmtAgo(state.lastReadAt)}.`
              : "Use your real sleep, heart rate variability and resting heart rate to tune your plan."}
          </p>
        </div>
      </div>

      {state && (
        <div className="mx-4 mb-3 rounded-xl bg-secondary/40 p-3 text-sm" aria-live="polite">
          {last ? (
            <>
              <p className="font-semibold">
                Last night: {fmtDur(last.sleepDurationMin)} asleep
                {last.sleepEfficiency != null
                  ? `, ${Math.round(last.sleepEfficiency * 100)}% of time in bed`
                  : ""}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {last.hrvMs != null ? `HRV ${Math.round(last.hrvMs)} ms (SDNN)` : "No HRV reading"}
                {" · "}
                {last.restingHr != null
                  ? `resting heart rate ${last.restingHr} bpm`
                  : "no resting heart rate"}
              </p>
              <p className="mt-1 text-xs font-medium text-indigo-glow">
                Measured · from Apple Health
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              No sleep from the last two nights in Apple Health. If you chose not to share it, you
              can allow it in Settings → Health → Data Access &amp; Devices → RestPilot.
            </p>
          )}
        </div>
      )}

      <p className="px-4 pb-3 text-xs text-muted-foreground">
        Read-only. Stays on this iPhone: it is not sent to RestPilot&apos;s servers or the AI coach.
      </p>

      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {!userId ? (
          <p className="text-sm text-muted-foreground">Sign in to connect Apple Health.</p>
        ) : !state ? (
          <button
            type="button"
            disabled={busy || !userId}
            onClick={() =>
              userId && run(() => connectAppleHealth(userId), "Apple Health connected.")
            }
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Connect Apple Health
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || !userId}
              onClick={() =>
                userId && run(() => refreshAppleHealth(userId), "Updated from Apple Health.")
              }
              className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                clearAppleHealth();
                toast.success(
                  "Disconnected. RestPilot stopped reading Apple Health and deleted its copy on this iPhone. To remove the permission too: Settings → Health → Data Access & Devices → RestPilot.",
                  { duration: 9000 },
                );
              }}
              className="min-h-11 rounded-lg border border-border px-4 text-sm font-semibold text-destructive disabled:opacity-50"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </section>
  );
}
