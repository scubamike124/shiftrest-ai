import { useEffect, useState } from "react";
import { BellRing, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { requestPermission, canRequestNotificationPermission } from "@/lib/notify";

const KEY = "rp.smartAlarmCoach.dismissed.v1";

/**
 * One-time coach card for Smart Alarm reliability on iPhone.
 * Auto-hides once notifications are granted or the user dismisses it.
 */
export function SmartAlarmCoach() {
  const [hidden, setHidden] = useState(true);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = localStorage.getItem(KEY) === "1";
    const granted =
      "Notification" in window && Notification.permission === "granted";
    setHidden(dismissed || granted);
  }, []);

  if (hidden) return null;

  async function enable() {
    const guard = canRequestNotificationPermission();
    if (!guard.ok) {
      setShowInstall(true);
      return;
    }
    const res = await requestPermission();
    if (res === "granted") {
      toast.success("Notifications enabled");
      localStorage.setItem(KEY, "1");
      setHidden(true);
    } else if (res === "denied") {
      toast.message("Notifications blocked", {
        description: "You can re-enable them in Settings → Safari → Notifications.",
      });
    }
  }

  function dismiss() {
    localStorage.setItem(KEY, "1");
    setHidden(true);
  }

  return (
    <section className="relative rounded-2xl border border-primary/30 bg-primary/5 p-4">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-background/60"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <BellRing className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Get the most reliable Smart Alarms</h3>
          <p className="mt-1 text-[12px] leading-snug text-foreground/90">
            For the best background alarm experience available on iPhone:
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[12px] leading-snug text-foreground/90">
            <li>• Add RestPilot to your Home Screen</li>
            <li>• Enable Notifications</li>
            <li>• Keep Smart Alarm enabled</li>
          </ul>
        </div>
      </div>

      {showInstall && (
        <div className="mt-3 rounded-xl bg-background/70 p-3 text-[12px] leading-snug text-foreground/90">
          <p className="font-semibold">How to install on iPhone</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-muted-foreground">
            <li>Tap the Share button in Safari</li>
            <li>Choose <em>Add to Home Screen</em></li>
            <li>Open RestPilot from the new icon</li>
            <li>Return here and tap Enable Notifications</li>
          </ol>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={enable}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground"
        >
          <BellRing className="h-3.5 w-3.5" /> Enable Notifications
        </button>
        <button
          type="button"
          onClick={() => setShowInstall((v) => !v)}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-xs font-semibold"
        >
          <Smartphone className="h-3.5 w-3.5" /> How to Install
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="h-9 rounded-xl px-3 text-xs font-semibold text-muted-foreground"
        >
          Not Now
        </button>
      </div>
    </section>
  );
}
