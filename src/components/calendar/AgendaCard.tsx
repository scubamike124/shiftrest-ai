// Slice 12 — Step 4. Calendar Intelligence agenda card.
// Read-only. No voice / push fired from this surface, so quiet hours are
// inherently respected. Mobile-first, a11y-clean (44px targets, live region).

import { useEffect, useMemo } from "react";
import { Calendar, Clock, AlertTriangle, MapPin, Repeat } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { track } from "@/lib/companion/analytics";
import { useOnline } from "@/hooks/use-online";
import { isSkillsFlagOn } from "@/lib/companion/skills/registry";
import { getCalendarAgenda } from "@/lib/calendar/calendar.functions";

const PERIOD_HEADING: Record<"morning" | "afternoon" | "evening", string> = {
  morning: "Today's agenda",
  afternoon: "Coming up",
  evening: "Tomorrow's preview",
};

export function AgendaCard({
  period,
  signedIn,
}: {
  period: "morning" | "afternoon" | "evening";
  signedIn: boolean;
}) {
  const online = useOnline();
  const flagOn = typeof window !== "undefined" ? isSkillsFlagOn() : false;
  const fetch = useServerFn(getCalendarAgenda);

  const q = useQuery({
    queryKey: ["calendar-agenda", period],
    queryFn: () => fetch({ data: { period } }),
    enabled: signedIn && flagOn && online,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const ok = q.data?.ok === true ? q.data : null;
  const items = useMemo(() => ok?.agenda.items ?? [], [ok]);

  useEffect(() => {
    if (items.length > 0) {
      track({ event: "skill_invoked", skill: "calendar_read", action: `card_${period}` });
    }
  }, [items.length, period]);

  if (!signedIn || !flagOn) return null;
  if (q.isLoading) return null;
  if (!ok) return null;
  if (items.length === 0 && !ok.agenda.earlyMeeting && !ok.leaveEarlier) return null;

  return (
    <Card
      className="p-4"
      role="region"
      aria-live="polite"
      aria-label={PERIOD_HEADING[period]}
      data-testid="agenda-card"
    >
      <div className="mb-2 flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary" aria-hidden />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {PERIOD_HEADING[period]}
        </p>
      </div>

      {ok.agenda.earlyMeeting && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              Early start tomorrow
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {timeString(ok.agenda.earlyMeeting.startISO)} · {ok.agenda.earlyMeeting.title}
              {ok.bedtimeShiftMin > 0 && (
                <> — consider winding down {ok.bedtimeShiftMin} minutes earlier.</>
              )}
            </p>
          </div>
        </div>
      )}

      {ok.leaveEarlier && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2.5">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p className="text-[11px] leading-relaxed text-foreground">
            {ok.leaveEarlier.suggestion}
          </p>
        </div>
      )}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {items.map((it) => (
            <li key={`${it.uid}-${it.startISO}`} className="flex items-baseline gap-2">
              <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">
                {it.allDay ? "All day" : timeString(it.startISO)}
              </span>
              <span className="min-w-0 flex-1 text-foreground">
                <span className="block truncate">
                  {it.title}
                  {it.recurring && (
                    <Repeat className="ml-1 inline h-3 w-3 text-muted-foreground" aria-label="Recurring" />
                  )}
                </span>
                {it.location && (
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <MapPin className="h-3 w-3" aria-hidden />
                    <span className="truncate">{it.location}</span>
                  </span>
                )}
              </span>
              {items.length > 1 && (
                <Badge variant="outline" className="text-[10px] hidden xs:inline-flex">
                  {it.source}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing scheduled.</p>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground">
        Read-only · Reelo can't add, move, or delete events.
      </p>
    </Card>
  );
}

function timeString(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
