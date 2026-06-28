import { Calendar } from "lucide-react";
import { Card } from "@/components/ui/card";

export function LongClockCard({
  items,
}: {
  items: { id: string; title: string; atISO: string; kind: string }[];
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary" />
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Today</p>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {items.map((it) => {
          const t = new Date(it.atISO).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          });
          return (
            <li key={it.id} className="flex items-baseline gap-2">
              <span className="w-14 shrink-0 text-xs tabular-nums text-muted-foreground">{t}</span>
              <span className="min-w-0 truncate text-foreground">{it.title}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
