import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Loader2, Play, Square, Volume2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Prefs } from "@/lib/prefs";
import {
  VOICE_OPTIONS,
  LANGUAGE_OPTIONS,
  PERSONALITY_OPTIONS,
  accentsForLanguage,
  type PersonalityKey,
  type VoiceGender,
} from "@/lib/voice/profile";

type Props = {
  prefs: Prefs;
  signedIn: boolean;
  onChange: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
};

const GENDER_FILTERS: { key: "all" | VoiceGender; label: string }[] = [
  { key: "all", label: "All" },
  { key: "female", label: "Female" },
  { key: "male", label: "Male" },
  { key: "neutral", label: "Neutral" },
];

const SPEED_PRESETS = [
  { key: "slow",   label: "Slow",   value: 0.85 },
  { key: "normal", label: "Normal", value: 1.0 },
  { key: "fast",   label: "Fast",   value: 1.2 },
] as const;

export function VoiceSettings({ prefs, signedIn, onChange }: Props) {
  const [genderFilter, setGenderFilter] = useState<(typeof GENDER_FILTERS)[number]["key"]>("all");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [name, setName] = useState(prefs.assistantName);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => setName(prefs.assistantName), [prefs.assistantName]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const filteredVoices = useMemo(
    () =>
      genderFilter === "all"
        ? VOICE_OPTIONS
        : VOICE_OPTIONS.filter((v) => v.gender === genderFilter),
    [genderFilter],
  );

  const accents = accentsForLanguage(prefs.voiceLanguage);
  const language = LANGUAGE_OPTIONS.find((l) => l.code === prefs.voiceLanguage) ?? LANGUAGE_OPTIONS[0];

  async function preview(voiceId: string) {
    if (previewing) {
      audioRef.current?.pause();
      setPreviewing(null);
      return;
    }
    setPreviewing(voiceId);
    try {
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      try { audio.load(); } catch { /* */ }

      const personalizedSample = name && name.trim() && name.trim() !== "RestPilot"
        ? language.sample.replace(/Pilot/g, name.trim())
        : language.sample;

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text: personalizedSample,
          voice: voiceId,
          language: prefs.voiceLanguage,
          accent: prefs.voiceAccent,
          personality: prefs.voicePersonality as PersonalityKey,
          speed: prefs.voiceSpeed,
          instructions: prefs.voiceInstructions ?? undefined,
        }),
      });
      const ct = resp.headers.get("content-type") || "";
      if (!resp.ok || ct.includes("application/json")) {
        let msg = "Voice preview unavailable.";
        try {
          const j = await resp.json();
          msg = j?.message || j?.error || msg;
        } catch { /* */ }
        toast.info(msg);
        setPreviewing(null);
        return;
      }
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      audio.src = url;
      // Match Companion conversation loudness — raw preview audio is hotter
      // than the Companion's gated/soft-clipped path. 0.55 ≈ chat level.
      audio.volume = 0.55;
      audio.onended = () => setPreviewing(null);
      audio.onpause = () => setPreviewing((p) => (p === voiceId ? null : p));
      try {
        await audio.play();
      } catch {
        toast.info("Tap a voice again to play preview.");
        setPreviewing(null);
      }
    } catch (e) {
      console.error("voice preview failed", e);
      toast.error("Voice preview failed.");
      setPreviewing(null);
    }
  }

  return (
    <section id="voice-settings" className="rounded-2xl border border-border bg-card p-4 space-y-6 scroll-mt-20">
      <div className="flex items-center gap-2">
        <Mic className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Pilot voice</h2>
      </div>
      {!signedIn && (
        <p className="text-xs text-muted-foreground">
          Sign in to save voice preferences across devices.
        </p>
      )}

      {/* Pilot name */}
      <div className="space-y-1.5">
        <label htmlFor="pilot-name" className="text-sm font-medium">Pilot name</label>
        <input
          id="pilot-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const trimmed = name.trim() || "RestPilot";
            setName(trimmed);
            if (trimmed !== prefs.assistantName) onChange("assistantName", trimmed);
          }}
          placeholder="Pilot, Luna, Nova, Atlas…"
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          maxLength={40}
        />
        <p className="text-[11px] text-muted-foreground">Used everywhere Pilot speaks.</p>
      </div>

      {/* Gender filter + voice grid */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Voice</label>
          <div className="flex gap-1 rounded-full bg-secondary/60 p-1">
            {GENDER_FILTERS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGenderFilter(g.key)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                  genderFilter === g.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filteredVoices.map((v) => {
            const selected = prefs.voiceId === v.id;
            const isPreviewing = previewing === v.id;
            return (
              <li key={v.id}>
                <div
                  className={`flex items-center justify-between gap-2 rounded-xl border p-3 ${
                    selected ? "border-primary bg-primary/10" : "border-border bg-background"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onChange("voiceId", v.id)}
                    className="flex-1 text-left"
                  >
                    <p className="text-sm font-semibold">{v.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {v.tone} · <span className="capitalize">{v.gender}</span>
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => preview(v.id)}
                    aria-label={isPreviewing ? "Stop preview" : `Preview ${v.label}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground active:scale-95"
                  >
                    {isPreviewing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Language */}
      <div className="space-y-1.5">
        <label htmlFor="voice-language" className="text-sm font-medium">Language</label>
        <select
          id="voice-language"
          value={prefs.voiceLanguage}
          onChange={(e) => {
            onChange("voiceLanguage", e.target.value);
            // Clear accent if not valid for the new language.
            if (prefs.voiceAccent && !accentsForLanguage(e.target.value).includes(prefs.voiceAccent)) {
              onChange("voiceAccent", null);
            }
          }}
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
        >
          {LANGUAGE_OPTIONS.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </div>

      {/* Accent */}
      {accents.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="voice-accent" className="text-sm font-medium">Accent</label>
          <select
            id="voice-accent"
            value={prefs.voiceAccent ?? ""}
            onChange={(e) => onChange("voiceAccent", e.target.value || null)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
          >
            <option value="">Default for language</option>
            {accents.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Accent guidance is applied as TTS style steering — results vary by voice.
          </p>
        </div>
      )}

      {/* Personality */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Personality</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PERSONALITY_OPTIONS.map((p) => {
            const selected = prefs.voicePersonality === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onChange("voicePersonality", p.key)}
                className={`rounded-xl border p-2.5 text-left transition ${
                  selected ? "border-primary bg-primary/10" : "border-border bg-background"
                }`}
              >
                <p className="text-sm font-semibold">{p.label}</p>
                <p className="text-[11px] text-muted-foreground">{p.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Speed */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Speech speed</label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {prefs.voiceSpeed.toFixed(2)}×
          </span>
        </div>
        <div className="flex gap-2">
          {SPEED_PRESETS.map((s) => {
            const selected = Math.abs(prefs.voiceSpeed - s.value) < 0.03;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => onChange("voiceSpeed", s.value)}
                className={`flex-1 rounded-xl border py-2 text-xs font-semibold ${
                  selected ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <input
          type="range"
          min={0.7}
          max={1.4}
          step={0.05}
          value={prefs.voiceSpeed}
          onChange={(e) => onChange("voiceSpeed", Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Speech speed"
        />
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-[11px] text-muted-foreground">
        <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          These settings apply everywhere Pilot speaks — voice briefings, the AI coach, and
          conversational Pilot mode. Preview a voice to hear your selection instantly.
        </span>
      </div>
      {previewing && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Preparing preview…
        </div>
      )}
    </section>
  );
}
