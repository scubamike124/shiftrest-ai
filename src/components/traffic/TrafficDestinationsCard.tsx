// Slice 12 — Step 3. Manage Home / Work / custom destinations.
// Privacy-first: geolocation is only requested on explicit button press,
// manual address entry is offered alongside.

import { useCallback, useEffect, useState } from "react";
import { Loader2, MapPin, Search, ShieldCheck, Trash2, Plus, Home, Briefcase, Pin } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

import { track } from "@/lib/companion/analytics";
import {
  deleteTrafficDestination,
  geocodeTrafficQuery,
  listTrafficDestinations,
  upsertTrafficDestination,
  type DestinationKind,
  type TrafficDestinationDTO,
} from "@/lib/traffic/traffic.functions";

const KIND_META: Record<DestinationKind, { label: string; icon: typeof Home }> = {
  home: { label: "Home", icon: Home },
  work: { label: "Work", icon: Briefcase },
  custom: { label: "Custom", icon: Pin },
};

export function TrafficDestinationsCard({
  flagOn,
  onSaved,
}: {
  flagOn: boolean;
  onSaved?: () => void;
}) {
  const [dests, setDests] = useState<TrafficDestinationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState<DestinationKind | null>(null);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [busyForm, setBusyForm] = useState<"geo" | "search" | "save" | null>(null);

  const list = useServerFn(listTrafficDestinations);
  const upsert = useServerFn(upsertTrafficDestination);
  const remove = useServerFn(deleteTrafficDestination);
  const geocode = useServerFn(geocodeTrafficQuery);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await list();
      setDests(rows);
    } catch {
      // empty list on error — keep card usable
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    if (flagOn) void refresh();
  }, [flagOn, refresh]);

  const startAdd = (kind: DestinationKind) => {
    setAdding(kind);
    setLabel(KIND_META[kind].label);
    setAddress("");
  };

  const cancelAdd = () => {
    setAdding(null);
    setLabel("");
    setAddress("");
    setBusyForm(null);
  };

  const saveCoords = useCallback(
    async (lat: number, lon: number, resolvedLabel?: string) => {
      if (!adding) return;
      setBusyForm("save");
      try {
        await upsert({
          data: {
            kind: adding,
            label: (label || resolvedLabel || KIND_META[adding].label).trim(),
            address: address.trim() || resolvedLabel || undefined,
            lat,
            lon,
          },
        });
        track({ event: "skill_connect_completed", skill: "travel" });
        toast.success(`${KIND_META[adding].label} saved.`);
        cancelAdd();
        await refresh();
        onSaved?.();
      } catch (e) {
        track({
          event: "skill_connect_failed",
          skill: "travel",
          reason: e instanceof Error ? e.message : "unknown",
        });
        toast.error("Could not save destination. Please try again.");
      } finally {
        setBusyForm(null);
      }
    },
    [adding, label, address, upsert, refresh, onSaved],
  );

  const useDevice = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Geolocation isn't available on this device.");
      return;
    }
    track({ event: "skill_connect_started", skill: "travel" });
    setBusyForm("geo");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void saveCoords(pos.coords.latitude, pos.coords.longitude, "Current location");
      },
      (err) => {
        setBusyForm(null);
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Permission denied. You can enter an address instead."
            : "Couldn't get your location. Try entering an address.";
        toast.error(msg);
        track({
          event: "skill_connect_failed",
          skill: "travel",
          reason: `geo_${err.code}`,
        });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }, [saveCoords]);

  const onSearch = useCallback(async () => {
    const q = address.trim();
    if (q.length < 2) {
      toast.error("Enter an address, city, or ZIP (at least 2 characters).");
      return;
    }
    setBusyForm("search");
    try {
      const hit = await geocode({ data: { query: q } });
      if (!hit.ok) {
        toast.error("No match found. Try a different address.");
        return;
      }
      await saveCoords(hit.lat, hit.lon, hit.label);
    } catch {
      toast.error("Search failed. Please try again.");
    } finally {
      setBusyForm(null);
    }
  }, [geocode, address, saveCoords]);

  const onDelete = useCallback(
    async (d: TrafficDestinationDTO) => {
      if (typeof window !== "undefined" && !window.confirm(`Remove ${d.label}?`)) return;
      setBusyId(d.id);
      try {
        await remove({ data: { id: d.id } });
        track({ event: "skill_disconnected", skill: "travel", action: `destination_${d.kind}` });
        await refresh();
      } catch {
        toast.error("Could not remove. Please try again.");
      } finally {
        setBusyId(null);
      }
    },
    [remove, refresh],
  );

  if (!flagOn) {
    return (
      <Card className="border-dashed p-3">
        <p className="text-[11px] text-muted-foreground">
          Enable Skills above to manage your traffic destinations.
        </p>
      </Card>
    );
  }

  const hasHome = dests.some((d) => d.kind === "home");
  const hasWork = dests.some((d) => d.kind === "work");

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
        <div className="flex-1">
          <p className="text-sm font-semibold">Traffic destinations</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Save Home, Work, or any place you go often. Reelo estimates drive
            time and warns when traffic is worse than normal. Read-only — Reelo
            never starts navigation for you.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Loading destinations…
        </div>
      ) : dests.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No destinations yet.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Saved destinations">
          {dests.map((d) => {
            const Meta = KIND_META[d.kind];
            const Icon = Meta.icon;
            return (
              <li
                key={d.id}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs"
              >
                <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{d.label}</p>
                  {d.address && (
                    <p className="truncate text-[10px] text-muted-foreground">{d.address}</p>
                  )}
                </div>
                {d.baselineMin != null && (
                  <Badge variant="outline" className="text-[10px]">
                    ~{d.baselineMin} min
                  </Badge>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 min-h-11 w-9 min-w-11 text-destructive hover:text-destructive"
                  onClick={() => void onDelete(d)}
                  disabled={busyId === d.id}
                  aria-label={`Remove ${d.label}`}
                >
                  {busyId === d.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {adding === null ? (
        <div className="flex flex-wrap gap-2">
          {!hasHome && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="min-h-11 gap-1.5"
              onClick={() => startAdd("home")}
            >
              <Home className="h-3.5 w-3.5" aria-hidden /> Add Home
            </Button>
          )}
          {!hasWork && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="min-h-11 gap-1.5"
              onClick={() => startAdd("work")}
            >
              <Briefcase className="h-3.5 w-3.5" aria-hidden /> Add Work
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-11 gap-1.5"
            onClick={() => startAdd("custom")}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add place
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
          <p className="text-xs font-medium">Add {KIND_META[adding].label}</p>
          <Label htmlFor="dest-label" className="text-[11px] text-muted-foreground">
            Name (shown in alerts)
          </Label>
          <Input
            id="dest-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={60}
            className="min-h-11"
            disabled={busyForm !== null}
          />
          <Label htmlFor="dest-address" className="mt-1 text-[11px] text-muted-foreground">
            Address, city, or ZIP
          </Label>
          <div className="flex gap-2">
            <Input
              id="dest-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 100 Main St, Austin TX"
              maxLength={120}
              className="min-h-11"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onSearch();
                }
              }}
              disabled={busyForm !== null}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="min-h-11 gap-2"
              onClick={() => void onSearch()}
              disabled={busyForm !== null || address.trim().length < 2}
              aria-label="Search address"
            >
              {busyForm === "search" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Search className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 gap-2"
              onClick={useDevice}
              disabled={busyForm !== null}
            >
              {busyForm === "geo" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <MapPin className="h-4 w-4" aria-hidden />
              )}
              Use current location
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-11"
              onClick={cancelAdd}
              disabled={busyForm !== null}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
