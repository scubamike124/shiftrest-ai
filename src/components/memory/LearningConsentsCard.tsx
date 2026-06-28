import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  LEARNING_CONSENT_KEYS,
  LEARNING_CONSENT_META,
  type LearningConsents,
  getLearningConsents,
  setLearningConsent,
  setAllLearningConsents,
} from "@/lib/memory/learning-consents";

type Props = { disabled?: boolean };

export function LearningConsentsCard({ disabled }: Props) {
  const [consents, setConsents] = useState<LearningConsents | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void getLearningConsents().then(setConsents);
  }, []);

  async function toggle(key: keyof LearningConsents, v: boolean) {
    setBusy(key);
    try {
      const next = await setLearningConsent(key, v);
      setConsents(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update");
    } finally {
      setBusy(null);
    }
  }

  async function setAll(value: boolean) {
    setBusy("__all__");
    try {
      const next = await setAllLearningConsents(value);
      setConsents(next);
      toast.success(value ? "Learning turned on for every category" : "Learning turned off everywhere");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> What I'm allowed to learn
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Each category is off by default. Turn on only what you want me to study —
            you can change this anytime.
          </p>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={Boolean(disabled) || busy === "__all__"} onClick={() => setAll(true)}>
          Enable all
        </Button>
        <Button size="sm" variant="ghost" disabled={Boolean(disabled) || busy === "__all__"} onClick={() => setAll(false)}>
          Disable all
        </Button>
      </div>

      <ul className="divide-y divide-border">
        {LEARNING_CONSENT_KEYS.map((key) => {
          const meta = LEARNING_CONSENT_META[key];
          const checked = Boolean(consents?.[key]);
          return (
            <li key={key} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{meta.label}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
              </div>
              <Switch
                checked={checked}
                disabled={Boolean(disabled) || consents === null || busy === key}
                onCheckedChange={(v) => toggle(key, v)}
                aria-label={`Allow learning ${meta.label}`}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
