import { useState } from "react";
import { Heart } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { disconnectWearable, getWearableSummary } from "@/lib/wearables/wearables.functions";
import type { WearableProvider } from "@/lib/wearables/types";

const PROVIDER_NAME: Record<WearableProvider, string> = { fitbit: "Fitbit", oura: "Oura" };

// Phase 1: connecting NEW wearable providers (Fitbit, Oura) is hidden from the
// UI while we polish onboarding and privacy copy. The OAuth callback routes
// and server functions remain intact so Phase 2 can re-enable this surface
// without a database migration.
//
// People who connected a wearable before it was hidden must still be able to
// revoke that permission and delete the synced data, so existing connections
// are listed with a disconnect control.
export function WearableCard({ signedIn = false }: { signedIn?: boolean }) {
  const queryClient = useQueryClient();
  const summaryFn = useServerFn(getWearableSummary);
  const disconnectFn = useServerFn(disconnectWearable);
  const [busy, setBusy] = useState<WearableProvider | null>(null);
  const { data } = useQuery({
    queryKey: ["wearable-summary"],
    queryFn: () => summaryFn(),
    staleTime: 60_000,
    enabled: signedIn,
  });
  // Also offer deletion for readings left without a connection (for example
  // an earlier disconnect that failed half-way), so there is always a retry.
  const connections = [
    ...(data?.connections ?? []),
    ...(data?.latest && !(data.connections ?? []).some((c) => c.provider === data.latest!.provider)
      ? [{ provider: data.latest.provider, lastSyncAt: null as string | null, orphaned: true }]
      : []),
  ];

  async function disconnect(provider: WearableProvider) {
    setBusy(provider);
    try {
      await disconnectFn({ data: { provider } });
      await queryClient.invalidateQueries({ queryKey: ["wearable-summary"] });
      toast.success(`${PROVIDER_NAME[provider]} disconnected and its synced data deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't disconnect. Please retry.");
    } finally {
      setBusy(null);
    }
  }

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
          {connections.length > 0 ? (
            <ul className="mt-3 space-y-2" aria-label="Connected wearables">
              {connections.map((c) => (
                <li key={c.provider} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs">
                    {PROVIDER_NAME[c.provider]} {"orphaned" in c ? "data stored" : "connected"}
                    {c.lastSyncAt ? ` · last sync ${new Date(c.lastSyncAt).toLocaleDateString()}` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => disconnect(c.provider)}
                    disabled={busy !== null}
                    className="min-h-11 rounded-full border border-border px-3 text-xs font-semibold text-destructive disabled:opacity-60"
                  >
                    {busy === c.provider ? "Disconnecting…" : "Disconnect and delete data"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Coming in a future update — Apple Health, Oura, Fitbit, and Whoop.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
