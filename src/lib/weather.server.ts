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

export type TomorrowWeather = {
  high: number;
  low: number;
  morningTempC: number | null;
  precipProbabilityMax: number; // 0..100
  condition: string;
  icon: CurrentWeather["icon"];
};

/**
 * Slice 7 — Tomorrow's morning forecast for the Evening Brief.
 * Returns null on any failure so callers can hide the card.
 */
export async function fetchTomorrowWeather(
  lat: number,
  lon: number,
): Promise<TomorrowWeather | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,precipitation_probability,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&forecast_days=2&timezone=auto`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3500);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[] };
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
        weather_code?: number[];
      };
    };
    const high = json.daily?.temperature_2m_max?.[1];
    const low = json.daily?.temperature_2m_min?.[1];
    const code = json.daily?.weather_code?.[1] ?? 3;
    const pop = json.daily?.precipitation_probability_max?.[1] ?? 0;
    if (high == null || low == null) return null;
    // Look up ~8 AM local for tomorrow's morning temperature.
    let morningTempC: number | null = null;
    const tomorrowDate = json.daily?.time?.[1];
    if (tomorrowDate && Array.isArray(json.hourly?.time) && Array.isArray(json.hourly?.temperature_2m)) {
      const target = `${tomorrowDate}T08:00`;
      const idx = json.hourly!.time!.findIndex((t) => t.startsWith(target));
      if (idx >= 0) morningTempC = json.hourly!.temperature_2m![idx] ?? null;
    }
    const d = describe(code);
    return { high, low, morningTempC, precipProbabilityMax: pop, condition: d.condition, icon: d.icon };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slice 12 — Step 2: Weather Intelligence.
// Richer fetch for the dedicated Weather Intelligence skill.
// Returns a raw, app-shape payload that `deriveWeatherAlerts` turns into
// semantic alerts. Returns null on any failure so callers hide the card.
// ─────────────────────────────────────────────────────────────────────────────

import type { WeatherIntelInput } from "@/lib/weather/intel";

export type WeatherIntel = WeatherIntelInput & {
  /** ISO when this snapshot was produced (server clock). */
  generatedAtISO: string;
};

export async function fetchWeatherIntel(
  lat: number,
  lon: number,
): Promise<WeatherIntel | null> {
  try {
    const fxUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,uv_index` +
      `&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code,wind_speed_10m_max` +
      `&forecast_days=2&timezone=auto&wind_speed_unit=kmh`;
    const aqUrl =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
      `&current=us_aqi,pm2_5&timezone=auto`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4500);
    const [fxRes, aqRes] = await Promise.allSettled([
      fetch(fxUrl, { signal: ac.signal }),
      fetch(aqUrl, { signal: ac.signal }),
    ]);
    clearTimeout(t);
    if (fxRes.status !== "fulfilled" || !fxRes.value.ok) return null;
    const fx = (await fxRes.value.json()) as {
      current?: {
        temperature_2m?: number;
        apparent_temperature?: number;
        weather_code?: number;
        wind_speed_10m?: number;
        uv_index?: number;
      };
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        precipitation_probability?: number[];
        precipitation?: number[];
        weather_code?: number[];
        wind_speed_10m?: number[];
      };
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_probability_max?: number[];
        precipitation_sum?: number[];
        weather_code?: number[];
        wind_speed_10m_max?: number[];
      };
    };
    const nowTempC = fx.current?.temperature_2m;
    if (nowTempC == null) return null;

    let airQuality: WeatherIntel["airQuality"] = null;
    if (aqRes.status === "fulfilled" && aqRes.value.ok) {
      try {
        const aq = (await aqRes.value.json()) as {
          current?: { us_aqi?: number; pm2_5?: number };
        };
        if (aq.current) {
          airQuality = {
            usAqi: aq.current.us_aqi ?? null,
            pm25: aq.current.pm2_5 ?? null,
          };
        }
      } catch {
        airQuality = null;
      }
    }

    const hours = Math.min(24, fx.hourly?.time?.length ?? 0);
    const slice = <T,>(arr: T[] | undefined): T[] => (arr ?? []).slice(0, hours);

    return {
      generatedAtISO: new Date().toISOString(),
      nowTempC,
      feelsLikeC: fx.current?.apparent_temperature ?? null,
      windKph: fx.current?.wind_speed_10m ?? null,
      uvIndex: fx.current?.uv_index ?? null,
      weatherCode: fx.current?.weather_code ?? null,
      hourly: {
        times: slice(fx.hourly?.time),
        tempC: slice(fx.hourly?.temperature_2m),
        precipProb: slice(fx.hourly?.precipitation_probability),
        precipMm: slice(fx.hourly?.precipitation),
        windKph: slice(fx.hourly?.wind_speed_10m),
        weatherCode: slice(fx.hourly?.weather_code),
      },
      daily: {
        maxTempC: fx.daily?.temperature_2m_max?.[0] ?? null,
        minTempC: fx.daily?.temperature_2m_min?.[0] ?? null,
        precipProbMax: fx.daily?.precipitation_probability_max?.[0] ?? null,
        precipSumMm: fx.daily?.precipitation_sum?.[0] ?? null,
        weatherCodeMax: fx.daily?.weather_code?.[0] ?? null,
        windMaxKph: fx.daily?.wind_speed_10m_max?.[0] ?? null,
      },
      airQuality,
      tonightLowC: fx.daily?.temperature_2m_min?.[1] ?? fx.daily?.temperature_2m_min?.[0] ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Server-side geocoding helper. Resolves a city / "City, State" / ZIP into
 * lat/lon. Returns null when no match. Used by /settings/skills manual entry.
 */
export async function geocodeLocation(query: string): Promise<{
  lat: number;
  lon: number;
  label: string;
} | null> {
  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}` +
      `&count=1&language=en&format=json`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3500);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      results?: Array<{
        latitude: number;
        longitude: number;
        name: string;
        admin1?: string;
        country_code?: string;
      }>;
    };
    const r = json.results?.[0];
    if (!r) return null;
    const labelParts = [r.name, r.admin1, r.country_code].filter(Boolean);
    return { lat: r.latitude, lon: r.longitude, label: labelParts.join(", ") };
  } catch {
    return null;
  }
}
