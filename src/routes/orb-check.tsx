import { createFileRoute } from "@tanstack/react-router";
import { PilotOrb } from "@/components/PilotOrb";

export const Route = createFileRoute("/orb-check")({
  component: () => (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-background p-8">
      <div className="text-xs opacity-70">idle</div><PilotOrb state="idle" />
      <div className="text-xs opacity-70">listening</div><PilotOrb state="listening" level={0.2} />
      <div className="text-xs opacity-70">thinking</div><PilotOrb state="thinking" />
      <div className="text-xs opacity-70">speaking</div><PilotOrb state="speaking" />
    </div>
  ),
});
