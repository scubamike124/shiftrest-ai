import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, Heart, Moon } from "lucide-react";
import { getWearableSummary } from "@/lib/wearables/wearables.functions";
import { PROVIDER_LABEL } from "@/lib/wearables/types";
import type { AppleHealthNight } from "@/lib/health/apple-health";

function fmtDur(min: number | null): string {
  if (!min) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** `appleHealth`: last night from Apple Health (iPhone app), shown instead of a server wearable. */
export function LastNightStrip({ appleHealth = null }: { appleHealth?: AppleHealthNight | null } = {}) {
  const fn = useServerFn(getWearableSummary);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    import("@/integrations/supabase/client").then(({ supabase }) =>
      supabase.auth.getSession().then(({ data }) => {
        if (active) setSignedIn(!!data.session);
      }),
    );
    return () => {
      active = false;
    };
  }, []);
  const { data } = useQuery({
    queryKey: ["wearable-summary"],
    queryFn: () => fn(),
    staleTime: 60_000,
    enabled: signedIn === true,
  });
  const r = appleHealth ?? data?.latest;
  if (!r) return null;
  const fromAppleHealth = r.provider === "apple-health";

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Last night
        </p>
        <p className="text-[10px] text-muted-foreground">
          {fromAppleHealth ? "Measured · from Apple Health" : `via ${PROVIDER_LABEL[r.provider]}`} · {r.date}
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
          <p className="text-[10px] text-muted-foreground">{fromAppleHealth ? "HRV (SDNN)" : "HRV"}</p>
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
