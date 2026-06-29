// 3D Companion model resolver.
//
// RestPilot AI ships ONE premium branded 3D companion. The bundled GLB is
// hosted on the Lovable asset CDN and used by default — no public input
// for end users to paste arbitrary URLs (the product is a single curated
// premium companion, not a user-configured avatar system).
//
// A `companion.modelUrl` value in localStorage still overrides the default
// (used internally for QA / dev). If loading fails, the parent renderer
// falls back to the 2D portrait (Avatar.tsx onFail path).

import defaultModelAsset from "@/assets/companion/companion-default.glb.asset.json";

const CUSTOM_KEY = "companion.modelUrl";
const RPM_QUERY = "morphTargets=ARKit,Oculus%20Visemes&textureAtlas=1024&pose=A&lod=1";

// Bundled default 3D head — ARKit/Oculus blendshapes compatible with
// Avatar3D.tsx (jawOpen, mouthSmile*, eyeBlinkLeft/Right, browInnerUp).
export const DEFAULT_MODEL_URL: string = defaultModelAsset.url;

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
  return DEFAULT_MODEL_URL;
}

// Kept for backwards compat with the earlier import site.
export const AVATAR_MODEL_URLS: Record<string, string> = {};

