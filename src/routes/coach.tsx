import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, Sparkles } from "lucide-react";
import { DISCLAIMER } from "@/lib/shifts";
import { fetchCoachHistory, saveCoachMessage } from "@/lib/coach-history";
import { toast } from "sonner";

export const Route = createFileRoute("/coach")({
  head: () => ({
    meta: [
      { title: "AI Sleep Coach — ShiftRest AI" },
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

const STARTERS = [
  "I work overnight 11p–7a. How do I sleep during the day?",
  "What blackout setup actually works in a bright apartment?",
  "When should I take caffeine before a night shift?",
];

function Coach() {
  const { data: history } = useQuery({
    queryKey: ["coach-history"],
    queryFn: fetchCoachHistory,
    staleTime: 60_000,
  });
  const [messages, setMessages] = useState<Msg[]>(SEED);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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
    scrollToBottom();

    try {
      const resp = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: baseMessages }),
      });

      if (!resp.ok || !resp.body) {
        const errJson = await resp.json().catch(() => ({ error: "Request failed" }));
        toast.error(errJson.error || "Coach is unavailable");
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
          <div>
            <h1 className="text-lg font-semibold">AI Sleep Coach</h1>
            <p className="text-xs text-muted-foreground">
              Circadian-rhythm expert · always on
            </p>
          </div>
        </div>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role}>
              {m.content || (sending && i === messages.length - 1 ? <Typing /> : "")}
            </Bubble>
          ))}
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
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md border border-border bg-card text-foreground"
        }`}
      >
        {children}
      </div>
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
