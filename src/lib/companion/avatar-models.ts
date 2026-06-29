// Ready Player Me model URLs for the 3D Companion head.
//
// RPM avatars are user-generated, so we don't bundle preset URLs (any baked-in
// ID is liable to 404). Instead the user creates their own avatar at
// https://readyplayer.me and pastes the .glb URL into Settings → Companion.
//
// When no custom URL is set, the 2D portrait renders.

const CUSTOM_KEY = "companion.modelUrl";
const RPM_QUERY = "morphTargets=ARKit,Oculus%20Visemes&textureAtlas=1024&pose=A&lod=1";

export function getCustomModelUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(CUSTOM_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function setCustomModelUrl(url: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!url) window.localStorage.removeItem(CUSTOM_KEY);
    else window.localStorage.setItem(CUSTOM_KEY, url.trim());
    window.dispatchEvent(new CustomEvent("companion:pref-changed", { detail: { key: CUSTOM_KEY, value: url ?? "" } }));
  } catch { /* ignore */ }
}

// Append RPM morph-target query if the URL looks like a bare RPM .glb.
function withMorphTargets(raw: string): string {
  if (!/readyplayer\.me/.test(raw)) return raw;
  if (raw.includes("morphTargets=")) return raw;
  return raw.includes("?") ? `${raw}&${RPM_QUERY}` : `${raw}?${RPM_QUERY}`;
}

export function modelUrlFor(_id: string | null | undefined): string | null {
  const custom = getCustomModelUrl();
  if (custom) return withMorphTargets(custom);
  return null;
}

// Kept for backwards compat with the earlier import site.
export const AVATAR_MODEL_URLS: Record<string, string> = {};

