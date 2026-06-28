import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";

export function MotivationCard({ text, author }: { text: string; author?: string }) {
  return (
    <Card className="border-border/60 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm italic text-foreground/90">"{text}"</p>
          {author ? <p className="mt-1 text-xs text-muted-foreground">— {author}</p> : null}
        </div>
      </div>
    </Card>
  );
}
