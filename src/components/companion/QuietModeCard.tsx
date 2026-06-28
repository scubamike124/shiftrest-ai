// Phase 5 — Compact Quiet Mode toggle card. Drop into any brief surface.

import { useEffect, useState } from "react";
import { MoonStar } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { loadQuietMode, setQuietMode, onQuietModeChange } from "@/lib/quiet-mode";
import { track } from "@/lib/companion/analytics";

export function QuietModeCard() {
  const [state, setState] = useState(() => loadQuietMode());

  useEffect(() => onQuietModeChange(setState), []);

  return (
    <Card className="flex items-center gap-3 p-3" aria-label="Quiet Mode">
      <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary" aria-hidden>
        <MoonStar className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold leading-tight">Quiet Mode</p>
        <p className="text-[11px] text-muted-foreground">
          {state.on
            ? "Companion voice muted, non-urgent nudges paused."
            : "Mute the Companion voice and pause non-urgent nudges."}
        </p>
      </div>
      <Switch
        checked={state.on}
        onCheckedChange={(v) => {
          const next = setQuietMode(v);
          setState(next);
          track({ event: "settings_changed", surface: "companion-settings-page" });
        }}
        aria-label="Toggle Quiet Mode"
      />
    </Card>
  );
}
