// Per-avatar pre-rendered state clips for the video-state pipeline.
//
// Each entry maps an avatar id to one MP4 per OrbState. Clips MUST be:
//   - H.264 baseline, AAC stripped (mute), ~720p, 3–5s seamless loops
//   - Served over HTTPS with CORS, hosted on the Lovable Assets CDN
//   - Decodable on iPhone Safari with `<video playsinline muted loop>`
//
// When a URL is missing for any (avatar, state) pair, AvatarVideo falls
// straight through to the 2D portrait — so dropping in clips is incremental
// and the app never breaks.

import type { OrbState } from "@/components/PilotOrb";

export type VideoStateMap = Partial<Record<OrbState, string>> & {
  poster?: string;
};

// Filled in as CDN clips land. Keys must match AVATAR_PRESETS ids.
export const AVATAR_VIDEO_CLIPS: Record<string, VideoStateMap> = {
  aura: {},
  nova: {},
  atlas: {},
  sage: {},
};

export function videoClipsFor(id: string | null | undefined): VideoStateMap | null {
  if (!id || id.startsWith("custom:")) return null;
  const clips = AVATAR_VIDEO_CLIPS[id];
  if (!clips) return null;
  // Treat fully-empty maps as "no video for this avatar" so AvatarVideo
  // doesn't mount an empty <video> shell.
  const hasAny = !!(clips.idle || clips.listening || clips.thinking || clips.speaking);
  return hasAny ? clips : null;
}

export function hasVideoAvatar(id: string | null | undefined): boolean {
  return videoClipsFor(id) !== null;
}
