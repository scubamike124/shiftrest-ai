// Slice 12 — Step 3. Traffic Intelligence alerts card.
// Read-only. No voice / push fired from this surface, so quiet hours are
// inherently respected. Mobile-first, a11y-clean (44px targets, live region).

import * as Icons from "lucide-react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { track } from "@/lib/companion/analytics";
import { useOnline } from "@/hooks/use-online";
import { isSkillsFlagOn } from "@/lib/companion/skills/registry";
import { getTrafficIntel } from "@/lib/traffic/traffic.functions";
import {
  alertsForPeriod,
  type TrafficAlert,
  type TrafficSeverity,
} from "@/lib/traffic/intel";

const severityClass: Record<TrafficSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/5",
  warn: "border-amber-500/40 bg-amber-500/5",
  info: "border-border/60 bg-card",
};

const severityIconClass: Record<TrafficSeverity, string> = {
  critical: "text-destructive",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-primary",
};

const severityLabel: Record<TrafficSeverity, string> = {
  critical: "Critical",
  warn: "Warning",
  info: "Heads-up",
};

function Lucide({ name, className }: { name: TrafficAlert["icon"]; className?: string }) {
  type LMap = Record<TrafficAlert["icon"], React.ComponentType<{ className?: string }>>;
  const map = Icons as unknown as LMap;
  const Cmp = map[name] ?? Icons.Car;
  return <Cmp className={className} aria-hidden />;
}

export function TrafficCard({
  period,
  signedIn,
}: {
  period: "morning" | "afternoon" | "evening";
  signedIn: boolean;
}) {
  const online = useOnline();
  const flagOn = typeof window !== "undefined" ? isSkillsFlagOn() : false;
  const fetch = useServerFn(getTrafficIntel);

  const q = useQuery({
    queryKey: ["traffic-intel", period],
    queryFn: () => fetch({ data: { period } }),
    enabled: signedIn && flagOn && online,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const alerts = q.data?.ok ? alertsForPeriod(q.data.alerts, period) : [];

  useEffect(() => {
    if (alerts.length > 0) {
      track({ event: "skill_invoked", skill: "travel", action: `card_${period}` });
    }
  }, [alerts.length, period]);

  if (!signedIn || !flagOn) return null;
  if (q.isLoading) return null;
  if (!q.data?.ok || alerts.length === 0) return null;

  const top = alerts[0];
  const rest = alerts.slice(1, 3);
  const destLabel = q.data.destination.label;

  return (
    <Card
      className={cn("p-4", severityClass[top.severity])}
      role="region"
      aria-live="polite"
      aria-label={`Traffic to ${destLabel}`}
      data-testid="traffic-card"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/60">
          <Lucide name={top.icon} className={cn("h-4 w-4", severityIconClass[top.severity])} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Traffic</p>
            <Badge variant="outline" className="text-[10px]">
              {severityLabel[top.severity]}
            </Badge>
            <span className="truncate text-[11px] text-muted-foreground">
              · to {destLabel} · {q.data.currentMin} min
              {q.data.baselineMin != null ? ` · normal ${q.data.baselineMin}` : ""}
            </span>
          </div>
          <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{top.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{top.suggestion}</p>
          {rest.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 border-t border-border/40 pt-2">
              {rest.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-xs">
                  <Lucide
                    name={a.icon}
                    className={cn("mt-[2px] h-3.5 w-3.5", severityIconClass[a.severity])}
                  />
                  <span className="text-foreground">
                    <span className="font-medium">{a.title}.</span>{" "}
                    <span className="text-muted-foreground">{a.suggestion}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Read-only · Reelo never starts navigation for you.
          </p>
        </div>
      </div>
    </Card>
  );
}
