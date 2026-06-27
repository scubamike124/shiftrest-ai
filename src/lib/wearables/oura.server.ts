// Oura API v2 client — OAuth 2.0
// Docs: https://cloud.ouraring.com/v2/docs

const AUTH_BASE = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";
const API_BASE = "https://api.ouraring.com/v2";

export const OURA_SCOPES = "personal daily heartrate";

export function getOuraConfig() {
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Oura is not configured. Add OURA_CLIENT_ID and OURA_CLIENT_SECRET secrets.",
    );
  }
  return { clientId, clientSecret };
}

export function buildAuthUrl(opts: { redirectUri: string; state: string }): string {
  const { clientId } = getOuraConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    scope: OURA_SCOPES,
    state: opts.state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
};

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getOuraConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Oura token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function refreshToken(refreshTokenStr: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getOuraConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshTokenStr,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Oura refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

export type OuraNight = {
  date: string;
  sleepStart: string | null;
  sleepEnd: string | null;
  durationMin: number | null;
  efficiency: number | null;
  deepMin: number | null;
  remMin: number | null;
  lightMin: number | null;
  hrvMs: number | null;
  restingHr: number | null;
};

export async function fetchLastNight(
  accessToken: string,
  date: string,
): Promise<OuraNight | null> {
  const params = new URLSearchParams({ start_date: date, end_date: date });
  const res = await fetch(`${API_BASE}/usercollection/sleep?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("UNAUTHORIZED");
    throw new Error(`Oura sleep fetch failed: ${res.status}`);
  }
  const json = await res.json();
  // Pick the longest "long_sleep" period for the night
  const periods = (json.data || []).filter((p: any) => p.type === "long_sleep" || !p.type);
  const main = periods.sort(
    (a: any, b: any) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0),
  )[0];

  if (!main) return null;

  const toMin = (sec: number | null | undefined) =>
    sec != null ? Math.round(sec / 60) : null;

  return {
    date,
    sleepStart: main.bedtime_start ?? null,
    sleepEnd: main.bedtime_end ?? null,
    durationMin: toMin(main.total_sleep_duration),
    efficiency: main.efficiency != null ? main.efficiency / 100 : null,
    deepMin: toMin(main.deep_sleep_duration),
    remMin: toMin(main.rem_sleep_duration),
    lightMin: toMin(main.light_sleep_duration),
    hrvMs: main.average_hrv ?? null,
    restingHr: main.lowest_heart_rate ?? null,
  };
}
