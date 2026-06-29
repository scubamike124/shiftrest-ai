// Avatar catalog — preset photoreal portraits the user can pick from.
// "custom:<dataUrl|httpUrl>" is also accepted at runtime and rendered as-is.

import auraSrc from "@/assets/companion-portrait.png";
import novaSrc from "@/assets/companion-nova.jpg";
import atlasSrc from "@/assets/companion-atlas.jpg";
import sageSrc from "@/assets/companion-sage.jpg";

export type AvatarGender = "female" | "male";


export type EyeRig = {
  /** Centre of each eye, in % of the rendered square. */
  eyeLeft: { x: number; y: number };
  eyeRight: { x: number; y: number };
  /** Eye box width / height in %. */
  eyeW: number;
  eyeH: number;
  /** Top-edge eyelid colour (closes downward from the upper lash). */
  lidTop: string;
  /** Mid-band eyelid colour at ~70% close. */
  lidMid: string;
};

const DEFAULT_EYE_RIG: EyeRig = {
  eyeLeft: { x: 43, y: 33.5 },
  eyeRight: { x: 57, y: 33.5 },
  eyeW: 7.2,
  eyeH: 3.2,
  lidTop: "rgba(58, 32, 22, 0.92)",
  lidMid: "rgba(150, 102, 78, 0.55)",
};

export type AvatarPreset = {
  id: string;
  name: string;
  gender: AvatarGender;
  src: string;
  description: string;
  eyeRig?: Partial<EyeRig>;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: "aura", name: "Aura", gender: "female", src: auraSrc,
    description: "Calm and grounded — the default companion.",
  },
  {
    id: "nova", name: "Nova", gender: "female", src: novaSrc,
    description: "Warm and reassuring.",
    // Nova's painted irises sit a hair lower and slightly closer together than the default rig.
    eyeRig: {
      eyeLeft: { x: 43.6, y: 35.2 },
      eyeRight: { x: 56.4, y: 35.2 },
      eyeW: 7.0,
      eyeH: 3.0,
      lidTop: "rgba(48, 28, 22, 0.92)",
      lidMid: "rgba(170, 118, 92, 0.55)",
    },
  },
  {
    id: "atlas", name: "Atlas", gender: "male", src: atlasSrc,
    description: "Steady and confident.",
    eyeRig: {
      eyeLeft: { x: 43, y: 34 },
      eyeRight: { x: 57, y: 34 },
      lidTop: "rgba(40, 24, 18, 0.92)",
      lidMid: "rgba(150, 100, 78, 0.55)",
    },
  },
  {
    id: "sage", name: "Sage", gender: "male", src: sageSrc,
    description: "Wise and gentle.",
    eyeRig: {
      eyeLeft: { x: 43, y: 34 },
      eyeRight: { x: 57, y: 34 },
      lidTop: "rgba(46, 28, 22, 0.92)",
      lidMid: "rgba(160, 110, 84, 0.55)",
    },
  },
];

export const DEFAULT_AVATAR_ID = "aura";

export function resolveAvatarSrc(id: string | null | undefined): string {
  if (!id) return AVATAR_PRESETS[0].src;
  if (id.startsWith("custom:")) return id.slice("custom:".length);
  return AVATAR_PRESETS.find((a) => a.id === id)?.src ?? AVATAR_PRESETS[0].src;
}

export function getEyeRig(id: string | null | undefined): EyeRig {
  const preset = id && !id.startsWith("custom:")
    ? AVATAR_PRESETS.find((a) => a.id === id)
    : null;
  return { ...DEFAULT_EYE_RIG, ...(preset?.eyeRig ?? {}) };
}


export function getAvatarPreset(id: string | null | undefined): AvatarPreset | null {
  if (!id || id.startsWith("custom:")) return null;
  return AVATAR_PRESETS.find((a) => a.id === id) ?? null;
}
