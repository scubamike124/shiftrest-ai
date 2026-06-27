// Client-side cookie/consent preference store.

export type CookieCategory =
  | "necessary"
  | "preferences"
  | "analytics"
  | "ai_logs"
  | "third_party";

export type CookieConsent = {
  necessary: true;
  preferences: boolean;
  analytics: boolean;
  ai_logs: boolean;
  third_party: boolean;
  decidedAt: string; // ISO
  version: string;
};

const KEY = "restpilot.cookie-consent.v1";
const VERSION = "2026-06-27";

export const DEFAULT_CONSENT: CookieConsent = {
  necessary: true,
  preferences: false,
  analytics: false,
  ai_logs: false,
  third_party: false,
  decidedAt: "",
  version: VERSION,
};

export function readConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookieConsent;
    if (parsed.version !== VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeConsent(c: Omit<CookieConsent, "necessary" | "decidedAt" | "version">): CookieConsent {
  const full: CookieConsent = {
    necessary: true,
    preferences: c.preferences,
    analytics: c.analytics,
    ai_logs: c.ai_logs,
    third_party: c.third_party,
    decidedAt: new Date().toISOString(),
    version: VERSION,
  };
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(full));
  return full;
}

export function hasConsent(category: CookieCategory): boolean {
  if (category === "necessary") return true;
  const c = readConsent();
  if (!c) return false;
  return Boolean(c[category]);
}
