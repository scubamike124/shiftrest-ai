// 3D Companion model resolver.
//
// The Companion renders the 2D portrait on every device (Avatar.tsx). There is
// no default 3D model any more: see model-url.ts for why. A `companion.modelUrl`
// value in localStorage is still honoured for internal QA, unless it points at
// the dead Ready Player Me host. If a model ever fails to load, the parent
// renderer falls back to the 2D portrait (Avatar.tsx onFail path).

import defaultModelAsset from "@/assets/companion/companion-default.glb.asset.json";
import { resolveModelUrl } from "./model-url";

const CUSTOM_KEY = "companion.modelUrl";

// The bundled GLB on the Lovable asset CDN, kept for desktop QA overrides. It is
// not used by default: its gltfpack compression does not decode on iOS Safari.
export const BUNDLED_PREMIUM_MODEL_URL: string = defaultModelAsset.url;

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

export function modelUrlFor(_id: string | null | undefined): string | null {
  return resolveModelUrl(getCustomModelUrl());
}

// Kept for backwards compat with the earlier import site.
export const AVATAR_MODEL_URLS: Record<string, string> = {};

