// Fitbit Web API client — OAuth 2.0 PKCE.
// Docs: https://dev.fitbit.com/build/reference/web-api/

const AUTH_BASE = "https://www.fitbit.com/oauth2/authorize";
const TOKEN_URL = "https://api.fitbit.com/oauth2/token";
const API_BASE = "https://api.fitbit.com";

export const FITBIT_SCOPES = "sleep heartrate profile";

export function getFitbitConfig() {
  const clientId = process.env.FITBIT_CLIENT_ID;
  const clientSecret = process.env.FITBIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Fitbit is not configured. Add FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET secrets.",
    );
  }
  return { clientId, clientSecret };
}

export function buildAuthUrl(opts: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const { clientId } = getFitbitConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: opts.redirectUri,
    scope: FITBIT_SCOPES,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  scope: string;
};

export async function exchangeCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const { clientId, clientSecret } = getFitbitConfig();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fitbit token exchange failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function refreshToken(refreshTokenStr: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = getFitbitConfig();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshTokenStr,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fitbit refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

export type FitbitNight = {
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
): Promise<FitbitNight | null> {
  // Sleep
  const sleepRes = await fetch(`${API_BASE}/1.2/user/-/sleep/date/${date}.json`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!sleepRes.ok) {
    if (sleepRes.status === 401) throw new Error("UNAUTHORIZED");
    throw new Error(`Fitbit sleep fetch failed: ${sleepRes.status}`);
  }
  const sleep = await sleepRes.json();
  const main = (sleep.sleep || []).find((s: any) => s.isMainSleep) || sleep.sleep?.[0];

  // HRV
  let hrvMs: number | null = null;
  try {
    const hrvRes = await fetch(`${API_BASE}/1/user/-/hrv/date/${date}.json`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (hrvRes.ok) {
      const hrv = await hrvRes.json();
      hrvMs = hrv?.hrv?.[0]?.value?.dailyRmssd ?? null;
    }
  } catch {
    /* hrv scope optional */
  }

  // Resting HR
  let restingHr: number | null = null;
  try {
    const hrRes = await fetch(`${API_BASE}/1/user/-/activities/heart/date/${date}/1d.json`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (hrRes.ok) {
      const hr = await hrRes.json();
      restingHr = hr?.["activities-heart"]?.[0]?.value?.restingHeartRate ?? null;
    }
  } catch {
    /* ignore */
  }

  if (!main && hrvMs == null && restingHr == null) return null;

  return {
    date,
    sleepStart: main?.startTime ? new Date(main.startTime).toISOString() : null,
    sleepEnd: main?.endTime ? new Date(main.endTime).toISOString() : null,
    durationMin: main?.minutesAsleep ?? null,
    efficiency: main?.efficiency != null ? main.efficiency / 100 : null,
    deepMin: main?.levels?.summary?.deep?.minutes ?? null,
    remMin: main?.levels?.summary?.rem?.minutes ?? null,
    lightMin: main?.levels?.summary?.light?.minutes ?? null,
    hrvMs,
    restingHr,
  };
}
