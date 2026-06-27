import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, Heart, Moon } from "lucide-react";
import { getWearableSummary } from "@/lib/wearables/wearables.functions";
import { PROVIDER_LABEL } from "@/lib/wearables/types";

function fmtDur(min: number | null): string {
  if (!min) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function LastNightStrip() {
  const fn = useServerFn(getWearableSummary);
  const { data } = useQuery({
    queryKey: ["wearable-summary"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  const r = data?.latest;
  if (!r) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Last night
        </p>
        <p className="text-[10px] text-muted-foreground">
          via {PROVIDER_LABEL[r.provider]} · {r.date}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-secondary/40 p-3">
          <Moon className="mb-1 h-4 w-4 text-primary" />
          <p className="text-base font-semibold">{fmtDur(r.sleepDurationMin)}</p>
          <p className="text-[10px] text-muted-foreground">
            {r.sleepEfficiency != null ? `${Math.round(r.sleepEfficiency * 100)}% efficient` : "sleep"}
          </p>
        </div>
        <div className="rounded-xl bg-secondary/40 p-3">
          <Activity className="mb-1 h-4 w-4 text-mint" />
          <p className="text-base font-semibold">
            {r.hrvMs != null ? `${Math.round(r.hrvMs)}` : "—"}
            <span className="ml-1 text-xs font-normal text-muted-foreground">ms</span>
          </p>
          <p className="text-[10px] text-muted-foreground">HRV</p>
        </div>
        <div className="rounded-xl bg-secondary/40 p-3">
          <Heart className="mb-1 h-4 w-4 text-amber" />
          <p className="text-base font-semibold">
            {r.restingHr ?? "—"}
            <span className="ml-1 text-xs font-normal text-muted-foreground">bpm</span>
          </p>
          <p className="text-[10px] text-muted-foreground">Resting HR</p>
        </div>
      </div>
    </section>
  );
}
