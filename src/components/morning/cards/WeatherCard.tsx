import * as Icons from "lucide-react";
import { Card } from "@/components/ui/card";

type IconName = "Sun" | "Cloud" | "CloudRain" | "CloudSnow" | "CloudLightning" | "CloudFog" | "CloudSun";

export function WeatherCard({
  weather,
}: {
  weather: { tempC: number; high: number; low: number; condition: string; icon: string };
}) {
  const Lucide = (Icons as unknown as Record<IconName, React.ComponentType<{ className?: string }>>)[
    weather.icon as IconName
  ] ?? Icons.Cloud;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lucide className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Weather</p>
          <p className="mt-0.5 text-base font-semibold">
            {Math.round(weather.tempC)}°
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {weather.condition} · {Math.round(weather.high)}° / {Math.round(weather.low)}°
            </span>
          </p>
        </div>
      </div>
    </Card>
  );
}
