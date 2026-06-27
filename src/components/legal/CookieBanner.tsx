import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Cookie, Settings2, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { readConsent, writeConsent, type CookieConsent } from "@/lib/legal/cookies";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [prefs, setPrefs] = useState({
    preferences: false,
    analytics: false,
    ai_logs: false,
    third_party: false,
  });

  useEffect(() => {
    const c = readConsent();
    if (!c) setVisible(true);
    else
      setPrefs({
        preferences: c.preferences,
        analytics: c.analytics,
        ai_logs: c.ai_logs,
        third_party: c.third_party,
      });
  }, []);

  function save(next: Omit<CookieConsent, "necessary" | "decidedAt" | "version">) {
    writeConsent(next);
    setVisible(false);
    setManaging(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur-xl">
        {!managing ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Cookie className="h-5 w-5 shrink-0 text-primary" />
            <p className="flex-1 text-xs text-muted-foreground">
              We use necessary cookies to run RestPilot AI, plus optional ones for preferences,
              analytics, and AI service logs. See our{" "}
              <Link to="/legal/cookies" className="text-primary underline">
                Cookie Policy
              </Link>
              .
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setManaging(true)}
                className="h-9 rounded-lg border border-border px-3 text-xs font-medium"
              >
                <Settings2 className="mr-1 inline h-3.5 w-3.5" />
                Manage
              </button>
              <button
                onClick={() =>
                  save({ preferences: false, analytics: false, ai_logs: false, third_party: false })
                }
                className="h-9 rounded-lg border border-border px-3 text-xs font-medium"
              >
                Reject non-essential
              </button>
              <button
                onClick={() =>
                  save({ preferences: true, analytics: true, ai_logs: true, third_party: true })
                }
                className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
              >
                Accept all
              </button>
            </div>
          </div>
        ) : (
          <div className="relative">
            <button
              aria-label="Close"
              onClick={() => setManaging(false)}
              className="absolute right-0 top-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <h3 className="text-sm font-semibold">Cookie preferences</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Necessary cookies are always on. Toggle the rest as you like.
            </p>
            <div className="mt-3 space-y-2">
              <Row label="Necessary" desc="Sign-in, security, and app state." value={true} disabled />
              <Row
                label="Preferences"
                desc="Remembers UI and personalization choices."
                value={prefs.preferences}
                onChange={(v) => setPrefs((p) => ({ ...p, preferences: v }))}
              />
              <Row
                label="Analytics"
                desc="Aggregate usage to improve RestPilot."
                value={prefs.analytics}
                onChange={(v) => setPrefs((p) => ({ ...p, analytics: v }))}
              />
              <Row
                label="AI service logs"
                desc="Stores prompt/response metadata to debug AI quality."
                value={prefs.ai_logs}
                onChange={(v) => setPrefs((p) => ({ ...p, ai_logs: v }))}
              />
              <Row
                label="Third-party"
                desc="Optional providers (e.g. wearables, voice)."
                value={prefs.third_party}
                onChange={(v) => setPrefs((p) => ({ ...p, third_party: v }))}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => save(prefs)}
                className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
              >
                Save preferences
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  desc,
  value,
  onChange,
  disabled,
}: {
  label: string;
  desc: string;
  value: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-2">
      <div>
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={value} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
