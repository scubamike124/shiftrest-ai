// Server-side Open-Meteo helper for the Morning Brief. No API key required.
// Returns `null` on any failure so callers can hide the card gracefully.

export type CurrentWeather = {
  tempC: number;
  high: number;
  low: number;
  /** WMO weather code → coarse condition string */
  condition: string;
  /** Lucide icon name suggestion */
  icon: "Sun" | "Cloud" | "CloudRain" | "CloudSnow" | "CloudLightning" | "CloudFog" | "CloudSun";
};

function describe(code: number): { condition: string; icon: CurrentWeather["icon"] } {
  if (code === 0) return { condition: "Clear", icon: "Sun" };
  if (code <= 2) return { condition: "Mostly clear", icon: "CloudSun" };
  if (code === 3) return { condition: "Overcast", icon: "Cloud" };
  if (code >= 45 && code <= 48) return { condition: "Fog", icon: "CloudFog" };
  if (code >= 51 && code <= 67) return { condition: "Rain", icon: "CloudRain" };
  if (code >= 71 && code <= 77) return { condition: "Snow", icon: "CloudSnow" };
  if (code >= 80 && code <= 82) return { condition: "Showers", icon: "CloudRain" };
  if (code >= 95) return { condition: "Thunderstorm", icon: "CloudLightning" };
  return { condition: "Cloudy", icon: "Cloud" };
}

export async function fetchCurrentWeather(
  lat: number,
  lon: number,
): Promise<CurrentWeather | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3500);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
      daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[] };
    };
    const tempC = json.current?.temperature_2m;
    const code = json.current?.weather_code ?? 3;
    const high = json.daily?.temperature_2m_max?.[0];
    const low = json.daily?.temperature_2m_min?.[0];
    if (tempC == null || high == null || low == null) return null;
    const d = describe(code);
    return { tempC, high, low, condition: d.condition, icon: d.icon };
  } catch {
    return null;
  }
}
