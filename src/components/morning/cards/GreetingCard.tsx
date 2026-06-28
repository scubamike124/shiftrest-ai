import { Card } from "@/components/ui/card";
import type { MorningBriefDTO } from "@/lib/morning/types";

const HELLO: Record<MorningBriefDTO["greeting"]["hourBucket"], string> = {
  early: "Early start",
  morning: "Good morning",
  midday: "Good day",
};

export function GreetingCard({ dto }: { dto: MorningBriefDTO }) {
  const { greeting, memoryLine } = dto;
  const time = new Date(dto.generatedAtISO).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/8 via-card to-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{time}</p>
      <h2 className="mt-1 text-xl font-semibold leading-tight">
        {HELLO[greeting.hourBucket]}, {greeting.name}.
      </h2>
      {greeting.recommendation ? (
        <p className="mt-2 text-sm text-foreground/90">{greeting.recommendation}</p>
      ) : null}
      {memoryLine ? (
        <p className="mt-2 text-xs italic text-muted-foreground">{memoryLine}</p>
      ) : null}
    </Card>
  );
}
