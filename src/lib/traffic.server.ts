// Slice 12 — Step 3. Server-only helpers for Traffic Intelligence.
// Uses the free, public OSRM demo router for route durations + alternatives.
// No API key. Returns null on any failure so callers can hide the card.
//
// Important: OSRM does not have live traffic. We compute a no-traffic ETA
// and compare it against the user's stored baseline (set on first save).
// The /lib/traffic/intel.ts module turns deltas into semantic alerts.

import type { RouteSnapshot } from "@/lib/traffic/intel";

const OSRM_BASE = "https://router.project-osrm.org";

interface OsrmResponse {
  code: string;
  routes?: Array<{
    duration: number; // seconds
    distance: number; // meters
  }>;
}

/**
 * Fetch a driving route snapshot between two points.
 * Returns null if the routing service fails or returns no route.
 */
export async function fetchRouteSnapshot(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<RouteSnapshot | null> {
  try {
    const coords = `${fromLon},${fromLat};${toLon},${toLat}`;
    const url =
      `${OSRM_BASE}/route/v1/driving/${coords}` +
      `?overview=false&alternatives=true&steps=false`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4500);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = (await res.json()) as OsrmResponse;
    if (json.code !== "Ok" || !json.routes || json.routes.length === 0) return null;
    const sorted = [...json.routes].sort((a, b) => a.duration - b.duration);
    const primary = json.routes[0];
    const altCandidate = sorted.find((r) => r !== primary) ?? null;
    return {
      primaryMin: primary.duration / 60,
      alternativeMin: altCandidate ? altCandidate.duration / 60 : null,
      distanceKm: primary.distance / 1000,
    };
  } catch {
    return null;
  }
}
