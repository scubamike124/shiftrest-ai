import { Moon } from "lucide-react";
import { Card } from "@/components/ui/card";

export function SleepCard({
  sleep,
}: {
  sleep: { durationMin: number; score: number; source: "wearable" | "manual" };
}) {
  const h = Math.floor(sleep.durationMin / 60);
  const m = sleep.durationMin % 60;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Moon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Last night</p>
          <p className="mt-0.5 text-base font-semibold">
            {h}h {m}m
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              score {sleep.score}
            </span>
          </p>
        </div>
      </div>
    </Card>
  );
}
