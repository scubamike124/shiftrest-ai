import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, Send, Settings2, Sparkles, Shield, ShieldCheck, Loader2, Square, Volume2, VolumeX, Lock, Volume1, AlertCircle, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchPrefs, savePrefs, type Prefs } from "@/lib/prefs";
import { PilotOrb, type OrbState } from "@/components/PilotOrb";
import { avatarStateLabel } from "@/components/companion/Avatar";
import { useMicRecorder } from "@/lib/voice/useMicRecorder";
import {
  isYes,
  isNo,
} from "@/lib/voice/companion-sound-bridge";
import { parseIntent, type Intent } from "@/lib/voice/intent-router";
import { TRACKS } from "@/lib/sounds/catalog";
import { fetchCompanionHints, listPendingProposals } from "@/lib/memory-proposals";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { DailyBrief } from "@/components/companion/DailyBrief";
import { ActionCard } from "@/components/companion/ActionCard";
import { ActionHistorySheet } from "@/components/companion/ActionHistorySheet";
import {
  describeAction,
  executeAction,
  intentToAction,
  isDestructive,
  type CompanionAction,
} from "@/lib/companion/actions";
import { recordHistory } from "@/lib/companion/action-history";
import { narrate } from "@/lib/companion/narration";
import { BreathingOverlay } from "@/components/sleep/BreathingOverlay";
import { loadLocalPrefs, saveLocalPrefs, type CompanionLocalPrefs } from "@/lib/companion/voice-action-prefs";
import { inQuietHours } from "@/lib/companion/quiet-hours";
import { speak, stopSpeaking, beginSpeakTurn, speakQueued, prepareVoicePlayback } from "@/lib/companion/speak";
import { bulletsToProse } from "@/lib/companion/speech-normalize";
import { track } from "@/lib/companion/analytics";
import { CompanionIntroSheet } from "@/components/companion/CompanionIntroSheet";

import { ThinkingShimmer } from "@/components/companion/ThinkingShimmer";
import { MarkdownMessage } from "@/components/companion/MarkdownMessage";
import { NowPlayingStrip } from "@/components/companion/NowPlayingStrip";
import { WindDownQuickAction } from "@/components/companion/WindDownQuickAction";
import { CompanionQuickGrid, type CompanionQuickActionId } from "@/components/companion/CompanionQuickGrid";

import { DebugHUD } from "@/components/companion/DebugHUD";
import { emitDebug, emitHttpStatus } from "@/lib/companion/debug-bus";
import { useSession } from "@/hooks/use-session";




/** Force-show the morning brief on the companion screen when ?brief=1. */
function forcedMorning(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("brief") === "1";
}

export const Route = createFileRoute("/companion")({
  validateSearch: (s: Record<string, unknown>) => ({
    prompt: typeof s.prompt === "string" ? s.prompt.slice(0, 500) : undefined,
    period:
      s.period === "morning" || s.period === "afternoon" || s.period === "evening"
        ? s.period
        : undefined,
    intro: s.intro === 1 || s.intro === "1" ? (1 as const) : undefined,
    greet: s.greet === 1 || s.greet === "1" ? (1 as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Companion — Your personal AI | RestPilot AI" },
      {
        name: "description",
        content:
          "Meet your RestPilot Companion: a private, on-call AI you can name, talk to, and trust. Foundation release.",
      },
    ],
  }),
  component: CompanionPage,
});

type Msg = {
  role: "user" | "assistant";
  content: string;
  action?: CompanionAction;
  actionDone?: { ok: boolean; message: string } | null;
};

function firstName(p: Prefs, email: string | null): string {
  if (p.partnerName?.trim()) return p.partnerName.trim().split(/\s+/)[0];
  if (email) return email.split("@")[0].split(/[._]/)[0].replace(/^./, (c) => c.toUpperCase());
  return "there";
}

/**
 * Time-aware bedside greeting. Returns a short, calm headline + sub-line.
 * Hours are local to the device; we don't need timezone precision here.
 */
function timeGreeting(name: string): { hi: string; sub: string } {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) {
    return { hi: `Good morning, ${name}.`, sub: "Want help easing into the day?" };
  }
  if (h >= 12 && h < 17) {
    return { hi: `Good afternoon, ${name}.`, sub: "Need a reset before tonight?" };
  }
  if (h >= 17 && h < 22) {
    return { hi: `Good evening, ${name}.`, sub: "Want me to help you wind down?" };
  }
  return { hi: `I'm here, ${name}.`, sub: "Want something quiet to help you sleep?" };
}



function CompanionPage() {
  const qc = useQueryClient();
  const {
    session,
    ready: sessionReady,
    hasSession,
    hasAccessToken,
  } = useSession();
  const sessionEmail = session?.user.email ?? null;
  const signedIn: boolean | null = sessionReady ? hasSession && hasAccessToken : null;

  const prefsQ = useQuery({
    queryKey: ["prefs"],
    queryFn: fetchPrefs,
    enabled: sessionReady && hasSession && hasAccessToken,
  });
  const prefs = prefsQ.data;

  const companionOn = prefs?.assistantMode === "companion";
  const aiName = prefs?.assistantName?.trim() || "RestPilot";
  const memoryOn = Boolean(prefs?.memoryEnabled);

  // Hydration-safe flag: time-aware greeting renders only after mount.
  const [mountedGreeting, setMountedGreeting] = useState(false);
  useEffect(() => { setMountedGreeting(true); }, []);


  const savePref = useMutation({
    mutationFn: (p: Partial<Prefs>) => savePrefs(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prefs"] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Couldn't save"),
  });

  // Chat state — session-local, foundation only.
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Mic for voice input → fills the composer.
  const { state: micState, level, reserved: micReserved, start: micStart, stop: micStop, release: micRelease } = useMicRecorder({ silenceMs: 1000, maxMs: 12_000 });
  const [transcribing, setTranscribing] = useState(false);

  // Slice 4 — sound command bridge. Pending confirmation for low-confidence guesses.
  const navigate = useNavigate();
  const search = useSearch({ from: Route.id });
  const [pendingSoundIntent, setPendingSoundIntent] = useState<Intent | null>(null);
  // Slice 5 — once-per-session memory offer (don't overuse memory in chat).
  const [memoryOfferUsed, setMemoryOfferUsed] = useState(false);
  // Slice 8 — voice + action local prefs.
  const [localPrefs, setLocalPrefs] = useState<CompanionLocalPrefs>(() => loadLocalPrefs());
  useEffect(() => {
    const onChange = () => setLocalPrefs(loadLocalPrefs());
    if (typeof window !== "undefined") {
      window.addEventListener("companion-local-prefs:changed", onChange);
      return () => window.removeEventListener("companion-local-prefs:changed", onChange);
    }
  }, []);
  const updateLocal = (patch: Partial<CompanionLocalPrefs>) => setLocalPrefs(saveLocalPrefs(patch));

  // Pass 3 + Pass 6 — drive emotion state from user/AI signals.
  // We keep a ref to the latest messages so the event handler reads fresh data
  // without re-subscribing on every keystroke.
  const messagesSnapshotRef = useRef<Msg[]>([]);
  useEffect(() => { messagesSnapshotRef.current = messages; }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTurnEnd = async () => {
      const last = messagesSnapshotRef.current.filter((m) => m.role === "assistant").slice(-1)[0];
      const { inferFromText, setEmotion } = await import("@/lib/companion/emotion");
      if (localPrefs.companionMode === "sleep") { setEmotion("sleep"); return; }
      setEmotion(inferFromText(last?.content ?? ""));
    };
    const onStatus = async (e: Event) => {
      const d = (e as CustomEvent<{ status: string }>).detail;
      if (d?.status !== "started") return;
      const { setEmotion } = await import("@/lib/companion/emotion");
      if (localPrefs.companionMode === "sleep") setEmotion("sleep");
      else setEmotion("listening");
    };
    window.addEventListener("companion:turn-ended", onTurnEnd as EventListener);
    window.addEventListener("companion:voice-status", onStatus as EventListener);
    return () => {
      window.removeEventListener("companion:turn-ended", onTurnEnd as EventListener);
      window.removeEventListener("companion:voice-status", onStatus as EventListener);
    };
  }, [localPrefs.companionMode]);

  // Reflect sleep mode immediately even outside of a turn.
  useEffect(() => {
    if (typeof window === "undefined") return;
    void import("@/lib/companion/emotion").then(({ setEmotion }) => {
      if (localPrefs.companionMode === "sleep") setEmotion("sleep");
      else setEmotion("neutral");
    });
  }, [localPrefs.companionMode]);
  // Slice 8 — breathing overlay + action busy state.
  const [breathingOpen, setBreathingOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState<number | null>(null);
  // Phase D — voice playback status from speak.ts events.
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "speaking" | "failed">("idle");
  // Voice-off / quiet-hours / autoplay-blocked banner (never silently skip).
  const [voiceSkipped, setVoiceSkipped] = useState<null | "disabled" | "quiet_hours" | "autoplay_blocked" | "tts_error">(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let failTimer: ReturnType<typeof setTimeout> | null = null;
    let unlocked = false;
    let firstGestureAt = 0;
    const recentFails: number[] = [];
    const onFirstGesture = () => { firstGestureAt = Date.now(); };
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<{ status: string; reason?: string }>).detail;
      if (detail.status === "started") {
        if (failTimer) { clearTimeout(failTimer); failTimer = null; }
        setVoiceStatus("speaking");
        setVoiceSkipped(null);
        recentFails.length = 0;
      } else if (detail.status === "failed") {
        // Only show the persistent "Voice unavailable" banner AFTER audio
        // has been unlocked by a user gesture AND we are past the 750ms
        // grace window that covers the iOS Safari resume race. Pre-unlock
        // and immediately-post-gesture rejections are a browser-policy
        // artifact, not a real failure.
        const now = Date.now();
        const inGrace = firstGestureAt > 0 && now - firstGestureAt < 750;
        recentFails.push(now);
        while (recentFails.length && now - recentFails[0] > 5000) recentFails.shift();
        const persistent = recentFails.length >= 2;
        setVoiceStatus("failed");
        if (unlocked && !inGrace && persistent && (detail.reason === "autoplay_blocked" || detail.reason === "tts_error")) {
          setVoiceSkipped(detail.reason);
        }
        if (failTimer) clearTimeout(failTimer);
        failTimer = setTimeout(() => setVoiceStatus("idle"), 6000);
      } else if (detail.status === "skipped") {
        if (detail.reason === "disabled" || detail.reason === "quiet_hours") {
          setVoiceSkipped(detail.reason);
        }
        setVoiceStatus((s) => (s === "failed" ? s : "idle"));
      } else if (detail.status === "ended") {
        setVoiceStatus((s) => (s === "failed" ? s : "idle"));
      }
    };
    const onUnlock = () => {
      unlocked = true;
      setVoiceSkipped((cur) => (cur === "autoplay_blocked" || cur === "tts_error" ? null : cur));
    };
    window.addEventListener("companion:first-gesture", onFirstGesture);
    window.addEventListener("companion:voice-status", onStatus);
    window.addEventListener("companion:voice-unlocked", onUnlock);
    return () => {
      window.removeEventListener("companion:first-gesture", onFirstGesture);
      window.removeEventListener("companion:voice-status", onStatus);
      window.removeEventListener("companion:voice-unlocked", onUnlock);
      if (failTimer) clearTimeout(failTimer);
    };
  }, []);

  // Phase D — hold-to-talk: cancel-before-send flag for the mic recorder.
  const cancelMicRef = useRef(false);
  // Auto-reopen mic after Aura finishes speaking if the last turn was a voice turn.
  const lastTurnViaVoiceRef = useRef(false);
  const autoReopenMicRef = useRef(false);
  // Slice 10 — TTS playback is now serialized in @/lib/companion/speak.ts.

  const execCtx = {
    signedIn: signedIn === true,
    navigate: (to: string, search?: Record<string, string>) => {
      navigate({ to, search: search ?? undefined } as never).catch(() => undefined);
    },
    openBreathing: () => setBreathingOpen(true),
  };

  // Prefill from ?prompt= once on mount.
  const promptedRef = useRef(false);
  useEffect(() => {
    if (promptedRef.current) return;
    if (search.prompt) {
      promptedRef.current = true;
      setInput(search.prompt);
    }
  }, [search.prompt]);

  // Slice 5 — companion memory awareness (only when memory is enabled).
  const hintsQ = useQuery({
    queryKey: ["companion-hints"],
    queryFn: fetchCompanionHints,
    enabled: signedIn === true && memoryOn,
    staleTime: 60_000,
  });
  const proposalsQ = useQuery({
    queryKey: ["memory-proposals", "pending"],
    queryFn: listPendingProposals,
    enabled: signedIn === true && memoryOn,
    staleTime: 30_000,
  });
  const pendingProposalCount = proposalsQ.data?.length ?? 0;

  useEffect(() => {
    // Priority: listening > speaking > thinking > idle. Speaking wins over
    // "thinking" so the avatar's alive presence is visible the moment audio
    // begins, even while the model is still streaming the rest of its reply.
    if (micState === "listening") setOrbState("listening");
    else if (voiceStatus === "speaking") setOrbState("speaking");
    else if (transcribing || sending) setOrbState("thinking");
    else setOrbState("idle");
  }, [micState, transcribing, sending, voiceStatus]);


  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  // One-time greeting on entry. We render greeting text immediately but DO
  // NOT auto-speak before a user gesture — browsers block autoplay and a
  // failed greeting playback can leave voiceStatus stuck in "speaking",
  // causing the avatar to glow indefinitely. Voice begins on the first tap.
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    if (signedIn !== true) return;
    // Wait for prefs (success or error) so we know the user's name.
    if (!prefsQ.isSuccess && !prefsQ.isError) return;
    if (messages.length > 0) return;
    greetedRef.current = true;
    const name = firstName(prefs ?? ({} as Prefs), sessionEmail);
    const hour = new Date().getHours();
    const opener =
      hour >= 22 || hour < 5
        ? `Hi ${name}, I'm here. Want something calming to help you sleep?`
        : `Hi ${name}, I'm here. How can I help tonight?`;
    setMessages([{ role: "assistant", content: opener }]);
    greetingTextRef.current = opener;
    emitDebug("greet-shown");
    track({ event: "companion_greeting_shown", trigger: search.greet ? "url" : "auto" });
  }, [signedIn, prefs, prefsQ.isSuccess, prefsQ.isError, sessionEmail, messages.length, search.greet]);

  // First user gesture → unlock audio + speak the greeting aloud once.
  // iOS Safari requires playback to start strictly INSIDE a user gesture and
  // only after the AudioContext is genuinely resumed. The previous version
  // called speak() synchronously after prepareVoicePlayback() which raced
  // the unlock signal and produced spurious "autoplay_blocked" failures →
  // the false "Voice unavailable" banner. We now:
  //   1. prime playback,
  //   2. await the `companion:voice-unlocked` event (or a short fallback),
  //   3. then speak the greeting.
  // We also stamp `firstGestureAt` so the voice-status reducer can ignore
  // any failure events that arrive in the first 750ms after the tap.
  const greetingTextRef = useRef<string | null>(null);
  const greetSpokenRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (signedIn !== true) return;
    const onFirstGesture = () => {
      if (greetSpokenRef.current) return;
      greetSpokenRef.current = true;
      window.dispatchEvent(new CustomEvent("companion:first-gesture"));
      prepareVoicePlayback();
      const text = greetingTextRef.current;
      if (!text) return;
      const fire = () => {
        void speak(text, { voice: prefs?.voiceId ?? null, source: "assistant_reply" });
      };
      let done = false;
      const onUnlock = () => {
        if (done) return;
        done = true;
        window.removeEventListener("companion:voice-unlocked", onUnlock);
        fire();
      };
      window.addEventListener("companion:voice-unlocked", onUnlock);
      // Fallback: if unlock event never lands (some Safari versions don't
      // emit it until first playback), fire after 350ms anyway — by then
      // the AudioContext.resume() inside prepareVoicePlayback() has settled.
      window.setTimeout(() => { if (!done) { done = true; window.removeEventListener("companion:voice-unlocked", onUnlock); fire(); } }, 350);
    };
    window.addEventListener("pointerdown", onFirstGesture, { once: true, passive: true });
    window.addEventListener("click", onFirstGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("click", onFirstGesture);
    };
  }, [signedIn, prefs?.voiceId]);

  // Safety: reset voiceStatus on mount so a stale "speaking" from a previous
  // session can't leave the avatar wedged in the glowing speaking state.
  useEffect(() => {
    setVoiceStatus("idle");
  }, []);

  // Watchdog: if we believe we're speaking but no audio-level events arrive
  // for 2.5s, force back to idle. Eliminates any "stuck speaking" path.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let lastLevelAt = performance.now();
    const onLvl = () => { lastLevelAt = performance.now(); };
    window.addEventListener("companion:audio-level", onLvl as EventListener);
    const interval = window.setInterval(() => {
      if (voiceStatus !== "speaking") return;
      if (performance.now() - lastLevelAt > 2500) {
        setVoiceStatus("idle");
      }
    }, 500);
    return () => {
      window.removeEventListener("companion:audio-level", onLvl as EventListener);
      window.clearInterval(interval);
    };
  }, [voiceStatus]);

  // Mic-permission banner state — surfaces a clear message instead of a
  // silent dead-tap when the user has blocked the microphone.
  const [micBannerDismissed, setMicBannerDismissed] = useState(false);
  useEffect(() => {
    if (micState === "denied") {
      track({ event: "mic_permission_denied" });
    } else if (micState === "error") {
      track({ event: "mic_error" });
    }
  }, [micState]);


  async function handleMicTap() {
    if (micState === "listening") {
      await micStop();
      return;
    }
    if (micState === "requesting" || micState === "encoding") return;
    prepareVoicePlayback();
    setInput("");
    cancelMicRef.current = false;
    emitDebug("mic-start");
    await micStart(async (blob) => {
      emitDebug("mic-stop", blob ? `${blob.size}b` : "empty");
      if (cancelMicRef.current) {
        cancelMicRef.current = false;
        return; // user pressed Cancel — discard without transcribing
      }
      if (!blob) {
        toast.info("I didn't catch that. Tap Nova and try again.");
        track({ event: "voice_turn_empty_audio" });
        return;
      }
      setTranscribing(true);
      try {
        const token = session?.access_token;
        if (!token) {
          emitDebug("auth-missing", "stt-no-token");
          toast.info("Please sign in again before using voice input.");
          track({ event: "voice_turn_failed", stage: "auth" });
          return;
        }
        const fd = new FormData();
        fd.append("file", blob, "recording.wav");
        if (prefs?.voiceLanguage) fd.append("language", prefs.voiceLanguage.split("-")[0]);
        emitDebug("stt-req");
        const resp = await fetch("/api/stt", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const json = (await resp.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!resp.ok) {
          emitHttpStatus({ endpoint: "/api/stt", status: resp.status, at: Date.now() });
          emitDebug("stt-fail", `${resp.status}`);
          toast.error(json.error || "Couldn't transcribe");
          track({ event: "voice_turn_failed", stage: "stt" });
          return;
        }
        const text = (json.text || "").trim();
        if (!text) {
          emitDebug("stt-ok", "empty");
          toast.info("I didn't catch any words. You can try again or type it below.");
          track({ event: "voice_turn_empty_transcript" });
          return;
        }
        emitDebug("stt-ok", `${text.length}c`);
        track({ event: "voice_turn_transcribed", chars: text.length });
        setInput(text);
        // Complete the voice loop: transcript → thinking → assistant reply.
        // Previously this only filled the composer, which made Nova appear to
        // stop after listening. Text is still rendered even when TTS is off or fails.
        lastTurnViaVoiceRef.current = true;
        void handleSend(undefined, text);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Voice input failed. You can type instead.");
        track({ event: "voice_turn_failed", stage: "stt" });
      } finally {
        setTranscribing(false);
      }
    });
  }

  // Auto-reopen the mic after Aura finishes speaking so the conversation
  // flows naturally — only when the previous turn was initiated by voice
  // (not text typing), and only when nothing else is in flight.
  const handleMicTapRef = useRef(handleMicTap);
  useEffect(() => { handleMicTapRef.current = handleMicTap; });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTurnEnded = () => {
      if (!lastTurnViaVoiceRef.current) return;
      if (sending || transcribing) return;
      if (micState !== "idle") return;
      lastTurnViaVoiceRef.current = false;
      // Small delay lets the avatar settle to "idle" before re-listening.
      window.setTimeout(() => {
        if (sending || transcribing || micState !== "idle") return;
        void handleMicTapRef.current?.();
      }, 350);
    };
    window.addEventListener("companion:turn-ended", onTurnEnded);
    return () => window.removeEventListener("companion:turn-ended", onTurnEnded);
  }, [sending, transcribing, micState]);

  async function cancelMicCapture() {
    cancelMicRef.current = true;
    await micStop();
  }

  // Phase E — true hold-to-talk with tap-toggle fallback.
  // - pointerdown remembers when the press began
  // - pointerup within HOLD_THRESHOLD_MS = tap (handled by onClick toggle)
  // - pointerup after threshold = release-to-send (stops recording)
  const holdStartRef = useRef<number>(0);
  const heldRef = useRef(false);
  const pointerStartedRecordingRef = useRef(false);
  const HOLD_THRESHOLD_MS = 350;
  function handleMicPointerDown() {
    if (transcribing || sending) return;
    holdStartRef.current = performance.now();
    heldRef.current = false;
    pointerStartedRecordingRef.current = false;
    // If currently idle, start capture eagerly so audio begins under the gesture.
    if (micState === "idle") {
      pointerStartedRecordingRef.current = true;
      void handleMicTap();
    }
  }
  function handleMicPointerUp() {
    if (holdStartRef.current === 0) return;
    const dt = performance.now() - holdStartRef.current;
    holdStartRef.current = 0;
    if (dt >= HOLD_THRESHOLD_MS && micState === "listening") {
      heldRef.current = true;
      void micStop(); // release sends
    }
    // Otherwise let the click handler toggle (tap behavior).
  }
  function handleMicClick() {
    // Pointer-down already started this tap/hold gesture. Do not let the
    // follow-up click immediately stop the recorder, especially on mobile.
    if (pointerStartedRecordingRef.current) {
      pointerStartedRecordingRef.current = false;
      return;
    }
    // Suppress the synthetic click that follows a hold-release.
    if (heldRef.current) {
      heldRef.current = false;
      return;
    }
    void handleMicTap();
  }

  // Slice 10 — assistant TTS helper. Delegates to the centralized speak()
  // gate which enforces voice prefs, quiet hours, and cancel-prior policy.
  async function speakIfEnabled(text: string) {
    await speak(text, { voice: prefs?.voiceId ?? null, source: "assistant_reply" });
  }

  /** Phase D — replay an assistant message via the existing speak() gate. */
  function replayMessage(text: string) {
    void speak(text, { voice: prefs?.voiceId ?? null, source: "manual" });
  }


  // Slice 9 — central confirm path: record history (executing → completed/failed)
  // and narrate the outcome (when voice replies are allowed).
  async function runAction(action: CompanionAction): Promise<ReturnType<typeof executeAction> extends Promise<infer R> ? R : never> {
    const d = describeAction(action);
    track({ event: "action_started", kind: action.kind, destructive: isDestructive(action) });
    recordHistory({ kind: action.kind, label: d.title, status: "executing", message: "Working…", snapshot: action });
    const result = await executeAction(action, execCtx);
    recordHistory({
      kind: action.kind,
      label: d.title,
      status: result.ok ? "completed" : "failed",
      message: result.message,
      errorKind: result.error?.kind,
      snapshot: action,
    });
    if (result.ok) {
      track({ event: "action_completed", kind: action.kind });
    } else {
      track({ event: "action_failed", kind: action.kind, reason: result.error?.kind });
    }
    void speakIfEnabled(narrate(action, result));
    return result;
  }

  async function confirmAction(messageIndex: number) {
    const msg = messages[messageIndex];
    if (!msg?.action) return;
    setActionBusy(messageIndex);
    try {
      const result = await runAction(msg.action);
      setMessages((cur) =>
        cur.map((m, i) => (i === messageIndex ? { ...m, actionDone: result } : m)),
      );
    } finally {
      setActionBusy(null);
    }
  }
  function cancelAction(messageIndex: number) {
    const msg = messages[messageIndex];
    if (msg?.action) {
      const d = describeAction(msg.action);
      recordHistory({ kind: msg.action.kind, label: d.title, status: "cancelled", message: "Cancelled.", snapshot: msg.action });
      track({ event: "action_cancelled", kind: msg.action.kind });
    }
    setMessages((cur) =>
      cur.map((m, i) =>
        i === messageIndex ? { ...m, actionDone: { ok: false, message: "Cancelled." } } : m,
      ),
    );
  }

  /** Slice 9 — retry from action history. Re-proposes the action as a fresh card. */
  function handleRetry(action: CompanionAction) {
    const d = describeAction(action);
    setMessages((cur) => [
      ...cur,
      { role: "assistant", content: `Retrying: ${d.title}`, action, actionDone: null },
    ]);
  }

  /** Push an assistant message that proposes an action (with confirmation card). */
  function proposeAction(base: Msg[], action: CompanionAction, leading?: string) {
    const d = describeAction(action);
    const content = leading ?? d.title;
    setMessages([...base, { role: "assistant", content, action, actionDone: null }]);
    void speakIfEnabled(content);
  }

  function handleQuickAction(id: CompanionQuickActionId) {

    switch (id) {
      case "fall_asleep":
      case "calm_down":
        setBreathingOpen(true);
        return;
      case "sleep_sounds":
        navigate({ to: "/sleep" }).catch(() => undefined);
        return;
      case "review_sleep":
        navigate({ to: "/health" }).catch(() => undefined);
        return;
      case "plan_morning":
        void handleSend(undefined, "Plan my morning");
        return;
      case "smart_alarm":
        void handleSend(undefined, "Help me set a smart alarm for tomorrow");
        return;
    }
  }

  async function handleSend(e?: React.FormEvent, override?: string) {

    const fromForm = !!e;
    e?.preventDefault();
    const text = (override ?? input).trim();
    if (fromForm) lastTurnViaVoiceRef.current = false;
    // Gate only on send-in-flight and empty text. companionOn used to gate
    // here, which silently swallowed every voice turn for users who hadn't
    // toggled Companion Mode on — root cause of "Nova never replies".
    if (!text || sending) return;
    const baseMessages: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(baseMessages);
    setInput("");
    // Phase E — clear any prior "Voice unavailable" badge as a new turn begins.
    setVoiceStatus((s) => (s === "failed" ? "idle" : s));


    // Pending text-based yes/no fallback (kept for accessibility & voice flows).
    if (pendingSoundIntent) {
      if (isYes(text)) {
        const action = intentToAction(pendingSoundIntent);
        setPendingSoundIntent(null);
        if (action) {
          const result = await runAction(action);
          setMessages([
            ...baseMessages,
            { role: "assistant", content: result.message, action, actionDone: result },
          ]);
        }
        return;
      }
      if (isNo(text)) {
        setPendingSoundIntent(null);
        const reply = "Okay, cancelled.";
        setMessages([...baseMessages, { role: "assistant", content: reply }]);
        void speakIfEnabled(reply);
        return;
      }
      setPendingSoundIntent(null);
    }

    // Slice 8 — action-first routing. Parse intent; if it maps to a known action
    // and suggestions are enabled, propose it (never auto-execute when
    // requireActionConfirmation is on).
    if (localPrefs.actionSuggestionsEnabled) {
      try {
        const parsed = parseIntent(text);
        const favoriteSlug = hintsQ.data?.favoriteSoundTrack;
        const wantsBedtime =
          parsed.intent.kind === "sleep_mode" || parsed.intent.kind === "goodnight";

        // Memory-aware bedtime offer (once per session).
        if (memoryOn && !memoryOfferUsed && wantsBedtime && favoriteSlug) {
          const track = TRACKS.find((t) => t.slug === favoriteSlug);
          if (track) {
            setMemoryOfferUsed(true);
            proposeAction(
              baseMessages,
              { kind: "play_track", slug: track.slug, label: track.label },
              `You usually use ${track.label} before bed. Want me to start it?`,
            );
            return;
          }
        }

        const action = intentToAction(parsed.intent);
        if (action && parsed.confidence >= 0.6) {
          // Compound: "play rain for 30 minutes" → add timer minutes to action.
          if (action.kind === "play_track") {
            const m = text.match(/\bfor\s+(\d{1,3})\s*(?:min|mins|minute|minutes|m)\b/i)
              ?? text.match(/\b(\d{1,3})\s*(?:min|mins|minute|minutes|m)\b/i);
            if (m) {
              const minutes = Math.max(1, Math.min(180, parseInt(m[1], 10)));
              proposeAction(baseMessages, { ...action, minutes });
              return;
            }
          }
          // Slice 9 — auto-run only when: confirmations off, action is non-destructive, AND it's navigation.
          if (
            !localPrefs.requireActionConfirmation &&
            !isDestructive(action) &&
            describeAction(action).isNavigation
          ) {
            const result = await runAction(action);
            setMessages([
              ...baseMessages,
              { role: "assistant", content: result.message, action, actionDone: result },
            ]);
            return;
          }
          proposeAction(baseMessages, action);
          return;
        }
      } catch (err) {
        console.warn("[companion] intent parse error", err);
      }
    }

    setSending(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;



    try {
      const token = session?.access_token;
      if (!token) {
        emitDebug("auth-missing", "ai-no-token");
        toast.info("Please sign in again before messaging your Companion.");
        setMessages([
          ...baseMessages,
          {
            role: "assistant",
            content: "I need your signed-in session before I can reach the AI backend. Please sign in again, then try once more.",
          },
        ]);
        track({ event: "voice_turn_failed", stage: "auth" });
        return;
      }
      emitDebug("ai-req");
      const resp = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: ac.signal,
        body: JSON.stringify({
          intent: "coach",
          messages: baseMessages,
          surface: "voice",
          context: { surface: "companion", companion_name: aiName, max_tokens: 180 },
        }),
      });

      if (!resp.ok || !resp.body) {
        emitHttpStatus({ endpoint: "/api/ai", status: resp.status, at: Date.now() });
        emitDebug("ai-fail", `${resp.status}`);
        const errJson = (await resp.json().catch(() => ({}))) as { error?: string };
        const fallback =
          resp.status === 429
            ? "You've reached today's AI limit. I saved what you said here, and you can keep typing or upgrade for more conversations."
            : "I heard you, but I couldn't reach my AI brain just now. Your message is still here — try again in a moment or type below.";
        if (resp.status === 429) {
          toast.error("Daily AI limit reached.", {
            description: "Upgrade for unlimited conversations.",
            action: { label: "Upgrade", onClick: () => { window.location.href = "/paywall"; } },
          });
        } else {
          toast.error(errJson.error || "Companion is unavailable");
        }
        setMessages([...baseMessages, { role: "assistant", content: fallback }]);
        track({ event: "voice_turn_failed", stage: "ai" });
        return;
      }

      setMessages([...baseMessages, { role: "assistant", content: "" }]);
      // Phase D — early speech: start a fresh TTS turn, then enqueue the
      // first complete sentence as soon as it streams in. Remaining text
      // is enqueued after streaming completes; chunks play sequentially.
      beginSpeakTurn();
      let spokenChars = 0;
      // Flush on sentence boundary, but only AFTER we've buffered a real
      // chunk (~220 chars OR a paragraph break). Smaller flushes mean more
      // serial TTS round-trips → dead air between bullets. We also run
      // `bulletsToProse()` over the unspoken tail before searching for a
      // boundary so list markers and "header:" patterns don't fragment
      // playback into one-line clips.
      const SENTENCE_RE = /[.!?][\s)\]"']*\s/;
      const PARAGRAPH_RE = /\n\s*\n/;
      const MIN_FLUSH_CHARS = 220;
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistant = "";
      let done = false;

      const flushReady = (force: boolean) => {
        // Only call after assistant updates; flushes one chunk at a time.
        while (true) {
          const rawTail = assistant.slice(spokenChars);
          if (!rawTail.trim()) return;
          // Prefer a paragraph break — natural breath, large chunk.
          const pIdx = rawTail.search(PARAGRAPH_RE);
          if (pIdx !== -1) {
            const cutLen = pIdx + (rawTail.slice(pIdx).match(PARAGRAPH_RE)?.[0].length ?? 2);
            const segment = bulletsToProse(rawTail.slice(0, cutLen)).trim();
            spokenChars += cutLen;
            if (segment) speakQueued(segment, { voice: prefs?.voiceId ?? null, source: "assistant_reply" });
            continue;
          }
          // Otherwise wait until we have a sentence boundary past the min.
          if (rawTail.length < MIN_FLUSH_CHARS && !force) return;
          const m = rawTail.match(SENTENCE_RE);
          if (!m || m.index === undefined) {
            if (!force) return;
            const segment = bulletsToProse(rawTail).trim();
            spokenChars += rawTail.length;
            if (segment) speakQueued(segment, { voice: prefs?.voiceId ?? null, source: "assistant_reply" });
            return;
          }
          // Don't flush a tiny first sentence; wait for more material.
          if (m.index + m[0].length < MIN_FLUSH_CHARS && !force) return;
          const cutLen = m.index + m[0].length;
          const segment = bulletsToProse(rawTail.slice(0, cutLen)).trim();
          spokenChars += cutLen;
          if (segment) speakQueued(segment, { voice: prefs?.voiceId ?? null, source: "assistant_reply" });
        }
      };

      while (!done) {
        const { done: rDone, value } = await reader.read();
        if (rDone) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const evt = JSON.parse(json) as { choices?: { delta?: { content?: string } }[] };
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) {
              if (!assistant) emitDebug("ai-first-token");
              assistant += delta;
              setMessages([...baseMessages, { role: "assistant", content: assistant }]);
              flushReady(false);
            }
          } catch { /* noop */ }
        }
      }
      // Flush whatever's left — force=true ignores the min-size gate.
      flushReady(true);
      emitDebug("ai-done", `${assistant.length}c`);

    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") {
        emitDebug("ai-fail", (e as { message?: string })?.message ?? "err");
        toast.error(e instanceof Error ? e.message : "Something went wrong");
        setMessages([
          ...baseMessages,
          {
            role: "assistant",
            content:
              "I heard you, but the connection dropped before I could answer. Try again in a moment or type below.",
          },
        ]);
        track({ event: "voice_turn_failed", stage: "ai" });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    stopSpeaking();
    setSending(false);
  }

  function handleHardReset() {
    abortRef.current?.abort();
    stopSpeaking();
    setSending(false);
    setTranscribing(false);
    setVoiceStatus("idle");
    setOrbState("idle");
    setMessages([]);
    setInput("");
    emitDebug("reset");
  }

  // ─── Render ─────────────────────────────────────────────────────
  if (signedIn === null) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-12 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <h1 className="text-2xl font-semibold">Checking your secure session</h1>
        <p className="text-sm text-muted-foreground">
          Nova will not call any protected backend service until your Supabase session and auth token are loaded.
        </p>
        <DebugHUD
          signedIn={null}
          companionOn={false}
          prefsLoaded={false}
          micState="not-mounted"
          voiceStatus="not-mounted"
          orbState="auth-loading"
          greetShown={false}
          onReset={handleHardReset}
        />
      </main>
    );
  }

  if (signedIn === false) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-12 text-center">
        <Sparkles className="h-10 w-10 text-primary" />
        <h1 className="text-2xl font-semibold">Sign in to meet your Companion</h1>
        <p className="text-sm text-muted-foreground">
          Your private AI needs an authenticated session before it can load personal guidance.
        </p>
        <Button asChild><Link to="/auth">Sign in</Link></Button>
        <DebugHUD
          signedIn={false}
          companionOn={false}
          prefsLoaded={false}
          micState="not-mounted"
          voiceStatus="not-mounted"
          orbState="signed-out"
          greetShown={false}
          onReset={handleHardReset}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-6 sm:max-w-lg">
      {/* Header */}
      <header className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">Companion</p>
          <h1 className="text-xl font-semibold leading-tight">{aiName}</h1>
        </div>
        <div className="flex items-center gap-1">
          <ActionHistorySheet onRetry={handleRetry} />
          <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Companion settings">
              <Settings2 className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
            <SheetHeader className="text-left">
              <SheetTitle>Companion settings</SheetTitle>
              <SheetDescription>Foundation controls. Advanced memory and integrations come later.</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="companion-toggle" className="text-sm font-medium">Companion Mode</Label>
                  <p className="text-xs text-muted-foreground">Warmer tone, follow-up questions, personal presence.</p>
                </div>
                <Switch
                  id="companion-toggle"
                  checked={companionOn}
                  onCheckedChange={(v) =>
                    savePref.mutate({ assistantMode: v ? "companion" : "coach" })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-name" className="text-sm font-medium">Your AI&apos;s name</Label>
                <Input
                  id="ai-name"
                  defaultValue={aiName}
                  maxLength={40}
                  placeholder="RestPilot"
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim() || "RestPilot";
                    if (v !== aiName) savePref.mutate({ assistantName: v });
                  }}
                />
                <p className="text-xs text-muted-foreground">Up to 40 characters. Used in greetings and replies.</p>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 p-3">
                <div>
                  <Label htmlFor="memory-toggle" className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" /> Memory consent
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Off by default. When on, your Companion may remember the things you confirm. Review or delete anything in{" "}
                    <Link to="/memory" className="underline">Memory</Link>.
                  </p>
                </div>
                <Switch
                  id="memory-toggle"
                  checked={memoryOn}
                  onCheckedChange={(v) => savePref.mutate({ memoryEnabled: v })}
                />
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <p className="text-sm font-medium">Voice &amp; actions</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Mic is only used when you tap it. No background listening.
                </p>
                <div className="mt-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="va-voice-in" className="text-sm">Voice input</Label>
                    <Switch
                      id="va-voice-in"
                      checked={localPrefs.voiceInputEnabled}
                      onCheckedChange={(v) => updateLocal({ voiceInputEnabled: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="va-voice-out" className="text-sm">Voice replies</Label>
                    <Switch
                      id="va-voice-out"
                      checked={localPrefs.voiceRepliesEnabled}
                      onCheckedChange={(v) => updateLocal({ voiceRepliesEnabled: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="va-actions" className="text-sm">Action suggestions</Label>
                    <Switch
                      id="va-actions"
                      checked={localPrefs.actionSuggestionsEnabled}
                      onCheckedChange={(v) => updateLocal({ actionSuggestionsEnabled: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="va-confirm" className="text-sm">Always confirm before acting</Label>
                    <Switch
                      id="va-confirm"
                      checked={localPrefs.requireActionConfirmation}
                      onCheckedChange={(v) => updateLocal({ requireActionConfirmation: v })}
                    />
                  </div>
                  <Link to="/settings/companion" className="block text-xs text-primary underline">
                    More voice &amp; quiet-hours settings →
                  </Link>
                </div>
              </div>

              <div className="rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Privacy</p>
                <p className="mt-1">
                  Conversations stay on your account. We never sell your data.{" "}
                  <Link to="/legal/privacy" className="underline">Privacy policy</Link>
                </p>
              </div>
            </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Trust strip — reassures users that the Companion is private & opt-in. */}
      <div
        className="mb-3 flex flex-wrap items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-2 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm"
        aria-label="Privacy summary"
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-0.5">
          <Lock className="h-3 w-3 text-indigo-glow" aria-hidden />
          <span className="font-medium text-foreground/90">Private</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-0.5">
          <ShieldCheck className={cn("h-3 w-3", memoryOn ? "text-emerald-400" : "text-muted-foreground")} aria-hidden />
          <span className="font-medium text-foreground/90">Memory {memoryOn ? "On" : "Off"}</span>
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors",
            micState === "listening"
              ? "bg-rose-500/20 text-rose-100"
              : micReserved
                ? "bg-emerald-500/15 text-emerald-100"
                : "bg-background/60",
          )}
          aria-live="polite"
        >
          {localPrefs.voiceInputEnabled ? (
            <Mic className={cn("h-3 w-3", micState === "listening" ? "text-rose-300 animate-pulse" : micReserved ? "text-emerald-300" : "text-indigo-glow")} aria-hidden />
          ) : (
            <MicOff className="h-3 w-3 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium text-foreground/90">
            {micState === "listening"
              ? "Mic on • listening"
              : micReserved
                ? "Mic ready"
                : "Mic only when you tap"}
          </span>
          {micReserved && micState !== "listening" && (
            <button
              type="button"
              onClick={() => { micRelease(); toast.success("Microphone released."); }}
              className="ml-1 rounded-full px-1.5 text-[10px] font-semibold text-emerald-200 underline-offset-2 hover:underline"
              aria-label="Release microphone"
            >
              Release
            </button>
          )}
        </span>
      </div>

      {/* First-launch Companion intro (auto-shown once per device). */}
      <CompanionIntroSheet />

      {/* Mic permission blocked — clear, dismissible, never a silent failure. */}
      {micState === "denied" && !micBannerDismissed && (
        <div
          role="status"
          className="mb-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <div className="flex-1">
            <p className="font-semibold">Microphone is blocked.</p>
            <p className="mt-0.5 text-amber-100/80">
              Enable mic access in your browser settings — or just type below, it works the same.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMicBannerDismissed(true)}
            className="rounded-full p-1 text-amber-200/80 hover:bg-amber-500/20 hover:text-amber-100"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Companion orb + greeting */}
      <section className="flex flex-col items-center gap-3 pb-4 pt-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              emitDebug("tap", `mic=${micState}`);
              if (!localPrefs.voiceInputEnabled || micState === "denied") {
                track({ event: "avatar_tap_to_talk", result: "fallback" });
                const el = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
                  '[data-companion-composer] textarea, [data-companion-composer] input',
                );
                el?.focus();
                return;
              }
              track({
                event: "avatar_tap_to_talk",
                result: micState === "listening" ? "stopped" : "started",
              });
              void handleMicTap();
            }}
            className="rounded-full transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={
              micState === "listening" ? "Stop listening" : `Tap to talk — ${avatarStateLabel(orbState)}`
            }
            aria-pressed={micState === "listening"}
          >
            <PilotOrb state={orbState} level={level} />
          </button>
        </div>
        {/* Reserved presence slot — fixed height prevents column reflow. */}
        <div className="mt-2 flex h-9 items-center justify-center">
          {voiceStatus === "speaking" ? (
            <button
              type="button"
              onClick={() => {
                stopSpeaking();
                setVoiceStatus("idle");
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-xs font-medium text-primary-foreground shadow-sm transition active:scale-[0.97]"
              aria-label="Stop speaking"
            >
              <Square className="h-3 w-3" aria-hidden />
              Stop
            </button>
          ) : voiceStatus === "failed" ? (
            <p
              role="status"
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-200"
            >
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />
              Voice unavailable — text still works
            </p>
          ) : null}
        </div>


        {voiceSkipped && (
          <button
            type="button"
            onClick={() => {
              if (voiceSkipped === "disabled") {
                updateLocal({ voiceRepliesEnabled: true });
                setVoiceSkipped(null);
                toast.success("Aura's voice is on.");
                // Replay the last assistant message so the user immediately hears voice.
                const last = [...messages].reverse().find((m) => m.role === "assistant");
                if (last?.content) {
                  prepareVoicePlayback();
                  void speak(last.content, { voice: prefs?.voiceId ?? null, source: "manual" });
                }
              } else {
                setVoiceSkipped(null);
              }
            }}
            className="mx-auto mt-2 flex max-w-[20rem] items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-left text-xs text-foreground/90 transition hover:bg-primary/15"
          >
            <VolumeX className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1">
              {voiceSkipped === "disabled" && (
                <>🔇 Voice is currently turned off. <span className="font-medium underline">Tap here to enable Aura's voice.</span></>
              )}
              {voiceSkipped === "quiet_hours" && (
                <>🌙 Quiet Hours is on — Aura is staying silent. Adjust in settings if you'd like voice back.</>
              )}
              {voiceSkipped === "autoplay_blocked" && (
                <>🔈 Your browser blocked autoplay. Tap Aura once to unlock voice playback.</>
              )}
              {voiceSkipped === "tts_error" && (
                <>⚠️ Voice playback hit an error. Text is still here — try again or check your connection.</>
              )}
            </span>
          </button>
        )}




        <div className="mt-4 text-center">
          {(() => {
            const name = firstName(prefs ?? ({} as Prefs), sessionEmail);
            // mountedGreeting is set in a useEffect below — server and first
            // client render show a time-neutral greeting so hydration matches;
            // the time-aware one appears one frame later.
            const g = mountedGreeting
              ? timeGreeting(name)
              : { hi: `Hi, ${name}.`, sub: "" };
            return (
              <>
                <p className="text-base font-medium">{g.hi}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {companionOn ? g.sub : "Turn on Companion Mode to start chatting."}
                </p>
              </>
            );
          })()}
        </div>


      </section>

      {/* Slice 5 — pending memory proposals (non-intrusive). */}
      {memoryOn && pendingProposalCount > 0 && (
        <Link
          to="/memory"
          className="mb-1 inline-flex items-center justify-center gap-2 self-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/15"
        >
          <Sparkles className="h-3 w-3" />
          {pendingProposalCount === 1
            ? "1 thing to remember →"
            : `${pendingProposalCount} things to remember →`}
        </Link>
      )}

      {/* Slice 7 — Smart Day & Evening Intelligence: time-of-day brief */}
      {signedIn === true && prefsQ.isSuccess && prefs?.onboarded && (
        <DailyBrief
          prefs={prefs ?? null}
          signedIn={true}
          forcedPeriod={search.period ?? (forcedMorning() ? "morning" : undefined)}
        />
      )}


      {/* Companion off — gentle CTA */}
      {!companionOn && (
        <Card className="mt-2 border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Meet your Companion</p>
              <p className="mt-1 text-xs text-muted-foreground">
                A warmer, on-call AI that knows your rest patterns. You can turn it off anytime.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => savePref.mutate({ assistantMode: "companion" })}
              disabled={savePref.isPending}
            >
              Turn on
            </Button>
          </div>
        </Card>
      )}

      {/* Conversation list */}
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={sending}
        className={cn(
          "mt-4 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-border/40 bg-background/40 p-3",
          !companionOn && "opacity-60",
        )}
        style={{ minHeight: 220 }}
      >
        {messages.length === 0 && (
          <div className="space-y-4 px-1 py-2">
            {companionOn ? (
              <>
                <WindDownQuickAction onStart={() => setBreathingOpen(true)} />
                <div>
                  <p className="mb-3 text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
                    Quick actions
                  </p>
                  <CompanionQuickGrid
                    disabled={sending}
                    onAction={(id) => handleQuickAction(id)}
                  />
                </div>
              </>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                Conversations are paused while Companion Mode is off.
              </p>
            )}
          </div>
        )}

        {companionOn && messages.length >= 2 && messages.length <= 6 && (
          <div className="sticky top-0 z-10 -mx-1 mb-1 bg-gradient-to-b from-background/80 to-transparent px-1 pb-2 pt-1 backdrop-blur-sm">
            <CompanionQuickGrid
              compact
              disabled={sending}
              onAction={(id) => handleQuickAction(id)}
            />
          </div>
        )}


        {messages.map((m, i) => (
          <div key={i} className={cn("flex flex-col", m.role === "user" ? "items-end" : "items-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                m.role === "user"
                  ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <MarkdownMessage content={m.content} />
                ) : sending && i === messages.length - 1 ? (
                  <ThinkingShimmer />
                ) : null
              ) : (
                m.content
              )}
            </div>

            {m.role === "assistant" && m.content && !(sending && i === messages.length - 1) && (
              <button
                type="button"
                onClick={() => replayMessage(m.content)}
                className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-muted-foreground transition hover:text-foreground"
                aria-label="Replay this reply"
                title="Replay"
              >
                <Volume1 className="h-3 w-3" />
                Replay
              </button>
            )}

            {m.role === "assistant" && m.action && (
              <div className="w-full max-w-[85%]">
                <ActionCard
                  action={m.action}
                  busy={actionBusy === i}
                  done={m.actionDone ?? null}
                  onConfirm={() => confirmAction(i)}
                  onCancel={() => cancelAction(i)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Voice-replies status badge */}
      {companionOn && (
        <div
          className="mt-2 flex items-center justify-center gap-2 text-[11px] text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {micState === "listening" ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
              Listening… release to send
            </>
          ) : transcribing ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Transcribing…
            </>
          ) : voiceStatus === "speaking" ? (
            <>
              <Volume2 className="h-3 w-3 text-primary animate-pulse" />
              Speaking…
            </>
          ) : voiceStatus === "failed" ? (
            <>
              <AlertCircle className="h-3 w-3 text-destructive" />
              Voice unavailable — reply shown in chat
            </>
          ) : localPrefs.voiceRepliesEnabled ? (
            <>
              <Volume2 className="h-3 w-3 text-primary" />
              Voice replies on
              {inQuietHours(localPrefs.quietHours) ? " — muted during quiet hours" : ""}
            </>
          ) : (
            <>
              <VolumeX className="h-3 w-3" />
              Voice replies off — replies appear in chat
            </>
          )}
        </div>
      )}

      {/* Now-playing strip — visible only when sounds are active. */}
      <NowPlayingStrip />

      {/* Composer */}
      <form onSubmit={handleSend} className="mt-3 flex items-end gap-2">
        {localPrefs.voiceInputEnabled && (
          <Button
            type="button"
            variant={micState === "listening" ? "default" : "outline"}
            size="icon"
            className={cn(
              "h-11 w-11 shrink-0 transition",
              micState === "listening" && "bg-rose-500 text-white shadow-[0_0_0_4px_rgba(244,63,94,0.18)] hover:bg-rose-500",
            )}
            aria-label={micState === "listening" ? "Stop recording" : "Hold or tap to talk"}
            aria-pressed={micState === "listening"}
            disabled={transcribing || sending}
            onClick={handleMicClick}
            onPointerDown={handleMicPointerDown}
            onPointerUp={handleMicPointerUp}
            onPointerCancel={handleMicPointerUp}
          >
            {transcribing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
          </Button>
        )}
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Message your Companion"
          disabled={sending}
          className="h-11"
          inputMode="text"
          autoComplete="off"
        />
        {sending ? (
          <Button type="button" size="icon" variant="secondary" className="h-11 w-11 shrink-0" aria-label="Stop" onClick={handleStop}>
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" className="h-11 w-11 shrink-0" aria-label="Send" disabled={!input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
      {micState === "listening" && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void cancelMicCapture()}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
          <span className="text-[11px] text-muted-foreground">or tap mic to send</span>
        </div>
      )}

      <BreathingOverlay open={breathingOpen} onClose={() => setBreathingOpen(false)} />

      <DebugHUD
        signedIn={signedIn}
        companionOn={companionOn}
        prefsLoaded={prefsQ.isSuccess || prefsQ.isError}
        micState={micState}
        voiceStatus={voiceStatus}
        orbState={orbState}
        greetShown={greetedRef.current}
        companionMode={localPrefs.companionMode ?? "normal"}
        onReset={handleHardReset}
      />

    </main>
  );
}
