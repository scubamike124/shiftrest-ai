// Curated alarm sounds. All synthesized via WebAudio so there are no
// asset downloads, no autoplay issues, and reliable behavior on iOS.
//
// Each sound exposes `start(ctx, master)` which schedules notes/loops on
// the provided AudioContext and returns a `stop()` function. The caller
// (foreground alarm or preview button) owns master gain and fade-in.

export type AlarmSoundId =
  | "gentle_sunrise"
  | "classic_bell"
  | "soft_chimes"
  | "digital_alarm"
  | "birds_nature"
  | "ocean_waves"
  | "piano_wake"
  | "emergency_alarm";

export type AlarmSoundMeta = {
  id: AlarmSoundId;
  label: string;
  emoji: string;
  description: string;
};

export const ALARM_SOUNDS: AlarmSoundMeta[] = [
  { id: "gentle_sunrise", label: "Gentle Sunrise", emoji: "🌅", description: "Soft warm pad that swells in slowly." },
  { id: "classic_bell",   label: "Classic Bell",   emoji: "🔔", description: "Warm bell strikes with a long tail." },
  { id: "soft_chimes",    label: "Soft Chimes",    emoji: "🎐", description: "Gentle wind chime arpeggio." },
  { id: "digital_alarm",  label: "Digital Alarm",  emoji: "⏰", description: "Classic radio-clock beep pattern." },
  { id: "birds_nature",   label: "Birds & Nature", emoji: "🐦", description: "Layered bird chirps over soft noise." },
  { id: "ocean_waves",    label: "Ocean Waves",    emoji: "🌊", description: "Filtered noise swells like surf." },
  { id: "piano_wake",     label: "Piano Wake",     emoji: "🎹", description: "Soft piano chord progression." },
  { id: "emergency_alarm",label: "Emergency Alarm",emoji: "🚨", description: "Loud two-tone siren — use sparingly." },
];

export const DEFAULT_ALARM_SOUND: AlarmSoundId = "gentle_sunrise";

type StopFn = () => void;

export function startAlarmSound(
  id: AlarmSoundId,
  ctx: AudioContext,
  master: AudioNode,
): StopFn {
  switch (id) {
    case "gentle_sunrise": return startGentleSunrise(ctx, master);
    case "classic_bell":   return startClassicBell(ctx, master);
    case "soft_chimes":    return startSoftChimes(ctx, master);
    case "digital_alarm":  return startDigitalAlarm(ctx, master);
    case "birds_nature":   return startBirdsNature(ctx, master);
    case "ocean_waves":    return startOceanWaves(ctx, master);
    case "piano_wake":     return startPianoWake(ctx, master);
    case "emergency_alarm":return startEmergencyAlarm(ctx, master);
    default:               return startGentleSunrise(ctx, master);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Sound builders. All return a stop() that tears down everything cleanly.
// ────────────────────────────────────────────────────────────────────────

function tone(ctx: AudioContext, dest: AudioNode, freq: number, when: number, dur: number, type: OscillatorType = "sine", peak = 0.5) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g).connect(dest);
  osc.start(when);
  osc.stop(when + dur + 0.05);
}

function startGentleSunrise(ctx: AudioContext, dest: AudioNode): StopFn {
  let stopped = false;
  const interval = setInterval(() => {
    if (stopped) return;
    const t = ctx.currentTime + 0.02;
    // Soft sine pad chord, slow attack
    [220, 277, 330].forEach((f, i) => tone(ctx, dest, f, t + i * 0.05, 3.5, "sine", 0.35));
  }, 4500);
  // Kick off immediately too.
  const t0 = ctx.currentTime + 0.02;
  [220, 277, 330].forEach((f, i) => tone(ctx, dest, f, t0 + i * 0.05, 3.5, "sine", 0.35));
  return () => { stopped = true; clearInterval(interval); };
}

function startClassicBell(ctx: AudioContext, dest: AudioNode): StopFn {
  let stopped = false;
  const ring = () => {
    if (stopped) return;
    const t = ctx.currentTime + 0.02;
    // Bell = fundamental + inharmonic partials with long decay.
    tone(ctx, dest, 880, t, 2.4, "sine", 0.55);
    tone(ctx, dest, 1318, t, 1.8, "sine", 0.32);
    tone(ctx, dest, 2637, t, 1.0, "sine", 0.18);
  };
  ring();
  const interval = setInterval(ring, 2200);
  return () => { stopped = true; clearInterval(interval); };
}

function startSoftChimes(ctx: AudioContext, dest: AudioNode): StopFn {
  let stopped = false;
  const notes = [523, 659, 784, 988, 1318];
  const play = () => {
    if (stopped) return;
    const t = ctx.currentTime + 0.02;
    notes.forEach((f, i) => tone(ctx, dest, f, t + i * 0.18, 1.6, "sine", 0.35));
  };
  play();
  const interval = setInterval(play, 2800);
  return () => { stopped = true; clearInterval(interval); };
}

function startDigitalAlarm(ctx: AudioContext, dest: AudioNode): StopFn {
  let stopped = false;
  const beep = () => {
    if (stopped) return;
    const t = ctx.currentTime + 0.02;
    for (let i = 0; i < 4; i++) tone(ctx, dest, 1500, t + i * 0.18, 0.12, "square", 0.5);
  };
  beep();
  const interval = setInterval(beep, 1100);
  return () => { stopped = true; clearInterval(interval); };
}

function startBirdsNature(ctx: AudioContext, dest: AudioNode): StopFn {
  // Soft pink-ish noise bed + intermittent bird chirps (FM-ish quick sweeps).
  const noise = makeNoiseSource(ctx, "pink");
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1800;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.08;
  noise.connect(lp).connect(noiseGain).connect(dest);
  noise.start();

  let stopped = false;
  const chirp = () => {
    if (stopped) return;
    const t = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2400 + Math.random() * 800, t);
    osc.frequency.exponentialRampToValueAtTime(3600, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(2200, t + 0.16);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.3);
  };
  const interval = setInterval(() => {
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) setTimeout(chirp, i * 120);
  }, 1400);
  chirp();

  return () => {
    stopped = true;
    clearInterval(interval);
    try { noise.stop(); } catch { /* noop */ }
  };
}

function startOceanWaves(ctx: AudioContext, dest: AudioNode): StopFn {
  const noise = makeNoiseSource(ctx, "brown");
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 600;
  const g = ctx.createGain();
  g.gain.value = 0.0;
  noise.connect(lp).connect(g).connect(dest);
  noise.start();

  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.linearRampToValueAtTime(0.55, t + 2.0);
    g.gain.linearRampToValueAtTime(0.1, t + 5.5);
  };
  tick();
  const interval = setInterval(tick, 5500);
  return () => {
    stopped = true;
    clearInterval(interval);
    try { noise.stop(); } catch { /* noop */ }
  };
}

function startPianoWake(ctx: AudioContext, dest: AudioNode): StopFn {
  // Triangle wave with pluck envelope approximates a soft piano.
  const chord = [262, 330, 392, 523]; // C major
  let stopped = false;
  const play = () => {
    if (stopped) return;
    const t = ctx.currentTime + 0.02;
    chord.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      const when = t + i * 0.22;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.32, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 2.2);
      osc.connect(g).connect(dest);
      osc.start(when);
      osc.stop(when + 2.3);
    });
  };
  play();
  const interval = setInterval(play, 3600);
  return () => { stopped = true; clearInterval(interval); };
}

function startEmergencyAlarm(ctx: AudioContext, dest: AudioNode): StopFn {
  // Two-tone siren alternating quickly.
  let stopped = false;
  const burst = () => {
    if (stopped) return;
    const t = ctx.currentTime + 0.02;
    tone(ctx, dest, 880, t,        0.32, "square", 0.7);
    tone(ctx, dest, 660, t + 0.34, 0.32, "square", 0.7);
  };
  burst();
  const interval = setInterval(burst, 720);
  return () => { stopped = true; clearInterval(interval); };
}

function makeNoiseSource(ctx: AudioContext, color: "white" | "pink" | "brown"): AudioBufferSourceNode {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if (color === "white") {
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } else if (color === "pink") {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3.5;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}
