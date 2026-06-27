import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic, Phone, MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PilotOrb, type OrbState } from "@/components/PilotOrb";
import { useMicRecorder } from "@/lib/voice/useMicRecorder";
import { useTtsPlayer } from "@/lib/voice/useTtsPlayer";
import { expandForSpeech } from "@/lib/voice-rewriter";
import { fetchCoachHistory, saveCoachMessage, type CoachMsg } from "@/lib/coach-history";
import { Button } from "@/components/ui/button";

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

const GREETING: CoachMsg = {
  role: "assistant",
  content: "Hey — I'm Pilot. Tap the orb and tell me what's on your mind.",
};

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
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
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

  const { data: history } = useQuery({
    queryKey: ["coach-history"],
    queryFn: fetchCoachHistory,
    staleTime: 60_000,
    enabled: signedIn === true,
  });

  const [messages, setMessages] = useState<CoachMsg[]>([GREETING]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || history === undefined) return;
    if (history.length > 0) setMessages(history.slice(-12));
    setHydrated(true);
  }, [history, hydrated]);

  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [busy, setBusy] = useState(false);
  const mic = useMicRecorder();
  const tts = useTtsPlayer({ voice: "sage" });
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Reflect TTS state into the orb (when not actively listening/thinking).
  useEffect(() => {
    if (orbState === "listening" || orbState === "thinking") return;
    if (tts.state === "playing") setOrbState("speaking");
    else if (tts.state === "loading") setOrbState("thinking");
    else setOrbState("idle");
  }, [tts.state, orbState]);

  useEffect(() => {
    requestAnimationFrame(() => {
      transcriptRef.current?.scrollTo({
        top: transcriptRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [messages]);

  const askPilot = useCallback(
    async (userText: string, baseMessages: CoachMsg[]) => {
      setOrbState("thinking");
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ intent: "coach", messages: baseMessages }),
      });

      if (!resp.ok || !resp.body) {
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
          if (json === "[DONE]") {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(json);
            const chunk = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (chunk) {
              assistant += chunk;
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "assistant", content: assistant };
                return next;
              });
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      const finalText = assistant.trim();
      if (finalText) {
        if (signedIn) saveCoachMessage("assistant", finalText).catch(() => {});
        const speakText = stripMd(finalText).slice(0, 1800);
        if (speakText.length >= 3) {
          void tts.play(expandForSpeech(speakText));
        } else {
          setOrbState("idle");
        }
      } else {
        setOrbState("idle");
      }
    },
    [signedIn, tts],
  );

  const onMicTap = useCallback(async () => {
    if (busy) return;
    // Barge-in: stop speaking and reopen the mic.
    if (orbState === "speaking" || tts.state === "playing" || tts.state === "loading") {
      tts.stop();
      setOrbState("idle");
      return;
    }
    if (orbState === "listening") {
      // Manual stop
      setBusy(true);
      const blob = await mic.stop();
      await handleRecording(blob);
      return;
    }

    // Arm audio inside the user gesture so iOS Safari lets us play later.
    tts.armGesture();
    setOrbState("listening");
    await mic.start(async (blob) => {
      // Auto-stop callback fires from the audio thread.
      setBusy(true);
      setOrbState("idle");
      await handleRecording(blob);
    });
  }, [busy, orbState, mic, tts]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRecording(blob: Blob | null) {
    try {
      if (!blob) {
        toast.message("Didn't catch that — try again.");
        return;
      }
      setOrbState("thinking");
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
        toast.error(sttJson.error || "Couldn't transcribe — try again.");
        setOrbState("idle");
        return;
      }
      const userText = sttJson.text.trim();
      if (userText.length < 2) {
        toast.message("That was too short — try again.");
        setOrbState("idle");
        return;
      }
      const userMsg: CoachMsg = { role: "user", content: userText };
      const baseMessages = [...messages, userMsg];
      setMessages(baseMessages);
      if (signedIn) saveCoachMessage("user", userText).catch(() => {});
      await askPilot(userText, baseMessages);
    } finally {
      setBusy(false);
    }
  }

  const orbDisplayState: OrbState = mic.state === "listening" ? "listening" : orbState;

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-gradient-to-b from-background via-background to-primary/5 pb-24">
      <div className="mx-auto max-w-2xl px-4 pt-6 sm:pt-10">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Companion</p>
            <h1 className="text-2xl font-semibold mt-1">Pilot</h1>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/coach">
              <MessageCircle className="mr-1.5 h-4 w-4" /> Text chat
            </Link>
          </Button>
        </header>

        {signedIn === false && (
          <div className="mt-6 rounded-xl border border-border bg-card/60 p-4 text-sm">
            <Link to="/auth" className="underline">Sign in</Link> to talk with Pilot and save your conversation.
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
                  : "Talk to Pilot"
            }
            className="outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
          >
            <PilotOrb state={orbDisplayState} level={mic.level} />
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
          {tts.needsTap && (
            <Button size="sm" className="mt-3" onClick={() => void tts.playPrepared()}>
              <Phone className="mr-1.5 h-4 w-4" /> Tap to hear reply
            </Button>
          )}
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
          Pilot is an AI sleep & recovery companion — not medical advice. For health concerns, talk to a clinician.
        </p>
      </div>

      {/* Audio element is created internally by useTtsPlayer */}
    </div>
  );
}
