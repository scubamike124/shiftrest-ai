import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Cookie, Settings2, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { readConsent, writeConsent, type CookieConsent } from "@/lib/legal/cookies";

type Mode = "hidden" | "banner" | "pill";

export function CookieBanner() {
  const [mode, setMode] = useState<Mode>("hidden");
  const [managing, setManaging] = useState(false);
  const [prefs, setPrefs] = useState({
    preferences: false,
    analytics: false,
    ai_logs: false,
    third_party: false,
  });

  // On mount: decide banner vs pill based on stored consent.
  useEffect(() => {
    const c = readConsent();
    if (!c) {
      setMode("banner");
    } else {
      setPrefs({
        preferences: c.preferences,
        analytics: c.analytics,
        ai_logs: c.ai_logs,
        third_party: c.third_party,
      });
      setMode("hidden");
    }
  }, []);

  // Auto-collapse the full banner to a pill after 6s of no interaction.
  useEffect(() => {
    if (mode !== "banner" || managing) return;
    const t = window.setTimeout(() => setMode("pill"), 6000);
    return () => window.clearTimeout(t);
  }, [mode, managing]);

  function save(next: Omit<CookieConsent, "necessary" | "decidedAt" | "version">) {
    writeConsent(next);
    setManaging(false);
    setMode("hidden");
  }

  if (mode === "hidden") return null;

  // Floating pill — never blocks content. Tappable to reopen.
  if (mode === "pill") {
    return (
      <button
        type="button"
        onClick={() => setMode("banner")}
        aria-label="Cookie preferences"
        className="fixed z-[70] inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-2 text-[11px] font-medium text-foreground shadow-lg backdrop-blur-md transition hover:bg-card"
        style={{
          left: "calc(env(safe-area-inset-left, 0px) + 12px)",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        }}
      >
        <Cookie className="h-3.5 w-3.5 text-primary" />
        Cookies
      </button>
    );
  }

  // Full banner.
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] px-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
    >
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur-xl">
        {!managing ? (
          <div className="relative flex flex-col gap-3 pr-7 sm:flex-row sm:items-center sm:pr-9">
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
            <button
              type="button"
              aria-label="Dismiss — show as pill"
              onClick={() => setMode("pill")}
              className="absolute right-0 top-0 rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
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
