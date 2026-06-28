import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic, Send, Settings2, Sparkles, Shield, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchPrefs, savePrefs, type Prefs } from "@/lib/prefs";
import { PilotOrb, type OrbState } from "@/components/PilotOrb";
import { useMicRecorder } from "@/lib/voice/useMicRecorder";
import {
  tryCompanionSoundCommand,
  executePending,
  isYes,
  isNo,
} from "@/lib/voice/companion-sound-bridge";
import type { Intent } from "@/lib/voice/intent-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/companion")({
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

type Msg = { role: "user" | "assistant"; content: string };

function firstName(p: Prefs, email: string | null): string {
  if (p.partnerName?.trim()) return p.partnerName.trim().split(/\s+/)[0];
  if (email) return email.split("@")[0].split(/[._]/)[0].replace(/^./, (c) => c.toUpperCase());
  return "there";
}

function CompanionPage() {
  const qc = useQueryClient();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSessionEmail(data.session?.user.email ?? null);
      setSignedIn(Boolean(data.session));
    });
    const sub = supabase.auth.onAuthStateChange((_e, s) => {
      setSessionEmail(s?.user.email ?? null);
      setSignedIn(Boolean(s));
    });
    return () => {
      mounted = false;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  const prefsQ = useQuery({ queryKey: ["prefs"], queryFn: fetchPrefs, enabled: signedIn === true });
  const prefs = prefsQ.data;

  const companionOn = prefs?.assistantMode === "companion";
  const aiName = prefs?.assistantName?.trim() || "RestPilot";
  const memoryOn = Boolean(prefs?.memoryEnabled);

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
  const { state: micState, level, start: micStart, stop: micStop } = useMicRecorder({ silenceMs: 1200 });
  const [transcribing, setTranscribing] = useState(false);

  // Slice 4 — sound command bridge. Pending confirmation for low-confidence guesses.
  const navigate = useNavigate();
  const [pendingSoundIntent, setPendingSoundIntent] = useState<Intent | null>(null);
  const execCtx = {
    signedIn: signedIn === true,
    navigate: (to: string, search?: Record<string, string>) => {
      navigate({ to, search: search ?? undefined } as never).catch(() => undefined);
    },
    openBreathing: () => undefined,
  };

  useEffect(() => {
    if (micState === "listening") setOrbState("listening");
    else if (sending) setOrbState("thinking");
    else setOrbState("idle");
  }, [micState, sending]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  async function handleMicTap() {
    if (micState === "listening") {
      await micStop();
      return;
    }
    setInput("");
    await micStart(async (blob) => {
      if (!blob) return;
      setTranscribing(true);
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        const fd = new FormData();
        fd.append("file", blob, "recording.wav");
        if (prefs?.voiceLanguage) fd.append("language", prefs.voiceLanguage.split("-")[0]);
        const resp = await fetch("/api/stt", {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        const json = (await resp.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!resp.ok) {
          toast.error(json.error || "Couldn't transcribe");
          return;
        }
        const text = (json.text || "").trim();
        if (text) setInput(text);
      } finally {
        setTranscribing(false);
      }
    });
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending || !companionOn) return;
    const baseMessages: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(baseMessages);
    setInput("");

    // Slice 4 — sleep-sound bridge. Intercept before hitting /api/ai so
    // we never bill tokens for a deterministic local action, and reuse
    // the same mixer + executor that /sleep uses.
    if (pendingSoundIntent) {
      if (isYes(text)) {
        const reply = await executePending(pendingSoundIntent, execCtx);
        setPendingSoundIntent(null);
        setMessages([...baseMessages, { role: "assistant", content: reply }]);
        return;
      }
      if (isNo(text)) {
        setPendingSoundIntent(null);
        setMessages([...baseMessages, { role: "assistant", content: "Okay, cancelled." }]);
        return;
      }
      // Anything else clears the pending and continues as normal chat.
      setPendingSoundIntent(null);
    }

    try {
      const bridged = await tryCompanionSoundCommand(text, execCtx);
      if (bridged.kind === "handled") {
        setMessages([...baseMessages, { role: "assistant", content: bridged.assistant }]);
        return;
      }
      if (bridged.kind === "confirm") {
        setPendingSoundIntent(bridged.pendingIntent);
        setMessages([...baseMessages, { role: "assistant", content: bridged.assistant }]);
        return;
      }
    } catch (err) {
      // Bridge failure (e.g. mixer init) → fall through to AI chat, don't block the user.
      console.warn("[companion] sound bridge error", err);
    }

    setSending(true);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;



    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const resp = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: ac.signal,
        body: JSON.stringify({
          intent: "coach",
          messages: baseMessages,
          context: { surface: "companion", companion_name: aiName, max_tokens: 220 },
        }),
      });

      if (!resp.ok || !resp.body) {
        const errJson = (await resp.json().catch(() => ({}))) as { error?: string };
        if (resp.status === 429) {
          toast.error("Daily AI limit reached.", {
            description: "Upgrade for unlimited conversations.",
            action: { label: "Upgrade", onClick: () => { window.location.href = "/paywall"; } },
          });
        } else {
          toast.error(errJson.error || "Companion is unavailable");
        }
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
          if (json === "[DONE]") { done = true; break; }
          try {
            const evt = JSON.parse(json) as { choices?: { delta?: { content?: string } }[] };
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) {
              assistant += delta;
              setMessages([...baseMessages, { role: "assistant", content: assistant }]);
            }
          } catch { /* noop */ }
        }
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setSending(false);
  }

  // ─── Render ─────────────────────────────────────────────────────
  if (signedIn === false) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-12 text-center">
        <Sparkles className="h-10 w-10 text-primary" />
        <h1 className="text-2xl font-semibold">Sign in to meet your Companion</h1>
        <p className="text-sm text-muted-foreground">Your private AI lives behind your account.</p>
        <Button asChild><Link to="/auth">Sign in</Link></Button>
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
      </header>

      {/* Avatar + greeting */}
      <section className="flex flex-col items-center gap-3 pb-4 pt-2">
        <PilotOrb state={orbState} level={level} className="w-40 sm:w-48" />
        <div className="text-center">
          <p className="text-base font-medium">
            Hi {firstName(prefs ?? ({} as Prefs), sessionEmail)}, I&apos;m {aiName}.
          </p>
          <p className="text-xs text-muted-foreground">
            {companionOn
              ? "Talk or type — I&apos;m here when you need me."
              : "Turn on Companion Mode to start chatting."}
          </p>
        </div>
      </section>

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
        className={cn(
          "mt-4 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-border/40 bg-background/40 p-3",
          !companionOn && "opacity-60",
        )}
        style={{ minHeight: 220 }}
      >
        {messages.length === 0 && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {companionOn ? "Say hi or ask anything about your sleep, schedule, or recovery." : "Conversations are paused while Companion Mode is off."}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {m.content || (sending && i === messages.length - 1 ? "…" : "")}
            </div>
          </div>
        ))}
      </div>

      {/* Voice-response placeholder badge */}
      {companionOn && (
        <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/60" />
          Voice replies coming next — for now, replies appear in chat.
        </div>
      )}

      {/* Composer */}
      <form onSubmit={handleSend} className="mt-3 flex items-end gap-2">
        <Button
          type="button"
          variant={micState === "listening" ? "default" : "outline"}
          size="icon"
          className="h-11 w-11 shrink-0"
          aria-label={micState === "listening" ? "Stop recording" : "Hold to talk"}
          disabled={!companionOn || transcribing || sending}
          onClick={handleMicTap}
        >
          {transcribing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
        </Button>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={companionOn ? "Message your Companion" : "Companion Mode is off"}
          disabled={!companionOn || sending}
          className="h-11"
          inputMode="text"
          autoComplete="off"
        />
        {sending ? (
          <Button type="button" size="icon" variant="secondary" className="h-11 w-11 shrink-0" aria-label="Stop" onClick={handleStop}>
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" className="h-11 w-11 shrink-0" aria-label="Send" disabled={!companionOn || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
      {micState === "listening" && (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">Listening… tap mic to stop</p>
      )}
    </main>
  );
}
