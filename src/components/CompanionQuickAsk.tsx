// Slice 8 — "Ask Companion" quick prompt popover on the dashboard.
// Period-aware suggested prompts. Selecting one navigates to /companion?prompt=…
// which prefills the composer. No auto-send.

import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { currentBriefPeriod } from "@/lib/companion/brief-window";

const PROMPTS: Record<"morning" | "afternoon" | "evening", string[]> = {
  morning: [
    "How did I sleep?",
    "What's first on my calendar?",
    "Tell me about today's weather.",
  ],
  afternoon: [
    "How's my afternoon looking?",
    "Should I prep for tomorrow?",
    "Start rain sounds for 20 minutes.",
  ],
  evening: [
    "Prepare my evening wind-down.",
    "What's tomorrow look like?",
    "Set a smart alarm for 6:30.",
  ],
};

export function CompanionQuickAsk() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const period = useMemo(() => {
    try {
      return currentBriefPeriod();
    } catch {
      return "morning" as const;
    }
  }, []);
  const prompts = PROMPTS[period] ?? PROMPTS.morning;

  const send = (prompt: string) => {
    setOpen(false);
    navigate({
      to: "/companion",
      search: { prompt } as never,
    }).catch(() => undefined);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Ask Companion"
          className="mt-1 hidden min-h-11 min-w-11 items-center gap-1.5 rounded-full border border-primary/30 bg-background/60 px-3 text-xs font-medium text-foreground hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:inline-flex lg:h-12"
        >
          <MessageCircle className="h-3.5 w-3.5 text-primary" aria-hidden />
          Ask
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Try asking
        </p>
        <ul className="flex flex-col gap-1">
          {prompts.map((p) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => send(p)}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                {p}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-border/60 pt-1">
          <Button asChild variant="ghost" size="sm" className="w-full justify-start">
            <Link to="/companion">Open Companion →</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
