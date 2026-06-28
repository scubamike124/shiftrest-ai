/**
 * Web Audio synthesizers for nature/noise tracks. Pure DSP — no audio files,
 * no licensing. Each builder returns a node graph rooted at `output` that the
 * mixer wires into its master gain. `stop()` tears down sources cleanly.
 */
import type { SynthKind } from "./catalog";

export type SynthInstance = {
  output: AudioNode;
  stop: () => void;
};

/** Fill an AudioBuffer with white noise samples in [-1, 1]. */
function fillWhiteNoise(buffer: AudioBuffer) {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
}

/** Paul Kellet's pink-noise approximation — smooth, low CPU. */
function fillPinkNoise(buffer: AudioBuffer) {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
}

/** Brown noise — integrated white noise, low-end heavy. */
function fillBrownNoise(buffer: AudioBuffer) {
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  }
}

function makeNoiseBuffer(
  ctx: AudioContext,
  seconds: number,
  fill: (b: AudioBuffer) => void,
): AudioBuffer {
  const buf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  fill(buf);
  return buf;
}

function loopedSource(ctx: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

export function buildSynth(ctx: AudioContext, kind: SynthKind): SynthInstance {
  const stops: (() => void)[] = [];
  const out = ctx.createGain();
  out.gain.value = 1;

  const stop = () => {
    for (const s of stops) {
      try { s(); } catch { /* ignore */ }
    }
    try { out.disconnect(); } catch { /* ignore */ }
  };

  switch (kind) {
    case "white_noise": {
      const src = loopedSource(ctx, makeNoiseBuffer(ctx, 4, fillWhiteNoise));
      src.connect(out);
      src.start();
      stops.push(() => src.stop());
      break;
    }
    case "pink_noise": {
      const src = loopedSource(ctx, makeNoiseBuffer(ctx, 4, fillPinkNoise));
      src.connect(out);
      src.start();
      stops.push(() => src.stop());
      break;
    }
    case "brown_noise": {
      const src = loopedSource(ctx, makeNoiseBuffer(ctx, 4, fillBrownNoise));
      src.connect(out);
      src.start();
      stops.push(() => src.stop());
      break;
    }
    case "fan": {
      // Filtered brown noise + a low hum oscillator.
      const noise = loopedSource(ctx, makeNoiseBuffer(ctx, 4, fillBrownNoise));
      const bp = ctx.createBiquadFilter();
      bp.type = "lowpass";
      bp.frequency.value = 600;
      bp.Q.value = 0.6;
      noise.connect(bp).connect(out);
      noise.start();
      const hum = ctx.createOscillator();
      hum.type = "sine";
      hum.frequency.value = 110;
      const humGain = ctx.createGain();
      humGain.gain.value = 0.04;
      hum.connect(humGain).connect(out);
      hum.start();
      stops.push(() => { noise.stop(); hum.stop(); });
      break;
    }
    case "rain": {
      // High-passed white noise + faint low rumble; subtle amplitude modulation.
      const noise = loopedSource(ctx, makeNoiseBuffer(ctx, 4, fillWhiteNoise));
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1100;
      const tilt = ctx.createBiquadFilter();
      tilt.type = "highshelf";
      tilt.frequency.value = 3500;
      tilt.gain.value = 4;
      const amp = ctx.createGain();
      amp.gain.value = 0.7;
      noise.connect(hp).connect(tilt).connect(amp).connect(out);
      noise.start();

      const rumble = loopedSource(ctx, makeNoiseBuffer(ctx, 4, fillBrownNoise));
      const rumGain = ctx.createGain();
      rumGain.gain.value = 0.15;
      rumble.connect(rumGain).connect(out);
      rumble.start();

      stops.push(() => { noise.stop(); rumble.stop(); });
      break;
    }
    case "ocean": {
      // Pink noise modulated by a slow LFO to feel like waves.
      const noise = loopedSource(ctx, makeNoiseBuffer(ctx, 6, fillPinkNoise));
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1400;
      const waveGain = ctx.createGain();
      waveGain.gain.value = 0.5;
      noise.connect(lp).connect(waveGain).connect(out);
      noise.start();

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.12;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.35;
      lfo.connect(lfoGain).connect(waveGain.gain);
      lfo.start();

      stops.push(() => { noise.stop(); lfo.stop(); });
      break;
    }
    case "wind": {
      // Band-passed white noise with slow movement.
      const noise = loopedSource(ctx, makeNoiseBuffer(ctx, 6, fillWhiteNoise));
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 600;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.value = 0.45;
      noise.connect(bp).connect(g).connect(out);
      noise.start();

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.07;
      const lfoFreq = ctx.createGain();
      lfoFreq.gain.value = 250;
      lfo.connect(lfoFreq).connect(bp.frequency);
      lfo.start();

      stops.push(() => { noise.stop(); lfo.stop(); });
      break;
    }
    case "river": {
      // High-mid noise with quick burble modulation.
      const noise = loopedSource(ctx, makeNoiseBuffer(ctx, 4, fillWhiteNoise));
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      noise.connect(bp).connect(g).connect(out);
      noise.start();

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 4.5;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.18;
      lfo.connect(lfoG).connect(g.gain);
      lfo.start();

      stops.push(() => { noise.stop(); lfo.stop(); });
      break;
    }
  }

  return { output: out, stop };
}
