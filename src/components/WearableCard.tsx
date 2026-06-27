import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Heart, Plug, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import {
import { SafetyNote } from "@/components/legal/SafetyNote";
  disconnectWearable,
  getWearableSummary,
  startWearableOAuth,
  syncWearableNow,
} from "@/lib/wearables/wearables.functions";
import { PROVIDER_LABEL, type WearableProvider } from "@/lib/wearables/types";

function setPkceCookie(verifier: string) {
  // 10-minute, lax cookie used only by the Fitbit callback. Same-site only.
  document.cookie = `wearable_pkce=${encodeURIComponent(
    verifier,
  )}; Path=/; Max-Age=600; SameSite=Lax`;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function WearableCard() {
  const qc = useQueryClient();
  const getSummary = useServerFn(getWearableSummary);
  const startOAuth = useServerFn(startWearableOAuth);
  const syncNow = useServerFn(syncWearableNow);
  const disconnectFn = useServerFn(disconnectWearable);

  const { data, isLoading } = useQuery({
    queryKey: ["wearable-summary"],
    queryFn: () => getSummary(),
  });

  const [pending, setPending] = useState<WearableProvider | null>(null);

  // Surface ?connected= / ?error= query params from OAuth redirects.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    const reason = params.get("reason");
    if (connected) {
      toast.success(`${PROVIDER_LABEL[connected as WearableProvider] ?? "Device"} connected`);
      qc.invalidateQueries({ queryKey: ["wearable-summary"] });
    }
    if (error) {
      toast.error(
        `Couldn't connect ${PROVIDER_LABEL[error as WearableProvider] ?? "device"}${
          reason ? ` — ${decodeURIComponent(reason)}` : ""
        }`,
      );
    }
    if (connected || error) {
      const cleaned = new URL(window.location.href);
      cleaned.searchParams.delete("connected");
      cleaned.searchParams.delete("error");
      cleaned.searchParams.delete("reason");
      window.history.replaceState({}, "", cleaned.toString());
    }
  }, [qc]);

  const connectMut = useMutation({
    mutationFn: async (provider: WearableProvider) => {
      setPending(provider);
      const res = await startOAuth({ data: { provider } });
      if (provider === "fitbit" && res.codeVerifier) setPkceCookie(res.codeVerifier);
      window.location.href = res.url;
    },
    onError: (e: any) => {
      setPending(null);
      toast.error(e?.message ?? "Couldn't start connection");
    },
  });

  const syncMut = useMutation({
    mutationFn: (provider: WearableProvider) => syncNow({ data: { provider } }),
    onSuccess: (r, provider) => {
      qc.invalidateQueries({ queryKey: ["wearable-summary"] });
      if (r.inserted) toast.success(`Synced ${PROVIDER_LABEL[provider]}`);
      else toast(`No new data for ${PROVIDER_LABEL[provider]} yet`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Sync failed"),
  });

  const disconnectMut = useMutation({
    mutationFn: (provider: WearableProvider) => disconnectFn({ data: { provider } }),
    onSuccess: (_r, provider) => {
      qc.invalidateQueries({ queryKey: ["wearable-summary"] });
      toast.success(`${PROVIDER_LABEL[provider]} disconnected`);
    },
  });

  const isConnected = (p: WearableProvider) =>
    data?.connections.some((c) => c.provider === p) ?? false;
  const findConn = (p: WearableProvider) => data?.connections.find((c) => c.provider === p);

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex items-start gap-3 p-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-mint">
          <Heart className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">Wearable & health sync</p>
          <p className="text-xs text-muted-foreground">
            Pull actual sleep, HRV, and resting heart rate into your plan.
          </p>
        </div>
      </div>

      <div className="space-y-2 px-4 pb-4">
        {(["fitbit", "oura"] as WearableProvider[]).map((provider) => {
          const conn = findConn(provider);
          const connected = isConnected(provider);
          return (
            <div
              key={provider}
              className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{PROVIDER_LABEL[provider]}</p>
                <p className="text-[11px] text-muted-foreground">
                  {isLoading
                    ? "Loading…"
                    : connected
                      ? `Connected · synced ${relTime(conn?.lastSyncAt ?? null)}`
                      : "Not connected"}
                </p>
                {conn?.lastSyncError && (
                  <p className="text-[11px] text-destructive">{conn.lastSyncError}</p>
                )}
              </div>
              {connected ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => syncMut.mutate(provider)}
                    disabled={syncMut.isPending && syncMut.variables === provider}
                    className="flex h-9 items-center gap-1 rounded-lg bg-secondary px-2.5 text-xs font-semibold disabled:opacity-60"
                    aria-label={`Sync ${PROVIDER_LABEL[provider]} now`}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        syncMut.isPending && syncMut.variables === provider ? "animate-spin" : ""
                      }`}
                    />
                    Sync
                  </button>
                  <button
                    onClick={() => disconnectMut.mutate(provider)}
                    disabled={disconnectMut.isPending && disconnectMut.variables === provider}
                    className="flex h-9 items-center gap-1 rounded-lg bg-destructive/10 px-2.5 text-xs font-semibold text-destructive disabled:opacity-60"
                  >
                    <Unplug className="h-3.5 w-3.5" /> Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => connectMut.mutate(provider)}
                  disabled={pending === provider}
                  className="flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  <Plug className="h-3.5 w-3.5" /> Connect
                </button>
              )}
            </div>
          );
        })}
        <p className="pt-1 text-[10px] text-muted-foreground">
          Apple Health and Whoop ship with the upcoming iOS app.
        </p>
      </div>
    <div className="mt-3 flex justify-end"><SafetyNote /></div>
    </section>
  );
}
