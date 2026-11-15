// Profile → Privacy: review and withdraw the permission to share personal
// data with third-party AI providers (App Store Review Guideline 5.1.2(i)).

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, FileText, Shield, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { requireSession } from "@/lib/require-session";
import { Switch } from "@/components/ui/switch";
import { AIConsentProviderList } from "@/components/ai/AIConsentDialog";
import { loadAIConsent, setAIConsent, useAIConsent } from "@/lib/ai/consent-client";

export const Route = createFileRoute("/settings/privacy")({
  ssr: false,
  beforeLoad: requireSession,
  head: () => ({
    meta: [
      { title: "Privacy | RestPilot AI" },
      {
        name: "description",
        content: "Choose whether RestPilot may share your data with its AI providers.",
      },
    ],
  }),
  component: PrivacySettings,
});

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

function PrivacySettings() {
  const consent = useAIConsent();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadAIConsent(true);
  }, []);

  const loaded = consent.status === "granted" || consent.status === "denied";
  const granted = consent.status === "granted";
  const since = formatWhen(consent.grantedAt);

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      await setAIConsent(next, "settings");
      toast.success(
        next
          ? "AI features are on."
          : "AI features are off. RestPilot will no longer send your data to its AI providers.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your choice. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 pt-6 pb-10">
      <div className="flex items-center gap-3">
        <Link
          to="/profile"
          aria-label="Back to Profile"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-serif text-2xl italic">Privacy</h1>
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <label htmlFor="ai-sharing" className="text-sm font-semibold">
                Share data with AI providers
              </label>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {!loaded
                  ? "Loading your choice…"
                  : granted
                    ? `On${since ? ` since ${since}` : ""}. The coach, voice, briefings and insights can use your data as described below.`
                    : "Off. RestPilot doesn't send your data to AI providers, and AI features (coach, voice, briefings, insights) are unavailable."}
              </p>
            </div>
          </div>
          <Switch
            id="ai-sharing"
            checked={granted}
            disabled={!loaded || saving}
            onCheckedChange={(v) => void toggle(v)}
            aria-label="Share data with AI providers"
          />
        </div>
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What is shared, and with whom
          </p>
          <AIConsentProviderList />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Turning this off stops new AI requests right away. It doesn't delete what providers
          already received for earlier requests; see the Privacy Policy for how long data is kept.
          AI memory has its own controls on the{" "}
          <Link to="/memory" className="text-primary underline">
            Memory page
          </Link>
          .
        </p>
      </section>

      <section className="rounded-2xl border border-border bg-card">
        <Link
          to="/legal/privacy"
          hash="ai-providers"
          className="flex items-center justify-between p-4"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
              <Shield className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">Privacy Policy</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
        <div className="h-px bg-border" />
        <Link to="/legal/third-parties" className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary">
              <FileText className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold">Providers we share data with</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </Link>
      </section>
    </div>
  );
}
