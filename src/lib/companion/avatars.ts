// Avatar catalog — preset photoreal portraits the user can pick from.
// "custom:<dataUrl|httpUrl>" is also accepted at runtime and rendered as-is.

import auraSrc from "@/assets/companion-portrait.png";
import novaSrc from "@/assets/companion-nova.jpg";
import atlasSrc from "@/assets/companion-atlas.jpg";
import sageSrc from "@/assets/companion-sage.jpg";

export type AvatarGender = "female" | "male";

export type AvatarPreset = {
  id: string;
  name: string;
  gender: AvatarGender;
  src: string;
  description: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "aura",  name: "Aura",  gender: "female", src: auraSrc,  description: "Calm and grounded — the default companion." },
  { id: "nova",  name: "Nova",  gender: "female", src: novaSrc,  description: "Warm and reassuring." },
  { id: "atlas", name: "Atlas", gender: "male",   src: atlasSrc, description: "Steady and confident." },
  { id: "sage",  name: "Sage",  gender: "male",   src: sageSrc,  description: "Wise and gentle." },
];

export const DEFAULT_AVATAR_ID = "aura";

export function resolveAvatarSrc(id: string | null | undefined): string {
  if (!id) return AVATAR_PRESETS[0].src;
  if (id.startsWith("custom:")) return id.slice("custom:".length);
  return AVATAR_PRESETS.find((a) => a.id === id)?.src ?? AVATAR_PRESETS[0].src;
}

export function getAvatarPreset(id: string | null | undefined): AvatarPreset | null {
  if (!id || id.startsWith("custom:")) return null;
  return AVATAR_PRESETS.find((a) => a.id === id) ?? null;
}
