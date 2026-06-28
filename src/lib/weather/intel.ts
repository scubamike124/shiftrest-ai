// Slice 12 — Step 2 (Weather Intelligence). Pure module.
// Turns raw Open-Meteo + AQ data into semantic alerts with practical
// suggestions. No IO, no DOM — safe to call from server fns or unit tests.

export type AlertSeverity = "info" | "warn" | "critical";

export type WeatherAlertId =
  | "rain_soon"
  | "heavy_rain"
  | "heat_warning"
  | "extreme_heat"
  | "cold_warning"
  | "extreme_cold"
  | "high_wind"
  | "storm"
  | "snow"
  | "fog"
  | "high_uv"
  | "poor_air_quality"
  | "commute_impact"
  | "bedtime_comfort";

export interface WeatherAlert {
  id: WeatherAlertId;
  severity: AlertSeverity;
  /** Headline (≤ 50 chars) for badge/card. */
  title: string;
  /** One-sentence practical suggestion. */
  suggestion: string;
  /** Lucide icon name suggestion. */
  icon:
    | "CloudRain"
    | "CloudLightning"
    | "Thermometer"
    | "Snowflake"
    | "Wind"
    | "Sun"
    | "Wind"
    | "CloudFog"
    | "Droplets"
    | "AlertTriangle"
    | "Moon"
    | "Car";
  /** Periods this alert is relevant to (used by briefs). */
  periods: ReadonlyArray<"morning" | "afternoon" | "evening">;
}

export interface WeatherIntelInput {
  /** Current conditions */
  nowTempC: number;
  feelsLikeC: number | null;
  windKph: number | null;
  uvIndex: number | null;
  weatherCode: number | null;
  /** Hourly arrays for the next 24h, aligned by index. */
  hourly: {
    times: string[]; // ISO local
    tempC: number[];
    precipProb: number[]; // 0..100
    precipMm: number[];
    windKph: number[];
    weatherCode: number[];
  };
  /** Daily today/tomorrow */
  daily: {
    maxTempC: number | null;
    minTempC: number | null;
    precipProbMax: number | null;
    precipSumMm: number | null;
    weatherCodeMax: number | null;
    windMaxKph: number | null;
  };
  /** Air quality (optional) */
  airQuality: {
    /** US EPA AQI (0–500). Open-Meteo aqi field. */
    usAqi: number | null;
    pm25: number | null;
  } | null;
  /** Tomorrow night low — drives bedtime comfort. */
  tonightLowC: number | null;
}

// Practical thresholds — chosen conservatively so we don't spam.
const HEAT_C = 32;
const EXTREME_HEAT_C = 38;
const COLD_C = 2;
const EXTREME_COLD_C = -10;
const HIGH_WIND_KPH = 40;
const HEAVY_RAIN_MM = 8;
const UV_HIGH = 8;
const AQI_BAD = 100;
const AQI_VERY_BAD = 150;

function isThunder(code: number | null): boolean {
  return code != null && code >= 95;
}
function isSnow(code: number | null): boolean {
  return code != null && code >= 71 && code <= 77;
}
function isFog(code: number | null): boolean {
  return code != null && code >= 45 && code <= 48;
}

/**
 * Derive a deduplicated, severity-sorted list of weather alerts.
 * Returns an empty array when nothing actionable — callers should hide the
 * card on empty.
 */
export function deriveWeatherAlerts(input: WeatherIntelInput): WeatherAlert[] {
  const out: WeatherAlert[] = [];
  const { nowTempC, feelsLikeC, windKph, uvIndex, hourly, daily, airQuality, tonightLowC } = input;

  // --- Rain horizon (next 6h)
  const next6 = hourly.precipProb.slice(0, 6);
  const next6Mm = hourly.precipMm.slice(0, 6);
  const rainSoonIdx = next6.findIndex((p) => p >= 60);
  const rainPeakMm = next6Mm.length ? Math.max(...next6Mm) : 0;
  if (rainPeakMm >= HEAVY_RAIN_MM) {
    out.push({
      id: "heavy_rain",
      severity: "warn",
      title: "Heavy rain expected",
      suggestion: "Plan for a waterproof layer and allow extra commute time.",
      icon: "CloudRain",
      periods: ["morning", "afternoon", "evening"],
    });
  } else if (rainSoonIdx >= 0) {
    out.push({
      id: "rain_soon",
      severity: "info",
      title: rainSoonIdx === 0 ? "Rain now" : `Rain in ~${rainSoonIdx}h`,
      suggestion: "Bring an umbrella or a rain jacket before you head out.",
      icon: "CloudRain",
      periods: ["morning", "afternoon"],
    });
  }

  // --- Thunderstorm
  if (isThunder(daily.weatherCodeMax) || hourly.weatherCode.slice(0, 6).some(isThunder)) {
    out.push({
      id: "storm",
      severity: "critical",
      title: "Thunderstorms likely",
      suggestion: "Avoid open areas and delay outdoor plans if possible.",
      icon: "CloudLightning",
      periods: ["morning", "afternoon", "evening"],
    });
  }

  // --- Snow / Fog
  if (isSnow(daily.weatherCodeMax)) {
    out.push({
      id: "snow",
      severity: "warn",
      title: "Snow expected",
      suggestion: "Layer up; check the road forecast before commuting.",
      icon: "Snowflake",
      periods: ["morning", "afternoon", "evening"],
    });
  }
  if (hourly.weatherCode.slice(0, 4).some(isFog)) {
    out.push({
      id: "fog",
      severity: "info",
      title: "Foggy morning",
      suggestion: "Add a few minutes to your drive; use low beams.",
      icon: "CloudFog",
      periods: ["morning"],
    });
  }

  // --- Heat
  const high = daily.maxTempC ?? nowTempC;
  if (high >= EXTREME_HEAT_C || (feelsLikeC ?? nowTempC) >= EXTREME_HEAT_C) {
    out.push({
      id: "extreme_heat",
      severity: "critical",
      title: "Extreme heat",
      suggestion: "Hydrate often, avoid midday sun, and check on at-risk neighbors.",
      icon: "Thermometer",
      periods: ["morning", "afternoon"],
    });
  } else if (high >= HEAT_C) {
    out.push({
      id: "heat_warning",
      severity: "warn",
      title: "Hot day ahead",
      suggestion: "Light clothing, sunscreen, and an extra water bottle.",
      icon: "Thermometer",
      periods: ["morning", "afternoon"],
    });
  }

  // --- Cold
  const low = daily.minTempC ?? nowTempC;
  if (low <= EXTREME_COLD_C) {
    out.push({
      id: "extreme_cold",
      severity: "critical",
      title: "Dangerous cold",
      suggestion: "Cover all skin; limit time outside.",
      icon: "Snowflake",
      periods: ["morning", "evening"],
    });
  } else if (low <= COLD_C) {
    out.push({
      id: "cold_warning",
      severity: "info",
      title: "Cold start",
      suggestion: "Grab a warm coat and gloves before heading out.",
      icon: "Thermometer",
      periods: ["morning", "evening"],
    });
  }

  // --- Wind
  const windPeak = Math.max(windKph ?? 0, daily.windMaxKph ?? 0);
  if (windPeak >= HIGH_WIND_KPH) {
    out.push({
      id: "high_wind",
      severity: windPeak >= 70 ? "warn" : "info",
      title: `Windy (${Math.round(windPeak)} km/h)`,
      suggestion: "Secure loose outdoor items; expect cycling and driving impact.",
      icon: "Wind",
      periods: ["morning", "afternoon"],
    });
  }

  // --- UV
  if ((uvIndex ?? 0) >= UV_HIGH) {
    out.push({
      id: "high_uv",
      severity: "info",
      title: `High UV (${Math.round(uvIndex!)})`,
      suggestion: "Sunscreen, hat, and shade between 10 AM and 4 PM.",
      icon: "Sun",
      periods: ["morning", "afternoon"],
    });
  }

  // --- Air quality
  const aqi = airQuality?.usAqi ?? null;
  if (aqi != null && aqi >= AQI_VERY_BAD) {
    out.push({
      id: "poor_air_quality",
      severity: "critical",
      title: `Unhealthy air (AQI ${Math.round(aqi)})`,
      suggestion: "Limit outdoor exertion; keep windows closed.",
      icon: "AlertTriangle",
      periods: ["morning", "afternoon", "evening"],
    });
  } else if (aqi != null && aqi >= AQI_BAD) {
    out.push({
      id: "poor_air_quality",
      severity: "warn",
      title: `Air quality (AQI ${Math.round(aqi)})`,
      suggestion: "Sensitive groups should limit prolonged outdoor activity.",
      icon: "Droplets",
      periods: ["morning", "afternoon"],
    });
  }

  // --- Commute impact (combo signal)
  const commuteWindow = hourly.precipProb.slice(6, 10);
  if (commuteWindow.some((p) => p >= 70) || rainPeakMm >= HEAVY_RAIN_MM || windPeak >= 60) {
    if (!out.some((a) => a.id === "commute_impact")) {
      out.push({
        id: "commute_impact",
        severity: "info",
        title: "Commute impact likely",
        suggestion: "Build in 10–15 extra minutes for travel today.",
        icon: "Car",
        periods: ["morning", "afternoon"],
      });
    }
  }

  // --- Bedtime comfort (evening only)
  if (tonightLowC != null) {
    if (tonightLowC >= 24) {
      out.push({
        id: "bedtime_comfort",
        severity: "info",
        title: "Warm night ahead",
        suggestion: "Cool the room early; light bedding will sleep better.",
        icon: "Moon",
        periods: ["evening"],
      });
    } else if (tonightLowC <= 4) {
      out.push({
        id: "bedtime_comfort",
        severity: "info",
        title: "Chilly night ahead",
        suggestion: "Add a layer; pre-warm the bed if you run cold.",
        icon: "Moon",
        periods: ["evening"],
      });
    }
  }

  // Stable severity ordering, dedupe by id.
  const rank: Record<AlertSeverity, number> = { critical: 0, warn: 1, info: 2 };
  const seen = new Set<WeatherAlertId>();
  return out
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Filter the derived alerts to one brief period. */
export function alertsForPeriod(
  alerts: ReadonlyArray<WeatherAlert>,
  period: "morning" | "afternoon" | "evening",
): WeatherAlert[] {
  return alerts.filter((a) => a.periods.includes(period));
}
