/**
 * Soundscape track catalog. Each track is either a Web Audio synthesizer
 * (zero licensing, zero file size) or a CDN-hosted audio file (added later
 * via lovable-assets). The mixer dispatches on `kind`.
 */

export type SynthKind =
  | "white_noise"
  | "pink_noise"
  | "brown_noise"
  | "fan"
  | "rain"
  | "ocean"
  | "wind"
  | "river";

export type SoundTrack =
  | {
      slug: string;
      label: string;
      emoji: string;
      kind: "synth";
      synth: SynthKind;
      defaultVolume: number;
    }
  | {
      slug: string;
      label: string;
      emoji: string;
      kind: "file";
      /** Public URL (CC0) — null while we still need to source/upload it. */
      src: string | null;
      defaultVolume: number;
    };

export const TRACKS: SoundTrack[] = [
  { slug: "rain",        label: "Rain",          emoji: "🌧️", kind: "synth", synth: "rain",         defaultVolume: 0.7 },
  { slug: "ocean",       label: "Ocean",         emoji: "🌊", kind: "synth", synth: "ocean",        defaultVolume: 0.7 },
  { slug: "river",       label: "River",         emoji: "🏞️", kind: "synth", synth: "river",        defaultVolume: 0.6 },
  { slug: "wind",        label: "Wind",          emoji: "💨", kind: "synth", synth: "wind",         defaultVolume: 0.5 },
  { slug: "white_noise", label: "White Noise",   emoji: "⚪", kind: "synth", synth: "white_noise",  defaultVolume: 0.4 },
  { slug: "pink_noise",  label: "Pink Noise",    emoji: "🌸", kind: "synth", synth: "pink_noise",   defaultVolume: 0.5 },
  { slug: "brown_noise", label: "Brown Noise",   emoji: "🟤", kind: "synth", synth: "brown_noise",  defaultVolume: 0.6 },
  { slug: "fan",         label: "Fan",           emoji: "🌀", kind: "synth", synth: "fan",          defaultVolume: 0.6 },
  // File-backed tracks — audio files to be uploaded via lovable-assets next pass.
  { slug: "fireplace",   label: "Fireplace",     emoji: "🔥", kind: "file", src: null, defaultVolume: 0.6 },
  { slug: "forest",      label: "Forest",        emoji: "🌲", kind: "file", src: null, defaultVolume: 0.6 },
  { slug: "thunder",     label: "Thunder",       emoji: "⛈️", kind: "file", src: null, defaultVolume: 0.4 },
  { slug: "coffee_shop", label: "Coffee Shop",   emoji: "☕", kind: "file", src: null, defaultVolume: 0.5 },
  { slug: "crickets",    label: "Night Crickets",emoji: "🦗", kind: "file", src: null, defaultVolume: 0.5 },
  { slug: "cabin",       label: "Cabin",         emoji: "🏚️", kind: "file", src: null, defaultVolume: 0.5 },
];

export const TRACK_BY_SLUG: Record<string, SoundTrack> = Object.fromEntries(
  TRACKS.map((t) => [t.slug, t]),
);

export type SoundPreset = {
  slug: string;
  name: string;
  description: string;
  tracks: { slug: string; volume: number }[];
};

export const PRESETS: SoundPreset[] = [
  {
    slug: "storm",
    name: "Storm",
    description: "Heavy rain with distant wind",
    tracks: [
      { slug: "rain", volume: 0.8 },
      { slug: "wind", volume: 0.4 },
    ],
  },
  {
    slug: "coastal",
    name: "Coastal",
    description: "Ocean and a soft breeze",
    tracks: [
      { slug: "ocean", volume: 0.75 },
      { slug: "wind", volume: 0.25 },
    ],
  },
  {
    slug: "deep_sleep",
    name: "Deep Sleep",
    description: "Brown noise with a low fan hum",
    tracks: [
      { slug: "brown_noise", volume: 0.7 },
      { slug: "fan", volume: 0.35 },
    ],
  },
  {
    slug: "stream",
    name: "Quiet Stream",
    description: "Gentle river with rustling wind",
    tracks: [
      { slug: "river", volume: 0.7 },
      { slug: "wind", volume: 0.2 },
    ],
  },
  {
    slug: "focus",
    name: "Focus",
    description: "Soft pink noise, nothing else",
    tracks: [{ slug: "pink_noise", volume: 0.5 }],
  },
];
