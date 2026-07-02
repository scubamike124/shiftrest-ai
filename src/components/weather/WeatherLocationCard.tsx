// Slice 12 — Step 2. Permission-based location entry for the Weather skill.
// Two paths: (1) ask the browser for geolocation, (2) manual city/ZIP entry
// via Open-Meteo geocoding. Writes lat/lon onto user_prefs and marks the
// Weather skill connected. Privacy-first: no auto-grab on mount.

import { useCallback, useEffect, useState } from "react";
import { Loader2, MapPin, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { supabase } from "@/integrations/supabase/client";
import { track } from "@/lib/companion/analytics";
import {
  geocodeWeatherQuery,
  setWeatherLocation,
} from "@/lib/weather/weather.functions";

export function WeatherLocationCard({
  flagOn,
  onSaved,
}: {
  flagOn: boolean;
  onSaved?: () => void;
}) {
  const [current, setCurrent] = useState<{ lat: number | null; lon: number | null; label: string }>(
    { lat: null, lon: null, label: "" },
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"geo" | "search" | "save" | null>(null);

  const geocode = useServerFn(geocodeWeatherQuery);
  const setLoc = useServerFn(setWeatherLocation);

  // Read existing location to show the user where we'll fetch from.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      const uid = session.session?.user.id;
      if (!uid) return;
      const { data } = await supabase
        .from("user_prefs")
        .select("lat, lon, location_label")
        .eq("user_id", uid)
        .maybeSingle();
      if (cancelled || !data) return;
      setCurrent({
        lat: data.lat != null ? Number(data.lat) : null,
        lon: data.lon != null ? Number(data.lon) : null,
        label: (data.location_label as string | null) ?? "",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveLocation = useCallback(
    async (lat: number, lon: number, label: string) => {
      setBusy("save");
      try {
        await setLoc({ data: { lat, lon, label } });
        setCurrent({ lat, lon, label });
        track({ event: "skill_connect_completed", skill: "weather_alerts" });
        toast.success(label ? `Weather set to ${label}.` : "Weather location saved.");
        onSaved?.();
      } catch (e) {
        track({
          event: "skill_connect_failed",
          skill: "weather_alerts",
          reason: e instanceof Error ? e.message : "unknown",
        });
        toast.error("Could not save location. Please try again.");
      } finally {
        setBusy(null);
      }
    },
    [setLoc, onSaved],
  );

  const useDevice = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Geolocation isn't available on this device.");
      return;
    }
    track({ event: "skill_connect_started", skill: "weather_alerts" });
    setBusy("geo");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void saveLocation(pos.coords.latitude, pos.coords.longitude, "My location");
      },
      (err) => {
        setBusy(null);
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Permission denied. You can enter a city or ZIP instead."
            : "Couldn't get your location. Try entering a city or ZIP.";
        toast.error(msg);
        track({
          event: "skill_connect_failed",
          skill: "weather_alerts",
          reason: `geo_${err.code}`,
        });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
  }, [saveLocation]);

  const onSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) {
      toast.error("Enter a city or ZIP (at least 2 characters).");
      return;
    }
    setBusy("search");
    try {
      const hit = await geocode({ data: { query: q } });
      if (!hit.ok) {
        toast.error("No match found. Try a nearby city.");
        return;
      }
      await saveLocation(hit.lat, hit.lon, hit.label);
      setQuery("");
    } catch {
      toast.error("Search failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }, [geocode, query, saveLocation]);

  if (!flagOn) {
    return (
      <Card className="border-dashed p-3">
        <p className="text-[11px] text-muted-foreground">
          Enable Skills above to set your weather location.
        </p>
      </Card>
    );
  }

  const hasLocation =
    current.lat != null &&
    current.lon != null &&
    (current.lat !== 0 || current.lon !== 0);
  const [showChange, setShowChange] = useState(false);
  const showControls = !hasLocation || showChange;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
        <div className="flex-1">
          <p className="text-sm font-semibold">Weather location</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Used only to fetch the local forecast and air quality. Stored on your account.
            Rounded to ~100m. No third-party tracking.
          </p>
        </div>
      </div>

      {hasLocation ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500"
              aria-hidden
            />
            <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">
                {current.label || `${current.lat!.toFixed(2)}, ${current.lon!.toFixed(2)}`}
              </p>
              <p className="text-[10px] uppercase tracking-widest text-emerald-700 dark:text-emerald-400/80">
                Active
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowChange((v) => !v)}
            aria-expanded={showChange}
            className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground active:scale-95"
          >
            {showChange ? "Cancel" : "Change"}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">No location set yet.</p>
      )}

      {showControls && (
        <>
          <Button
            type="button"
            size="sm"
            onClick={useDevice}
            disabled={busy !== null}
            className="min-h-11 justify-center gap-2 active:scale-95"
          >
            {busy === "geo" || busy === "save" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <MapPin className="h-4 w-4" aria-hidden />
            )}
            Use my current location
          </Button>

          <div className="flex flex-col gap-2">
            <Label htmlFor="weather-loc-q" className="text-[11px] text-muted-foreground">
              Or enter a city or ZIP
            </Label>
            <div className="flex gap-2">
              <Input
                id="weather-loc-q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. Austin, TX or 78701"
                maxLength={80}
                className="min-h-11"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onSearch();
                  }
                }}
                disabled={busy !== null}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void onSearch()}
                disabled={busy !== null || query.trim().length < 2}
                className="min-h-11 gap-2 active:scale-95"
                aria-label="Search location"
              >
                {busy === "search" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Search className="h-4 w-4" aria-hidden />
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
