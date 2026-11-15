#!/usr/bin/env node
/**
 * Voice-quality benchmark support: renders the same companion lines through
 * each available text-to-speech option, measures time-to-first-byte and total
 * time, estimates cost, and writes anonymised files plus a blind rating sheet.
 * Voice quality is judged by people (blind listening), not by an LLM.
 *
 *   node tests/ai/companion/voice-samples.mjs
 *
 * Runs each option only when its key is set (names only, values never printed):
 *   OPENAI_API_KEY      current default: gpt-4o-mini-tts (shuts down 2027-01-06)
 *   ELEVENLABS_API_KEY  current opt-in: eleven_turbo_v2_5; candidate eleven_flash_v2_5
 *   GEMINI_API_KEY      candidates: gemini-3.8-flash-tts, gemini-3.8-flash-lite-tts
 * Cost: about 1,600 characters per option in total, i.e. well under $0.10 per option.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const LINES = [
  "Take a twenty minute nap now, and set an alarm so you're up well before your seven o'clock shift.",
  "Your ring shows about four hours and fifty minutes of sleep, so tonight's plan protects a longer block after work.",
  "I'd skip the coffee now and have it when your shift starts. Your cutoff is around two in the morning.",
  "Pull over somewhere safe and rest for fifteen minutes. Driving this tired isn't worth the risk.",
  "Good work this week. You hit your sleep goal four nights in a row, even with the overtime.",
  "Dim the lights, put the phone face down, and let's slow your breathing for a minute.",
  "Rough night. A short nap before five should take the edge off without wrecking tonight's sleep.",
  "Want me to walk you through tomorrow's plan, or just set the alarm for three o'clock?",
];

// OpenAI estimates gpt-4o-mini-tts at ~$0.015 per audio minute (~900 spoken characters).
const OPTIONS = [
  { id: "openai-gpt-4o-mini-tts", key: "OPENAI_API_KEY", usdPerChar: 0.015 / 900, render: (t) => openai(t, "gpt-4o-mini-tts", "marin") },
  { id: "elevenlabs-turbo-v2.5", key: "ELEVENLABS_API_KEY", usdPerChar: 0.04 / 1000, render: (t) => eleven(t, "eleven_turbo_v2_5") },
  { id: "elevenlabs-flash-v2.5", key: "ELEVENLABS_API_KEY", usdPerChar: 0.04 / 1000, render: (t) => eleven(t, "eleven_flash_v2_5") },
  { id: "gemini-3.8-flash-tts", key: "GEMINI_API_KEY", usdPerChar: null, usdPerAudioToken: 9 / 1e6, render: (t) => gemini(t, "gemini-3.8-flash-tts") },
  { id: "gemini-3.8-flash-lite-tts", key: "GEMINI_API_KEY", usdPerChar: null, usdPerAudioToken: 6 / 1e6, render: (t) => gemini(t, "gemini-3.8-flash-lite-tts") },
];

async function timed(fetchPromise) {
  const started = Date.now();
  const res = await fetchPromise;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const parts = [];
  let ttfb = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttfb === null) ttfb = Date.now() - started;
    parts.push(value);
  }
  return { bytes: Buffer.concat(parts), ttfb, total: Date.now() - started };
}

function openai(text, model, voice) {
  return timed(fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3", instructions: "Calm, warm sleep coach speaking softly to a friend." }),
  })).then((r) => ({ ...r, ext: "mp3" }));
}

function eleven(text, model) {
  const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  return timed(fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: model }),
  })).then((r) => ({ ...r, ext: "mp3" }));
}

async function gemini(text, model) {
  const r = await timed(fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Say calmly and warmly, like a sleep coach speaking softly to a friend: ${text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
    }),
  }));
  const data = JSON.parse(r.bytes.toString("utf8"));
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("no audio in response");
  const pcm = Buffer.from(part.inlineData.data, "base64");
  const audioTokens = data.usageMetadata?.candidatesTokenCount ?? null;
  return { bytes: wav(pcm, 24000), ttfb: r.ttfb, total: r.total, ext: "wav", audioTokens };
}

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const available = OPTIONS.filter((o) => process.env[o.key]);
if (!available.length) {
  console.log("Voice samples PENDING KEY: set OPENAI_API_KEY, ELEVENLABS_API_KEY and/or GEMINI_API_KEY.");
  process.exit(2);
}
const outDir = path.join(here, "results", `voice-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(outDir, { recursive: true });
const key = {};
const metrics = [];
const shuffled = available.map((o) => ({ o, sort: Math.random() })).sort((a, b) => a.sort - b.sort).map((x) => x.o);
for (const [i, o] of shuffled.entries()) {
  const blind = `voice-${String.fromCharCode(65 + i)}`;
  key[blind] = o.id;
  for (const [n, line] of LINES.entries()) {
    try {
      const r = await o.render(line);
      writeFileSync(path.join(outDir, `${blind}-line${n + 1}.${r.ext}`), r.bytes);
      metrics.push({ option: o.id, line: n + 1, ttfbMs: r.ttfb, totalMs: r.total, chars: line.length, estUsd: o.usdPerChar ? line.length * o.usdPerChar : o.usdPerAudioToken && r.audioTokens ? r.audioTokens * o.usdPerAudioToken : null, audioTokens: r.audioTokens ?? null });
    } catch (e) {
      metrics.push({ option: o.id, line: n + 1, error: e instanceof Error ? e.message : String(e) });
    }
  }
}
writeFileSync(path.join(outDir, "blind-key.json"), JSON.stringify(key, null, 2));
writeFileSync(path.join(outDir, "metrics.json"), JSON.stringify(metrics, null, 2));
writeFileSync(path.join(outDir, "rating-sheet.csv"), ["voice,line,naturalness_1to5,warmth_1to5,clarity_1to5,would_use_yes_no", ...Object.keys(key).flatMap((b) => LINES.map((_, n) => `${b},${n + 1},,,,`))].join("\n"));
for (const o of available) {
  const m = metrics.filter((x) => x.option === o.id && !x.error);
  const med = (k) => m.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(m.length / 2)];
  console.log(`${o.id}: ${m.length}/${LINES.length} ok, TTFB median ${med("ttfbMs")} ms, total median ${med("totalMs")} ms`);
}
console.log(`Samples and blind rating sheet: ${outDir} (open blind-key.json only after rating)`);
