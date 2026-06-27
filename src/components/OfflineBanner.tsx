/**
 * Offline banner — surfaces when navigator reports we're offline.
 *
 * UX contract: a single calm line at the top of the dashboard. We never
 * mock-claim "live"; if the saved snapshot is older than ~24h we say so,
 * because trusting a 3-day-old plan in a different time zone is worse
 * than admitting we don't know.
 */
import { useEffect, useState } from "react";
import { useOnline } from "@/hooks/use-online";
import { lsGet } from "@/lib/offline/cache";
import { CloudOff } from "lucide-react";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const m = Math.round(diff / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function OfflineBanner({ userId }: { userId: string | null | undefined }) {
  const online = useOnline();
  // Re-tick once a minute so the "5 min ago" stays honest without flooding renders.
  const [, force] = useState(0);
  useEffect(() => {
    if (online) return;
    const id = window.setInterval(() => force((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [online]);

  if (online) return null;

  const snap = lsGet<{ savedAt: number }>("snapshot:meta", userId);
  const savedAt = snap?.value?.savedAt ?? snap?.savedAt ?? null;
  const ageMs = savedAt ? Date.now() - savedAt : null;
  const stale = ageMs !== null && ageMs > 24 * 60 * 60 * 1000;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-3 flex items-start gap-3 rounded-2xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm"
    >
      <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
      <div className="flex flex-col">
        <span className="font-medium text-foreground">Offline mode active. Using your last saved plan.</span>
        <span className="text-xs text-muted-foreground">
          {savedAt
            ? `Saved ${timeAgo(savedAt)}. Smart Alarm and your wind-down reminders still work locally.`
            : "No saved plan yet — open this page once while connected so RestPilot can cache it."}
          {stale ? " Heads up: this plan is more than a day old." : ""}
        </span>
      </div>
    </div>
  );
}
