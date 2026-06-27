import { useEffect, useState } from "react";
import { Sparkles, Brain } from "lucide-react";
import type { AssistantMode, Prefs } from "@/lib/prefs";
import { AIMemoryManager } from "./AIMemoryManager";

type Props = {
  prefs: Prefs;
  signedIn: boolean;
  onChange: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
};

const MODE_OPTIONS: { value: AssistantMode; label: string; desc: string }[] = [
  { value: "coach", label: "Coach", desc: "Direct, action-first guidance." },
  { value: "companion", label: "Companion", desc: "Warmer, asks follow-ups, references what you've shared." },
  { value: "minimal", label: "Minimal", desc: "Brief and terse. Answers what was asked, nothing more." },
];

export function AssistantSettings({ prefs, signedIn, onChange }: Props) {
  const [name, setName] = useState(prefs.assistantName);
  useEffect(() => setName(prefs.assistantName), [prefs.assistantName]);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Your AI assistant</h2>
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <label htmlFor="assistant-name" className="text-sm font-medium">
          Assistant name
        </label>
        <input
          id="assistant-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim() || "RestPilot";
            if (trimmed !== prefs.assistantName) onChange("assistantName", trimmed);
          }}
          maxLength={40}
          placeholder="RestPilot"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">
          What should the AI call itself? (e.g. “Luna”, “Coach”, “Pilot”.)
        </p>
      </div>

      {/* Mode */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Conversation style</p>
        <div className="grid gap-2">
          {MODE_OPTIONS.map((opt) => {
            const active = prefs.assistantMode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange("assistantMode", opt.value)}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <div className="font-semibold">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Memory */}
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-start gap-3">
          <Brain className="mt-0.5 h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Long-term memory</p>
              <button
                type="button"
                role="switch"
                aria-checked={prefs.memoryEnabled}
                disabled={!signedIn}
                onClick={() => onChange("memoryEnabled", !prefs.memoryEnabled)}
                className={`relative h-6 w-11 rounded-full transition disabled:opacity-50 ${
                  prefs.memoryEnabled ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-background transition ${
                    prefs.memoryEnabled ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Opt-in. When on, the coach quietly saves durable facts you share (schedule, habits, goals) and uses them in future replies. You can view, edit, pin, export, or wipe everything below. Off by default.
            </p>
          </div>
        </div>

        {signedIn ? (
          <AIMemoryManager enabled={prefs.memoryEnabled} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Sign in to enable long-term memory.
          </p>
        )}
      </div>
    </section>
  );
}
