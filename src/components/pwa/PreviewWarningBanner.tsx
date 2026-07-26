import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

const PRODUCTION_URL = "https://restpilotai.com";

function isPreviewOrigin(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev")
  );
}

export function PreviewWarningBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(isPreviewOrigin());
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber/30 bg-amber/15 px-4 py-3 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber" aria-hidden="true" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-foreground">
            You are using a preview build.
          </p>
          <p className="mt-1 text-sm text-amber-foreground/80">
            Install the app from the production link instead, or you may get stuck on an outdated
            version.
          </p>
          <a
            href={PRODUCTION_URL}
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber px-3 py-1.5 text-sm font-semibold text-amber-foreground hover:bg-amber/90"
          >
            Open production site
          </a>
        </div>
        <button
          onClick={() => setVisible(false)}
          className="rounded-full p-1 text-amber-foreground/70 hover:bg-amber/20 hover:text-amber-foreground"
          aria-label="Dismiss preview warning"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
