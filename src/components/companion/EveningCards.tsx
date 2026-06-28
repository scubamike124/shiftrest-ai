// Slice 7 — Evening Brief card components. Hide-on-empty throughout.

import { Calendar, Cloud, Shirt, AlarmClock, MoonStar, ListChecks, Plane, Sparkles, Wind } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { EveningBriefDTO } from "@/lib/companion/types";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtDayTime(iso: string) {
  return new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function TomorrowFirstCard({ first }: { first: EveningBriefDTO["tomorrowFirst"] }) {
  if (!first) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Calendar className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Tomorrow starts with</p>
          <p className="mt-0.5 text-sm font-semibold">{first.title}</p>
          <p className="text-xs text-muted-foreground">{fmtDayTime(first.atISO)}</p>
        </div>
      </div>
    </Card>
  );
}

export function TomorrowWeatherCard({ weather }: { weather: EveningBriefDTO["tomorrowWeather"] }) {
  if (!weather) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Cloud className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Tomorrow morning</p>
          <p className="mt-0.5 text-sm">
            {weather.morningTempC != null ? `${Math.round(weather.morningTempC)}° at 8 AM · ` : ""}
            {weather.condition}, {Math.round(weather.high)}° / {Math.round(weather.low)}°
            {weather.precipProbabilityMax >= 30
              ? ` · ${Math.round(weather.precipProbabilityMax)}% rain`
              : ""}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function ClothingCard({ clothing }: { clothing: EveningBriefDTO["clothing"] }) {
  if (!clothing) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Shirt className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">What to wear</p>
          <p className="mt-0.5 text-sm">{clothing.hint}</p>
        </div>
      </div>
    </Card>
  );
}

export function SmartAlarmCard({ alarm }: { alarm: EveningBriefDTO["smartAlarm"] }) {
  if (!alarm) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <AlarmClock className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Smart alarm</p>
          <p className="mt-0.5 text-sm">
            Wake by{" "}
            <span className="font-semibold">{fmtTime(alarm.suggestedWakeISO)}</span> · target{" "}
            {alarm.targetHours}h sleep
          </p>
        </div>
      </div>
    </Card>
  );
}

export function BedtimeCard({ alarm }: { alarm: EveningBriefDTO["smartAlarm"] }) {
  if (!alarm) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <MoonStar className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Suggested bedtime</p>
          <p className="mt-0.5 text-sm font-semibold">{fmtTime(alarm.suggestedBedtimeISO)}</p>
        </div>
      </div>
    </Card>
  );
}

export function PrepCard({ prep }: { prep: EveningBriefDTO["prep"] }) {
  if (!prep) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <ListChecks className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Prep for tomorrow</p>
          <p className="mt-0.5 text-sm">
            {prep.count} item{prep.count === 1 ? "" : "s"} on your calendar — start with{" "}
            <span className="font-medium">{prep.firstTitle}</span>.
          </p>
        </div>
      </div>
    </Card>
  );
}

export function TravelCard({ travel }: { travel: EveningBriefDTO["travel"] }) {
  if (!travel) return null;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Plane className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Upcoming trip</p>
          <p className="mt-0.5 text-sm">
            {travel.destLabel ? `${travel.destLabel} · ` : ""}
            depart {fmtDayTime(travel.departISO)}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function SummaryCard({ summary }: { summary: string | null }) {
  if (!summary) return null;
  return (
    <Card className="border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 text-primary" />
        <p className="text-sm text-foreground/90">{summary}</p>
      </div>
    </Card>
  );
}

export function WindDownCard({ minutes }: { minutes: number }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Wind className="mt-0.5 h-4 w-4 text-primary" />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Wind down</p>
          <p className="mt-0.5 text-sm">
            Begin your wind-down about {minutes} minutes before bed for the best rest.
          </p>
        </div>
      </div>
    </Card>
  );
}
