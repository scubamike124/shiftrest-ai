import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic, Phone, MessageCircle, Loader2, Settings2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PilotOrb, type OrbState } from "@/components/PilotOrb";
import { avatarStateLabel } from "@/components/companion/Avatar";
import { useMicRecorder } from "@/lib/voice/useMicRecorder";
import { expandForSpeech } from "@/lib/voice-rewriter";
import { speakQueued, stopSpeaking, prepareVoicePlayback } from "@/lib/companion/speak";
import { fetchCoachHistory, saveCoachMessage, type CoachMsg } from "@/lib/coach-history";
import { Button } from "@/components/ui/button";
import { fetchPrefs } from "@/lib/prefs";

export const Route = createFileRoute("/pilot")({
  head: () => ({
    meta: [
      { title: "Pilot — Talk to your AI companion | RestPilot AI" },
      {
        name: "description",
        content:
          "Pilot is RestPilot's voice-first AI companion. Tap once and have a natural spoken conversation about your shift, sleep, and recovery.",
      },
    ],
  }),
  component: PilotPage,
});

// Strip markdown for the spoken layer. Visible transcript keeps newlines.
function stripMd(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

const FILLERS = [
  "Let me think about that for a second.",
  "One moment while I look at that.",
  "Okay, give me a sec.",
  "Hmm — good question. Hang on.",
  "Got it. Let me think this through.",
  "Alright, one sec.",
];
function pickFiller(): string {
  return FILLERS[Math.floor(Math.random() * FILLERS.length)];
}

/**
 * Split a growing text buffer into spoken-ready chunks at sentence boundaries
 * or after ~80 chars (whichever comes first). Returns [chunks, remainder].
 */
function takeSpeakableChunks(buffer: string, opts: { force?: boolean } = {}): { chunks: string[]; rest: string } {
  const chunks: string[] = [];
  let rest = buffer;
  const re = /([^.!?\n]+?[.!?]+(?:["')\]]+)?|\n+)/g;
  let m: RegExpExecArray | null;
  let lastEnd = 0;
  while ((m = re.exec(rest)) !== null) {
    const piece = rest.slice(lastEnd, m.index + m[0].length);
    const clean = stripMd(piece);
    if (clean.length >= 3) chunks.push(clean);
    lastEnd = m.index + m[0].length;
  }
  rest = rest.slice(lastEnd);
  // Force-flush any long remainder so playback doesn't stall on a final
  // unpunctuated line.
  if (opts.force && rest.trim().length >= 3) {
    const clean = stripMd(rest);
    if (clean.length >= 3) chunks.push(clean);
    rest = "";
  } else if (!opts.force && rest.length > 200) {
    // Failsafe — emit at last whitespace before 200.
    const cut = rest.lastIndexOf(" ", 200);
    if (cut > 60) {
      const head = rest.slice(0, cut);
      const clean = stripMd(head);
      if (clean.length >= 3) chunks.push(clean);
      rest = rest.slice(cut + 1);
    }
  }
  return { chunks, rest };
}

function PilotPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(!!data.session);
    });
    return () => {
      active = false;
    };
  }, []);

  // Load prefs so we can personalize greeting and detect first-run voice setup.
  const { data: prefs } = useQuery({
    queryKey: ["pilot-prefs"],
    queryFn: fetchPrefs,
    staleTime: 60_000,
    enabled: signedIn === true,
  });
  const pilotName = (prefs?.assistantName?.trim() || "Pilot");

  const greeting: CoachMsg = {
    role: "assistant",
    content: signedIn
      ? `Hey — I'm ${pilotName}. Tap the orb and tell me what's on your mind.`
      : "Hey — I'm Pilot. Tap the orb and tell me what's on your mind.",
  };

  const { data: history } = useQuery({
    queryKey: ["coach-history"],
    queryFn: fetchCoachHistory,
    staleTime: 60_000,
    enabled: signedIn === true,
  });

  const [messages, setMessages] = useState<CoachMsg[]>([greeting]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || history === undefined) return;
    if (history.length > 0) setMessages(history.slice(-12));
    setHydrated(true);
  }, [history, hydrated]);

  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [busy, setBusy] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [lastExchange, setLastExchange] = useState<{ user: string; messages: CoachMsg[] } | null>(null);
  const mic = useMicRecorder();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const llmAbortRef = useRef<AbortController | null>(null);


  // === Audio pipeline ===
  // Pilot now routes ALL speech through the shared Companion pipeline
  // (src/lib/companion/speak.ts) so loudness, soft-clip, and Stop semantics
  // match every other screen. The local sentence buffering / barge-in /
  // filler behaviour is preserved; only the playback path changed.
  const cancelledRef = useRef(false);
  const streamingRef = useRef(false);
  // Mirrors speak.ts turn state for UI predicates (canExpand, barge-in).
  const speakingRef = useRef(false);

  // Subscribe to the shared pipeline's status events so the orb reflects
  // playback the same way Companion does.
  useEffect(() => {
    function onStatus(e: Event) {
      const detail = (e as CustomEvent).detail as { status: string; reason?: string };
      if (detail.status === "started") {
        speakingRef.current = true;
        setNeedsTap(false);
        setOrbState("speaking");
      } else if (detail.status === "failed" && detail.reason === "autoplay_blocked") {
        speakingRef.current = false;
        setNeedsTap(true);
      }
    }
    function onTurnEnded() {
      speakingRef.current = false;
      if (!streamingRef.current) setOrbState("idle");
    }
    window.addEventListener("companion:voice-status", onStatus);
    window.addEventListener("companion:turn-ended", onTurnEnded);
    return () => {
      window.removeEventListener("companion:voice-status", onStatus);
      window.removeEventListener("companion:turn-ended", onTurnEnded);
    };
  }, []);

  // Stop the shared pipeline whenever the user leaves the Pilot screen so
  // we don't leak the current turn into another route.
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  const enqueueSpeak = useCallback((text: string) => {
    if (!text || cancelledRef.current) return;
    speakQueued(expandForSpeech(text).slice(0, 1200), { source: "assistant_reply" });
  }, []);

  // Cut current + queued speech (used to drop the filler when the first real
  // sentence arrives). Does NOT abort the in-flight LLM stream.
  const flushQueuedAudio = useCallback(() => {
    stopSpeaking();
  }, []);

  // Full cancel — used by barge-in and error paths. Aborts the LLM AND speech.
  const cancelAllAudio = useCallback(() => {
    cancelledRef.current = true;
    try { llmAbortRef.current?.abort(); } catch { /* */ }
    llmAbortRef.current = null;
    streamingRef.current = false;
    stopSpeaking();
    setNeedsTap(false);
  }, []);




  // Auto-scroll transcript
  useEffect(() => {
    requestAnimationFrame(() => {
      transcriptRef.current?.scrollTo({
        top: transcriptRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [messages]);

  const askPilot = useCallback(
    async (_userText: string, baseMessages: CoachMsg[]) => {
      // Reset audio queue state for this turn (filler may already be queued).
      cancelledRef.current = false;
      streamingRef.current = true;

      setOrbState("thinking");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const ac = new AbortController();
      llmAbortRef.current = ac;
      let resp: Response;
      try {
        resp = await fetch("/api/ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            intent: "coach",
            messages: baseMessages,
            surface: "voice",
            localTime: new Date().toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: ac.signal,
        });
      } catch (e) {
        // Aborted via barge-in is expected — bail quietly.
        streamingRef.current = false;
        if ((e as Error)?.name !== "AbortError") {
          toast.error("Pilot is unavailable.");
        }
        setOrbState("idle");
        return;
      }



      if (!resp.ok || !resp.body) {
        streamingRef.current = false;
        cancelAllAudio();
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        if (resp.status === 429) {
          toast.error("Daily AI limit reached.", {
            action: { label: "Upgrade", onClick: () => (window.location.href = "/paywall") },
          });
        } else {
          toast.error(err.error || "Pilot is unavailable.");
        }
        setOrbState("idle");
        return;
      }

      setMessages([...baseMessages, { role: "assistant", content: "" }]);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistant = "";
      let speakBuffer = "";
      let firstSentenceFired = false;
      let done = false;

      try {
        while (!done) {
          const { done: rDone, value } = await reader.read();
          if (rDone) break;
          if (ac.signal.aborted) break;
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
              const parsed = JSON.parse(json);
              const chunk = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (!chunk) continue;
              assistant += chunk;
              speakBuffer += chunk;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: assistant };
                return next;
              });
              // Pull sentence-sized chunks and dispatch to TTS.
              const { chunks, rest } = takeSpeakableChunks(speakBuffer);
              speakBuffer = rest;
              for (const c of chunks) {
                if (!firstSentenceFired) {
                  // First real sentence — cut the filler audio only (do NOT abort LLM).
                  flushQueuedAudio();
                  cancelledRef.current = false;
                  firstSentenceFired = true;
                }
                void enqueueSpeak(c);
              }
            } catch {
              buffer = line + "\n" + buffer;
              break;
            }
          }
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") console.warn("pilot stream error", e);
      }


      streamingRef.current = false;

      // Flush any trailing un-spoken text.
      const { chunks: tail } = takeSpeakableChunks(speakBuffer, { force: true });
      for (const c of tail) {
        if (!firstSentenceFired) { flushQueuedAudio(); cancelledRef.current = false; firstSentenceFired = true; }

        void enqueueSpeak(c);
      }

      const finalText = assistant.trim();
      if (finalText) {
        if (signedIn) saveCoachMessage("assistant", finalText).catch(() => {});
      } else if (!speakingRef.current) {
        setOrbState("idle");
      }
    },
    [signedIn, enqueueSpeak, cancelAllAudio],
  );

  const onMicTap = useCallback(async () => {
    if (busy) return;
    // Barge-in: stop speaking and reopen the mic.
    if (orbState === "speaking" || speakingRef.current) {
      cancelAllAudio();
      setOrbState("idle");
      return;
    }
    if (needsTap) {
      // Re-arm audio under a fresh user gesture so the next reply plays.
      setNeedsTap(false);
      prepareVoicePlayback();
      return;
    }
    if (orbState === "listening") {
      setBusy(true);
      const blob = await mic.stop();
      await handleRecording(blob);
      return;
    }

    // Arm audio inside the user gesture so iOS Safari lets us play later.
    prepareVoicePlayback();
    setOrbState("listening");
    await mic.start(async (blob) => {
      setBusy(true);
      setOrbState("idle");
      await handleRecording(blob);
    });
  }, [busy, orbState, mic, cancelAllAudio, needsTap]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRecording(blob: Blob | null) {
    try {
      if (!blob) {
        toast.message("Didn't catch that — try again.");
        return;
      }
      setOrbState("thinking");

      // Kick off filler audio IMMEDIATELY so the user hears something within ~1s.
      cancelledRef.current = false;
      streamingRef.current = true;
      void enqueueSpeak(pickFiller());

      // STT in parallel.
      const form = new FormData();
      form.append("file", blob, "recording.wav");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const sttRes = await fetch("/api/stt", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const sttJson = (await sttRes.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!sttRes.ok || !sttJson.text) {
        streamingRef.current = false;
        cancelAllAudio();
        toast.error(sttJson.error || "Couldn't transcribe — try again.");
        setOrbState("idle");
        return;
      }
      const userText = sttJson.text.trim();
      if (userText.length < 2) {
        streamingRef.current = false;
        cancelAllAudio();
        toast.message("That was too short — try again.");
        setOrbState("idle");
        return;
      }
      const userMsg: CoachMsg = { role: "user", content: userText };
      const baseMessages = [...messages, userMsg];
      setMessages(baseMessages);
      setLastExchange({ user: userText, messages: baseMessages });
      if (signedIn) saveCoachMessage("user", userText).catch(() => {});
      await askPilot(userText, baseMessages);
    } finally {
      setBusy(false);
    }
  }

  /** "Tell me more" — re-ask the same turn with expand=true. */
  const tellMeMore = useCallback(async () => {
    if (!lastExchange) return;
    cancelAllAudio();
    cancelledRef.current = false;
    streamingRef.current = true;
    setOrbState("thinking");
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const resp = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        intent: "coach",
        messages: [
          ...lastExchange.messages,
          { role: "user", content: "Tell me more — give me the full breakdown." } as CoachMsg,
        ],
        surface: "voice",
        expand: true,
      }),
    });
    if (!resp.ok || !resp.body) {
      streamingRef.current = false;
      setOrbState("idle");
      toast.error("Couldn't expand that — try asking again.");
      return;
    }
    // Reuse the streaming path by inlining a smaller reader (transcript-only update + speak).
    setMessages((prev) => [...prev, { role: "user", content: "Tell me more." }, { role: "assistant", content: "" }]);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistant = "";
    let speakBuffer = "";
    let firstSentenceFired = false;
    let done = false;
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
          const parsed = JSON.parse(json);
          const chunk = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (!chunk) continue;
          assistant += chunk;
          speakBuffer += chunk;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: assistant };
            return next;
          });
          const { chunks, rest } = takeSpeakableChunks(speakBuffer);
          speakBuffer = rest;
          for (const c of chunks) {
            if (!firstSentenceFired) { flushQueuedAudio(); cancelledRef.current = false; firstSentenceFired = true; }

            void enqueueSpeak(c);
          }
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }
    streamingRef.current = false;
    const { chunks: tail } = takeSpeakableChunks(speakBuffer, { force: true });
    for (const c of tail) {
      if (!firstSentenceFired) { flushQueuedAudio(); cancelledRef.current = false; firstSentenceFired = true; }
      void enqueueSpeak(c);
    }
    if (signedIn && assistant.trim()) saveCoachMessage("assistant", assistant.trim()).catch(() => {});
  }, [lastExchange, cancelAllAudio, enqueueSpeak, signedIn]);

  const orbDisplayState: OrbState = mic.state === "listening" ? "listening" : orbState;
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const canExpand =
    !!lastExchange &&
    !!lastAssistant?.content &&
    orbState === "idle" &&
    !speakingRef.current;

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-gradient-to-b from-background via-background to-primary/5 pb-24">
      <div className="mx-auto max-w-2xl px-4 pt-6 sm:pt-10">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Companion</p>
            <h1 className="text-2xl font-semibold mt-1">{pilotName}</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link to="/coach">
                <MessageCircle className="mr-1.5 h-4 w-4" /> Text
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/profile" hash="voice-settings">
                <Settings2 className="mr-1.5 h-4 w-4" /> Customize
              </Link>
            </Button>

          </div>
        </header>

        {signedIn === false && (
          <div className="mt-6 rounded-xl border border-border bg-card/60 p-4 text-sm">
            <Link to="/auth" className="underline">Sign in</Link> to talk with {pilotName} and save your conversation.
          </div>
        )}



        <div className="flex flex-col items-center mt-10">
          <button
            type="button"
            onClick={onMicTap}
            aria-label={
              orbDisplayState === "listening"
                ? "Stop listening"
                : orbDisplayState === "speaking"
                  ? "Interrupt"
                  : `Talk to ${pilotName}`
            }
            className="outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
          >
            <PilotOrb
              state={orbDisplayState}
              level={mic.level}
            />
            <span className="sr-only">{avatarStateLabel(orbDisplayState)}</span>
          </button>

          <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
            {orbDisplayState === "idle" && (
              <>
                <Mic className="h-4 w-4" />
                Tap the orb and speak naturally.
              </>
            )}
            {orbDisplayState === "listening" && (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                Listening — I'll stop when you pause.
              </>
            )}
            {orbDisplayState === "thinking" && (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
              </>
            )}
            {orbDisplayState === "speaking" && (
              <>
                <Phone className="h-4 w-4" /> Tap the orb to interrupt.
              </>
            )}
          </div>

          {mic.state === "denied" && (
            <p className="mt-3 text-xs text-destructive max-w-sm text-center">
              Microphone permission was denied. Enable it in your browser site settings, then reload.
            </p>
          )}
          {needsTap && (
            <Button size="sm" className="mt-3" onClick={() => { setNeedsTap(false); prepareVoicePlayback(); }}>
              <Phone className="mr-1.5 h-4 w-4" /> Tap to hear reply
            </Button>
          )}
          {canExpand && (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void tellMeMore()}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Tell me more
            </Button>
          )}

          {/* Always-visible discoverability chip for voice personalization. */}
          <Link
            to="/profile"
            hash="voice-settings"
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Voice, language, accent &amp; personality
          </Link>
        </div>


        <section className="mt-10">
          <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Transcript</h2>
          <div
            ref={transcriptRef}
            className="max-h-[40vh] overflow-y-auto space-y-3 rounded-2xl border border-border bg-card/40 p-4"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl bg-primary/15 px-3 py-2 text-sm"
                    : "mr-auto max-w-[85%] rounded-2xl bg-muted/60 px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {m.content || (m.role === "assistant" ? "…" : "")}
              </div>
            ))}
          </div>
        </section>

        <p className="mt-6 text-[10px] text-center text-muted-foreground/70 px-6">
          {pilotName} is an AI sleep & recovery companion — not medical advice. For health concerns, talk to a clinician.
        </p>
      </div>
    </div>
  );
}
