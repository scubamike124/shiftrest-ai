/**
 * "Update available" pill. Appears when a new SW has installed and is
 * waiting behind the current controller. One tap activates it; the
 * registrar's controllerchange listener then reloads the page.
 *
 * Rendered globally in __root.tsx. Self-gates to PROD only, so it
 * never appears in dev or Lovable preview.
 */

import { useEffect, useState } from "react";
import { onUpdate } from "@/lib/pwa/update-channel";

export function UpdateBanner() {
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    return onUpdate((e) => {
      if (e.type === "available") setReg(e.reg);
      if (e.type === "activated") setReg(null);
    });
  }, []);

  if (!reg) return null;

  const activate = () => {
    const waiting = reg.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    // Ask the waiting worker to take over; controllerchange handler reloads.
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-[100] w-[min(92vw,420px)] -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-black/85 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-tight">
            A new version of RestPilot is available.
          </p>
          <p className="mt-0.5 text-xs text-white/60">Tap Update to reload.</p>
        </div>
        <button
          type="button"
          onClick={activate}
          className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-white/90"
        >
          Update
        </button>
      </div>
    </div>
  );
}
