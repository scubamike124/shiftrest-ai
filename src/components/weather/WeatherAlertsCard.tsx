// Slice 12 — Step 2. Weather Intelligence alerts card.
// Visual-only. No voice/push fired from this surface, so quiet-hours are
// automatically respected. Mobile-first, a11y-clean (44px targets, live region).

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
import { getWeatherIntel } from "@/lib/weather/weather.functions";
import {
  alertsForPeriod,
  type AlertSeverity,
  type WeatherAlert,
} from "@/lib/weather/intel";

const severityClass: Record<AlertSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/5",
  warn: "border-amber-500/40 bg-amber-500/5",
  info: "border-border/60 bg-card",
};

const severityIconClass: Record<AlertSeverity, string> = {
  critical: "text-destructive",
  warn: "text-amber-600 dark:text-amber-400",
  info: "text-primary",
};

const severityLabel: Record<AlertSeverity, string> = {
  critical: "Critical",
  warn: "Warning",
  info: "Heads-up",
};

function Lucide({ name, className }: { name: WeatherAlert["icon"]; className?: string }) {
  type LMap = Record<WeatherAlert["icon"], React.ComponentType<{ className?: string }>>;
  const map = Icons as unknown as LMap;
  const Cmp = map[name] ?? Icons.CloudSun;
  return <Cmp className={className} aria-hidden />;
}

export function WeatherAlertsCard({
  period,
  signedIn,
}: {
  period: "morning" | "afternoon" | "evening";
  signedIn: boolean;
}) {
  const online = useOnline();
  const flagOn = typeof window !== "undefined" ? isSkillsFlagOn() : false;
  const fetch = useServerFn(getWeatherIntel);

  const q = useQuery({
    queryKey: ["weather-intel"],
    queryFn: () => fetch(),
    enabled: signedIn && flagOn && online,
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const alerts = q.data?.ok ? alertsForPeriod(q.data.alerts, period) : [];

  useEffect(() => {
    if (alerts.length > 0) {
      track({ event: "skill_invoked", skill: "weather_alerts", action: `card_${period}` });
    }
  }, [alerts.length, period]);

  if (!signedIn || !flagOn) return null;
  if (q.isLoading) return null;
  if (!q.data?.ok || alerts.length === 0) return null;

  const top = alerts[0];
  const rest = alerts.slice(1, 3);

  return (
    <Card
      className={cn("p-4", severityClass[top.severity])}
      role="region"
      aria-live="polite"
      aria-label="Weather alerts"
      data-testid="weather-alerts-card"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background/60">
          <Lucide name={top.icon} className={cn("h-4 w-4", severityIconClass[top.severity])} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Weather</p>
            <Badge variant="outline" className="text-[10px]">
              {severityLabel[top.severity]}
            </Badge>
            {q.data.locationLabel ? (
              <span className="truncate text-[11px] text-muted-foreground">
                · {q.data.locationLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">{top.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{top.suggestion}</p>
          {rest.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 border-t border-border/40 pt-2">
              {rest.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-xs">
                  <Lucide name={a.icon} className={cn("mt-[2px] h-3.5 w-3.5", severityIconClass[a.severity])} />
                  <span className="text-foreground">
                    <span className="font-medium">{a.title}.</span>{" "}
                    <span className="text-muted-foreground">{a.suggestion}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
