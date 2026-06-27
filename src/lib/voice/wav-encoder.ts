/**
 * Encode mono Float32 PCM chunks at a source sample rate into a complete
 * 16-bit PCM WAV blob at a target sample rate. Default target is 16 kHz —
 * the smallest size that transcription models reliably accept.
 */
export function encodeWav(chunks: Float32Array[], sourceRate: number, targetRate = 16000): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (total === 0) return new Blob([], { type: "audio/wav" });

  const flat = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    flat.set(c, offset);
    offset += c.length;
  }

  const down = sourceRate === targetRate ? flat : downsample(flat, sourceRate, targetRate);
  const buffer = new ArrayBuffer(44 + down.length * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + down.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  writeString(view, 36, "data");
  view.setUint32(40, down.length * 2, true);

  // PCM samples
  let p = 44;
  for (let i = 0; i < down.length; i++) {
    let s = Math.max(-1, Math.min(1, down[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(p, s, true);
    p += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function downsample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  let oIdx = 0;
  let iIdx = 0;
  while (oIdx < out.length) {
    const nextI = Math.floor((oIdx + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let i = iIdx; i < nextI && i < samples.length; i++) {
      sum += samples[i];
      count++;
    }
    out[oIdx] = count > 0 ? sum / count : 0;
    oIdx++;
    iIdx = nextI;
  }
  return out;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
