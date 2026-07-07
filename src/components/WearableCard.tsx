import { Heart } from "lucide-react";

// Phase 1: wearable providers (Fitbit, Oura) are hidden from the UI while we
// polish onboarding and privacy copy. The OAuth callback routes and server
// functions remain intact so Phase 2 can re-enable this surface without a
// database migration.
export function WearableCard() {
  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-mint">
          <Heart className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">Wearable &amp; health sync</p>
          <p className="text-xs text-muted-foreground">
            Pull actual sleep, HRV, and resting heart rate into your plan.
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Coming in a future update — Apple Health, Oura, Fitbit, and Whoop.
          </p>
        </div>
      </div>
    </section>
  );
}
