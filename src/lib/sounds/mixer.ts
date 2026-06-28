/**
 * Soundscape mixer. Holds one shared AudioContext and a map of active
 * tracks. Per-track gain is independent of master volume. Mobile-safe:
 * the AudioContext is only created/resumed after a user gesture.
 */
import { TRACK_BY_SLUG, type SoundTrack } from "./catalog";
import { buildSynth, type SynthInstance } from "./synth";

type ActiveTrack = {
  gain: GainNode;
  synth?: SynthInstance;
  audio?: HTMLAudioElement;
  source?: MediaElementAudioSourceNode;
};

class Mixer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private active = new Map<string, ActiveTrack>();
  private _masterVolume = 0.8;

  /** Subscribe to active-track / volume changes. */
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private async ensureContext(): Promise<{ ctx: AudioContext; master: GainNode }> {
    if (this.ctx && this.master) {
      if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
      return { ctx: this.ctx, master: this.master };
    }
    type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };
    const w = window as WindowWithWebkitAudio;
    const AC = window.AudioContext || w.webkitAudioContext;
    if (!AC) throw new Error("Web Audio not supported in this browser.");
    const ctx = new AC();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const master = ctx.createGain();
    master.gain.value = this._masterVolume;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    return { ctx, master };
  }

  get masterVolume() {
    return this._masterVolume;
  }

  setMasterVolume(v: number) {
    this._masterVolume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this._masterVolume, this.ctx.currentTime, 0.05);
    }
    this.emit();
  }

  isActive(slug: string) {
    return this.active.has(slug);
  }

  /** Per-track volume in [0, 1]. Returns 0 when the track isn't active. */
  trackVolume(slug: string): number {
    const a = this.active.get(slug);
    if (!a || !this.ctx) return 0;
    return a.gain.gain.value;
  }

  async play(slug: string, volume?: number) {
    const def = TRACK_BY_SLUG[slug];
    if (!def) return;
    const { ctx, master } = await this.ensureContext();

    // Already playing: just update volume.
    const existing = this.active.get(slug);
    if (existing) {
      if (volume !== undefined) {
        existing.gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
      }
      this.emit();
      return;
    }

    const gain = ctx.createGain();
    const target = volume ?? def.defaultVolume;
    gain.gain.value = 0;
    gain.connect(master);

    const entry: ActiveTrack = { gain };

    if (def.kind === "synth") {
      const synth = buildSynth(ctx, def.synth);
      synth.output.connect(gain);
      entry.synth = synth;
    } else {
      if (!def.src) {
        // File not yet sourced. Don't spin up a silent node.
        gain.disconnect();
        return;
      }
      const audio = new Audio(def.src);
      audio.crossOrigin = "anonymous";
      audio.loop = true;
      const source = ctx.createMediaElementSource(audio);
      source.connect(gain);
      void audio.play().catch(() => {});
      entry.audio = audio;
      entry.source = source;
    }

    this.active.set(slug, entry);
    // Smooth fade-in to target volume.
    gain.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
    this.emit();
  }

  setTrackVolume(slug: string, volume: number) {
    const a = this.active.get(slug);
    if (!a || !this.ctx) return;
    a.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.ctx.currentTime, 0.05);
    this.emit();
  }

  async stop(slug: string) {
    const a = this.active.get(slug);
    if (!a || !this.ctx) return;
    const ctx = this.ctx;
    // Fade out, then tear down.
    a.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    await new Promise((r) => setTimeout(r, 400));
    try { a.synth?.stop(); } catch { /* ignore */ }
    try {
      if (a.audio) {
        a.audio.pause();
        a.audio.src = "";
      }
    } catch { /* ignore */ }
    try { a.source?.disconnect(); } catch { /* ignore */ }
    try { a.gain.disconnect(); } catch { /* ignore */ }
    this.active.delete(slug);
    this.emit();
  }

  async stopAll() {
    const slugs = [...this.active.keys()];
    await Promise.all(slugs.map((s) => this.stop(s)));
    this.clearTimer();
  }

  /** Apply a {slug, volume}[] mix: starts new tracks, stops removed ones. */
  async applyMix(tracks: { slug: string; volume: number }[]) {
    const want = new Map(tracks.map((t) => [t.slug, t.volume]));
    // Stop tracks that should no longer play.
    for (const slug of [...this.active.keys()]) {
      if (!want.has(slug)) await this.stop(slug);
    }
    // Start / adjust desired tracks.
    for (const [slug, volume] of want) {
      if (this.active.has(slug)) {
        this.setTrackVolume(slug, volume);
      } else {
        await this.play(slug, volume);
      }
    }
  }

  /** Current mix as a serializable array (for "Save mix"). */
  snapshot(): { slug: string; volume: number }[] {
    return [...this.active.entries()].map(([slug, a]) => ({
      slug,
      volume: a.gain.gain.value,
    }));
  }

  setSleepTimer(minutes: number | null) {
    this.clearTimer();
    if (!minutes || minutes <= 0) return;
    this.timer = setTimeout(() => {
      void this.stopAll();
    }, minutes * 60_000);
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  listActive(): SoundTrack[] {
    return [...this.active.keys()]
      .map((s) => TRACK_BY_SLUG[s])
      .filter((t): t is SoundTrack => Boolean(t));
  }
}

export const mixer = new Mixer();
