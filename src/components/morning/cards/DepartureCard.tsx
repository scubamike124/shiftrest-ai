import { Car } from "lucide-react";
import { Card } from "@/components/ui/card";

export function DepartureCard({
  departure,
}: {
  departure: { leaveByISO: string; firstEventISO: string; firstEventTitle: string; baselineMin: number };
}) {
  const leave = new Date(departure.leaveByISO).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const evt = new Date(departure.firstEventISO).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Car className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Leave by</p>
          <p className="mt-0.5 text-base font-semibold">{leave}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {departure.firstEventTitle} · {evt} · ~{departure.baselineMin} min drive
          </p>
        </div>
      </div>
    </Card>
  );
}
