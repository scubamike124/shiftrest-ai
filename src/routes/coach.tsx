import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { DISCLAIMER } from "@/lib/shifts";

export const Route = createFileRoute("/coach")({
  head: () => ({
    meta: [
      { title: "AI Sleep Coach — ShiftRest AI" },
      { name: "description", content: "Chat with your AI circadian-rhythm coach for actionable, shift-worker-specific sleep tips." },
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

function mockResponse(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("caffeine"))
    return "For an 11p–7a shift, take 100–200 mg of caffeine about 30 minutes before clock-in, and optionally a small top-up by 2 a.m. Stop all caffeine at least 6 hours before your planned bedtime so it doesn't fragment your daytime sleep.";
  if (p.includes("blackout") || p.includes("light"))
    return "Aim for cave-dark. Use blackout curtains plus a sleep mask, cover small LEDs with electrical tape, and consider amber/red bulbs in the bathroom for any wake-ups. On the commute home, wear amber/blue-blocking glasses so morning light doesn't suppress melatonin.";
  if (p.includes("sleep") || p.includes("overnight") || p.includes("night"))
    return "After a 7 a.m. clock-out, treat 7–9 a.m. as your wind-down: low light, light snack, no screens. Anchor sleep 9 a.m.–5 p.m. in a cool (65–68°F), dark, quiet room. Keep the schedule consistent across consecutive nights to stabilize your rhythm.";
  return "Great question. A solid rule for shift workers: protect a fixed sleep window, control light aggressively at both ends, and keep meals/caffeine on a predictable schedule. Want me to build a plan around a specific shift block?";
}

function Coach() {
  const [messages, setMessages] = useState<Msg[]>(SEED);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    const next = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(next);
    setInput("");
    setSending(true);
    // TODO: replace with real call to OpenAI GPT-4o-mini via a server function.
    // System prompt: empathetic, professional circadian-rhythm expert giving
    // shift workers actionable tips on fatigue, blackout curtains, light
    // exposure, and erratic schedules.
    await new Promise((r) => setTimeout(r, 600));
    setMessages([...next, { role: "assistant", content: mockResponse(trimmed) }]);
    setSending(false);
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    });
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
            <p className="text-xs text-muted-foreground">Circadian-rhythm expert · always on</p>
          </div>
        </div>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role}>
              {m.content}
            </Bubble>
          ))}
          {sending && (
            <Bubble role="assistant">
              <span className="inline-flex gap-1">
                <Dot /> <Dot delay={120} /> <Dot delay={240} />
              </span>
            </Bubble>
          )}
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

function Bubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-card text-foreground border border-border"
        }`}
      >
        {children}
      </div>
    </div>
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
