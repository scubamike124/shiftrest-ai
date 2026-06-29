// Local-first renderer + voice-provider prefs for the AI Companion.
// Mirrors a row in public.profiles (companion_renderer, companion_tts_provider)
// and persists to localStorage so first paint matches the user's last choice.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CompanionRenderer = "2d" | "3d";
export type CompanionTtsProvider = "openai" | "elevenlabs";

const RENDERER_KEY = "companion.renderer";
const TTS_KEY = "companion.tts.provider";
const ELEVEN_VOICE_KEY = "companion.tts.elevenVoiceId";

// Curated premium voice lineup — 4 personalities, each professionally tuned.
// Picked from the ElevenLabs official voice library (commercially licensed).
export const ELEVEN_VOICES = [
  { id: "EXAVITQu4vr4xnSDxMaL", label: "Sarah", tone: "Calm female · default" },
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George", tone: "Calm male" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", label: "Alice", tone: "Warm British" },
  { id: "XrExE9yKIg1WjnnlVkGX", label: "Matilda", tone: "Soft Australian" },
] as const;
export const DEFAULT_ELEVEN_VOICE = "EXAVITQu4vr4xnSDxMaL";

function readLS(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try { return window.localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writeLS(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent("companion:pref-changed", { detail: { key, value } }));
  } catch { /* ignore */ }
}

export function getRenderer(): CompanionRenderer {
  // Default to 2D after the avatar-pivot. The 3D renderer is opt-in via
  // localStorage or `?avatar=3d` (handled in Avatar.tsx) for internal testing.
  const v = readLS(RENDERER_KEY, "2d");
  return v === "3d" ? "3d" : "2d";
}
export function getTtsProvider(): CompanionTtsProvider {
  // ElevenLabs is now the default premium provider; OpenAI is the auto-fallback.
  const v = readLS(TTS_KEY, "elevenlabs");
  return v === "openai" ? "openai" : "elevenlabs";
}
export function getElevenVoice(): string {
  return readLS(ELEVEN_VOICE_KEY, DEFAULT_ELEVEN_VOICE);
}

export function setRenderer(v: CompanionRenderer) { writeLS(RENDERER_KEY, v); }
export function setTtsProvider(v: CompanionTtsProvider) { writeLS(TTS_KEY, v); }
export function setElevenVoice(v: string) { writeLS(ELEVEN_VOICE_KEY, v); }

export function webglSupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

function useLSValue<T extends string>(key: string, getter: () => T): T {
  const [v, setV] = useState<T>(() => getter());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === key) setV(getter()); };
    const onCustom = (e: Event) => {
      const d = (e as CustomEvent<{ key: string }>).detail;
      if (d?.key === key) setV(getter());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("companion:pref-changed", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("companion:pref-changed", onCustom as EventListener);
    };
  }, [key, getter]);
  return v;
}

export function useRenderer() {
  const value = useLSValue<CompanionRenderer>(RENDERER_KEY, getRenderer);
  const set = useCallback((v: CompanionRenderer) => {
    setRenderer(v);
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      return supabase.from("profiles").update({ companion_renderer: v } as never).eq("id", uid);
    }).catch(() => undefined);
  }, []);
  return { renderer: value, setRenderer: set };
}

export function useTtsProvider() {
  const value = useLSValue<CompanionTtsProvider>(TTS_KEY, getTtsProvider);
  const set = useCallback((v: CompanionTtsProvider) => {
    setTtsProvider(v);
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      return supabase.from("profiles").update({ companion_tts_provider: v } as never).eq("id", uid);
    }).catch(() => undefined);
  }, []);
  return { provider: value, setProvider: set };
}

export function useElevenVoice() {
  const value = useLSValue<string>(ELEVEN_VOICE_KEY, getElevenVoice);
  return { voiceId: value, setVoiceId: setElevenVoice };
}

// Hydrate prefs from the profile row once on app start.
export function hydrateRendererPrefsFromProfile(): void {
  void supabase.auth.getSession().then(async ({ data }) => {
    const uid = data.session?.user?.id;
    if (!uid) return;
    try {
      const { data: row } = await supabase
        .from("profiles")
        .select("companion_renderer, companion_tts_provider")
        .eq("id", uid)
        .maybeSingle();
      const r = (row as { companion_renderer?: string | null } | null)?.companion_renderer;
      const p = (row as { companion_tts_provider?: string | null } | null)?.companion_tts_provider;
      if (r === "2d" || r === "3d") setRenderer(r);
      if (p === "openai" || p === "elevenlabs") setTtsProvider(p);
    } catch { /* best effort */ }
  }).catch(() => undefined);
}
