// Appearance (theme) preference: five designed themes plus "Match iPhone
// appearance". Themes are pure CSS-variable token sets in styles.css, selected
// with <html data-theme="...">. No colour pickers.
//
// Kept dependency-free (no "@/" imports) so the pre-paint boot script and the
// unit tests can use exactly the same logic.

export type ThemeId = "midnight" | "ocean" | "forest" | "sunset" | "light";

export type ThemeInfo = {
  id: ThemeId;
  name: string;
  scheme: "dark" | "light";
  /** Status-bar / browser chrome colour (meta theme-color). */
  chrome: string;
  /** Three preview swatches: background, card, accent. */
  swatch: [string, string, string];
};

export const THEMES: readonly ThemeInfo[] = [
  {
    id: "midnight",
    name: "Midnight Purple",
    scheme: "dark",
    chrome: "#0b1020",
    swatch: ["#0a0a1a", "#141432", "#4f46e5"],
  },
  {
    id: "ocean",
    name: "Ocean Blue",
    scheme: "dark",
    chrome: "#07121f",
    swatch: ["#07121f", "#0d1f33", "#2563eb"],
  },
  {
    id: "forest",
    name: "Forest Green",
    scheme: "dark",
    chrome: "#08140f",
    swatch: ["#08140f", "#10241b", "#047857"],
  },
  {
    id: "sunset",
    name: "Warm Sunset",
    scheme: "dark",
    chrome: "#170d0b",
    swatch: ["#170d0b", "#2a1612", "#c2410c"],
  },
  {
    id: "light",
    name: "Soft Light",
    scheme: "light",
    chrome: "#f7f7fb",
    swatch: ["#f7f7fb", "#ffffff", "#4f46e5"],
  },
] as const;

export const DEFAULT_THEME: ThemeId = "midnight";

export type Appearance = {
  theme: ThemeId;
  /** Follow the phone's Light/Dark setting: Soft Light by day, the chosen dark theme by night. */
  matchSystem: boolean;
};

export const DEFAULT_APPEARANCE: Appearance = { theme: DEFAULT_THEME, matchSystem: false };

export const APPEARANCE_KEY = "restpilot.appearance.v1";

const IDS = new Set<string>(THEMES.map((t) => t.id));

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === "string" && IDS.has(v);
}

/** Parse a stored value; anything malformed falls back to the default. */
export function parseAppearance(raw: string | null | undefined): Appearance {
  if (!raw) return { ...DEFAULT_APPEARANCE };
  try {
    const v = JSON.parse(raw) as Partial<Appearance>;
    return {
      theme: isThemeId(v.theme) ? v.theme : DEFAULT_THEME,
      matchSystem: v.matchSystem === true,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

/** The dark theme used at night when matching the phone, given the user's pick. */
export function darkThemeFor(theme: ThemeId): ThemeId {
  return theme === "light" ? DEFAULT_THEME : theme;
}

/** Which theme to show right now. */
export function resolveTheme(a: Appearance, systemPrefersLight: boolean): ThemeId {
  if (a.matchSystem) return systemPrefersLight ? "light" : darkThemeFor(a.theme);
  return a.theme;
}

// Marketing pages keep the brand's Midnight look; the preference styles the app.
const MARKETING_EXACT = new Set(["/", "/pricing", "/features", "/privacy", "/terms"]);
export function isThemedPath(pathname: string): boolean {
  if (MARKETING_EXACT.has(pathname)) return false;
  if (pathname === "/legal" || pathname.startsWith("/legal/")) return false;
  return true;
}

export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Per-user key, so two people sharing a phone keep their own look. */
export function userAppearanceKey(userId: string | null | undefined): string | null {
  return userId ? `${APPEARANCE_KEY}:${userId}` : null;
}

/**
 * Inline <head> script that applies the stored theme before first paint, so a
 * Soft Light user never sees a dark flash. Mirrors resolveTheme/isThemedPath.
 */
export function themeBootScript(): string {
  const chrome = Object.fromEntries(THEMES.map((t) => [t.id, t.chrome]));
  const light = Object.fromEntries(THEMES.map((t) => [t.id, t.scheme === "light"]));
  return `(function(){try{var a={};try{a=JSON.parse(localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})||"{}")||{}}catch(e){}var ids=${JSON.stringify([...IDS])};var t=ids.indexOf(a.theme)>=0?a.theme:"midnight";if(a.matchSystem===true){t=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":(t==="light"?"midnight":t)}var p=location.pathname;var m=${JSON.stringify([...MARKETING_EXACT])}.indexOf(p)>=0||p==="/legal"||p.indexOf("/legal/")===0;if(m)t="midnight";var L=${JSON.stringify(light)};var d=document.documentElement;if(t!=="midnight")d.setAttribute("data-theme",t);d.style.colorScheme=L[t]?"light":"dark";var c=${JSON.stringify(chrome)}[t];var mt=document.querySelector('meta[name="theme-color"]');if(mt&&c)mt.setAttribute("content",c)}catch(e){}})();`;
}

/** Apply a theme to <html> (attribute, color-scheme and theme-color). */
export function applyTheme(id: ThemeId): void {
  if (typeof document === "undefined") return;
  const d = document.documentElement;
  if (id === DEFAULT_THEME) d.removeAttribute("data-theme");
  else d.setAttribute("data-theme", id);
  const info = themeInfo(id);
  d.style.colorScheme = info.scheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", info.chrome);
}

export function readAppearance(userId?: string | null): Appearance {
  if (typeof window === "undefined") return { ...DEFAULT_APPEARANCE };
  try {
    const k = userAppearanceKey(userId);
    const own = k ? window.localStorage.getItem(k) : null;
    return parseAppearance(own ?? window.localStorage.getItem(APPEARANCE_KEY));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export const APPEARANCE_EVENT = "restpilot:appearance";

export function writeAppearance(a: Appearance, userId?: string | null): void {
  if (typeof window === "undefined") return;
  const value = JSON.stringify({ theme: a.theme, matchSystem: a.matchSystem });
  try {
    // Device key drives the pre-paint script; the per-user key restores this
    // user's choice after someone else used the phone.
    window.localStorage.setItem(APPEARANCE_KEY, value);
    const k = userAppearanceKey(userId);
    if (k) window.localStorage.setItem(k, value);
  } catch {
    /* storage unavailable (private mode): the choice lasts for this visit */
  }
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: a }));
}
