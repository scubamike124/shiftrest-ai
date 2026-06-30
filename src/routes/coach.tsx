import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, Sparkles, Volume2, VolumeX, Play, Square, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DISCLAIMER, fetchShifts } from "@/lib/shifts";
import { fetchEmployers } from "@/lib/employers";
import { DEFAULT_PREFS, fetchPrefs } from "@/lib/prefs";
import { useTtsPlayer } from "@/lib/voice/useTtsPlayer";
import { expandForSpeech } from "@/lib/voice-rewriter";
import { computeInsights } from "@/lib/insights";
import { fetchCoachHistory, saveCoachMessage } from "@/lib/coach-history";
import { useServerFn } from "@tanstack/react-start";
import { getWearableSummary } from "@/lib/wearables/wearables.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/coach")({
  head: () => ({
    meta: [
      { title: "AI Sleep Coach — RestPilot AI" },
      {
        name: "description",
        content:
          "Chat with your AI circadian-rhythm coach for actionable, shift-worker-specific sleep tips.",
      },
    ],
  }),
  component: Coach,
});

type Msg = { role: "user" | "assistant"; content: string };

const SEED: Msg[] = [
  {
    role: "assistant",
    content:
      "Hi — I'm your Sleep Coach. Tell me about your schedule or what's keeping you up, and I'll share concrete, science-backed tips on light exposure, blackout setups, caffeine timing, and recovery.",
  },
];

// Strip markdown so TTS speaks the words, not the syntax.
function plainForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // drop fenced code blocks entirely
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
    .trim()
    .slice(0, 1800);
}

const STARTERS = [
  "I work overnight 11p–7a. How do I sleep during the day?",
  "What blackout setup actually works in a bright apartment?",
  "When should I take caffeine before a night shift?",
];

function Coach() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    import("@/integrations/supabase/client").then(({ supabase }) =>
      supabase.auth.getSession().then(({ data }) => {
        if (active) setSignedIn(!!data.session);
      }),
    );
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
  const { data: shifts = [] } = useQuery({
    queryKey: ["shifts"],
    queryFn: fetchShifts,
    enabled: signedIn === true,
  });
  const { data: prefs = DEFAULT_PREFS } = useQuery({
    queryKey: ["prefs"],
    queryFn: fetchPrefs,
    initialData: DEFAULT_PREFS,
    enabled: signedIn === true,
  });
  const { data: employers = [] } = useQuery({
    queryKey: ["employers"],
    queryFn: fetchEmployers,
    enabled: signedIn === true,
  });
  const getWearableSummaryFn = useServerFn(getWearableSummary);
  const { data: wearableSummary } = useQuery({
    queryKey: ["wearable-summary"],
    queryFn: () => getWearableSummaryFn(),
    staleTime: 60_000,
    enabled: signedIn === true,
  });
  const coachContext = useMemo(
    () =>
      computeInsights(shifts, prefs, new Date(), employers, wearableSummary?.latest ?? null)
        .contextString,
    [shifts, prefs, employers, wearableSummary],
  );
  const [messages, setMessages] = useState<Msg[]>(SEED);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Voice settings — voice/personality/speed/name are configured on /profile.
  // The Coach exposes only an on/off toggle for auto-spoken replies.
  const [voiceOn, setVoiceOn] = useState(true);
  useEffect(() => {
    try {
      const on = localStorage.getItem("rp.coach.voice");
      if (on !== null) setVoiceOn(on === "1");
    } catch {
      /* no-op */
    }
  }, []);
  const tts = useTtsPlayer();
  const lastSpokenRef = useRef<string>("");

  function toggleVoice() {
    setVoiceOn((on) => {
      const next = !on;
      try {
        localStorage.setItem("rp.coach.voice", next ? "1" : "0");
      } catch {
        /* no-op */
      }
      if (!next) tts.stop();
      return next;
    });
  }

  const speak = useCallback(
    (raw: string) => {
      const text = plainForSpeech(raw);
      if (!text || text.length < 3) return;
      void tts.play(expandForSpeech(text));
    },
    [tts],
  );

  // Hydrate once when history first arrives. Past that, local state owns the thread.
  useEffect(() => {
    if (hydrated || history === undefined) return;
    if (history.length > 0) setMessages(history as Msg[]);
    setHydrated(true);
  }, [history, hydrated]);


  function scrollToBottom() {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }


  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const userMsg: Msg = { role: "user", content: trimmed };
    const baseMessages = [...messages, userMsg];
    setMessages(baseMessages);
    setInput("");
    setSending(true);
    // Arm the audio element synchronously inside the user gesture so iOS
    // Safari will let .play() run after the streamed response completes.
    if (voiceOn) tts.armGesture();
    scrollToBottom();

    try {
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
          messages: baseMessages,
          context: coachContext,
          surface: "text",
          localTime: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });

      if (!resp.ok || !resp.body) {
        const errJson = await resp.json().catch(() => ({ error: "Request failed" }));
        if (resp.status === 429 && /daily ai limit/i.test(errJson.error ?? "")) {
          toast.error("You've hit today's free AI limit.", {
            description: "Upgrade for unlimited conversations.",
            action: { label: "Upgrade", onClick: () => { window.location.href = "/paywall"; } },
          });
        } else {
          toast.error(errJson.error || "Coach is unavailable");
        }
        setMessages(baseMessages);
        return;
      }


      // Add placeholder assistant message
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
              scrollToBottom();
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      if (!assistant) {
        setMessages(baseMessages);
        toast.error("Empty response from coach");
      } else {
        // Persist both turns after a successful exchange. No-op for guests.
        void saveCoachMessage("user", trimmed);
        void saveCoachMessage("assistant", assistant);
        if (voiceOn && assistant !== lastSpokenRef.current) {
          lastSpokenRef.current = assistant;
          speak(assistant);
        }
      }
    } catch (e) {
      console.error(e);
      toast.error("Network error — please try again");
      setMessages(baseMessages);
    } finally {
      setSending(false);
    }
  }


  return (
    <main className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 px-5 pb-3 pt-12 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary shadow-[var(--shadow-glow)]">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">AI Sleep Coach</h1>
            <p className="text-xs text-muted-foreground">
              Circadian-rhythm expert · always on
            </p>
          </div>
          <button
            type="button"
            onClick={toggleVoice}
            className={`flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition active:scale-95 ${
              voiceOn
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border bg-card text-muted-foreground"
            }`}
            aria-pressed={voiceOn}
            aria-label={voiceOn ? "Mute voice replies" : "Enable voice replies"}
          >
            {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            <span className="hidden sm:inline">{voiceOn ? "Voice on" : "Voice off"}</span>
          </button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            return (
              <Bubble
                key={i}
                role={m.role}
                onSpeak={
                  m.role === "assistant" && m.content
                    ? () => speak(m.content)
                    : undefined
                }
                tts={isLast && m.role === "assistant" ? tts : undefined}
              >
                {m.content || (sending && isLast ? <Typing /> : "")}
              </Bubble>
            );
          })}
        </div>


        {messages.length <= 1 && (
          <div className="mt-5 flex flex-col gap-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Try asking
            </p>
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-2xl border border-border bg-card px-4 py-3 text-left text-sm text-foreground active:scale-[0.99]"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <p className="mt-6 text-[10px] leading-relaxed text-muted-foreground/70">
          {DISCLAIMER}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="sticky bottom-0 border-t border-border bg-background/90 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur-xl"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about wind-down, light, caffeine…"
            className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-border bg-input px-4 py-3 text-sm outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-40 active:scale-95"
            aria-label="Send"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </form>
    </main>
  );
}

function Bubble({
  role,
  children,
  onSpeak,
  tts,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
  onSpeak?: () => void;
  tts?: ReturnType<typeof useTtsPlayer>;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "rounded-br-md whitespace-pre-wrap bg-primary text-primary-foreground"
            : "rounded-bl-md border border-border bg-card text-foreground"
        }`}
      >
        {isUser ? children : <AssistantBody>{children}</AssistantBody>}
        {!isUser && onSpeak ? <SpeakerRow tts={tts} onSpeak={onSpeak} /> : null}
      </div>
    </div>
  );
}

function SpeakerRow({
  tts,
  onSpeak,
}: {
  tts?: ReturnType<typeof useTtsPlayer>;
  onSpeak: () => void;
}) {
  const loading = tts?.state === "loading";
  const playing = tts?.state === "playing";
  const needsTap = tts?.needsTap === true;
  return (
    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
      {needsTap ? (
        <button
          type="button"
          onClick={() => tts?.playPrepared()}
          className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow-[var(--shadow-glow)] active:scale-95"
        >
          <Play className="h-3 w-3" /> Tap to hear response
        </button>
      ) : (
        <button
          type="button"
          onClick={() => (playing ? tts?.stop() : onSpeak())}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium active:scale-95 disabled:opacity-60"
          aria-label={playing ? "Stop voice" : "Hear this reply"}
        >
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Preparing…
            </>
          ) : playing ? (
            <>
              <Square className="h-3 w-3" /> Stop
            </>
          ) : (
            <>
              <Volume2 className="h-3 w-3" /> Listen
            </>
          )}
        </button>
      )}
    </div>
  );
}


function AssistantBody({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  if (typeof children !== "string") return <>{children}</>;
  const raw = children.trim();
  if (!raw) return null;
  const LONG = 900;
  const isLong = raw.length > LONG;
  const visible = !isLong || expanded ? raw : raw.slice(0, LONG).replace(/\s+\S*$/, "") + "…";
  return (
    <div>
      <MarkdownText text={visible} />
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-semibold text-primary hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  return (
    <div
      className="prose prose-sm prose-invert max-w-none
        prose-headings:mt-3 prose-headings:mb-1 prose-headings:font-semibold prose-headings:text-foreground
        prose-h2:text-sm prose-h3:text-sm
        prose-p:my-1.5 prose-p:leading-relaxed
        prose-ul:my-1.5 prose-ul:pl-5 prose-li:my-0.5
        prose-strong:text-foreground prose-strong:font-semibold
        prose-a:text-primary"
    >
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}


function Typing() {
  return (
    <span className="inline-flex gap-1">
      <Dot />
      <Dot delay={120} />
      <Dot delay={240} />
    </span>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
