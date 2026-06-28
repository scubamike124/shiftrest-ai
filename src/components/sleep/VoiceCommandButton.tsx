/**
 * Push-to-talk voice button for /sleep. Records a single WAV via the
 * iOS-safe useMicRecorder hook, posts to /api/stt, parses with the
 * deterministic intent router, then executes via the executor.
 *
 * Safety:
 *   - Only acts on confidence >= 0.85. Lower confidence → confirmation prompt.
 *   - Shows the transcript so the user can spot misheard words.
 *   - Offers Undo for 5s when the executor returned one.
 *   - State machine is single-instance; double-taps are ignored while busy.
 */
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Mic, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMicRecorder } from "@/lib/voice/useMicRecorder";
import { parseIntent, type ParsedIntent } from "@/lib/voice/intent-router";
import { executeIntent } from "@/lib/voice/intent-executor";

type Phase =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "transcribing" }
  | { kind: "confirming"; parsed: ParsedIntent }
  | { kind: "executing" };

export function VoiceCommandButton({
  signedIn,
  onBreathing,
}: {
  signedIn: boolean;
  onBreathing: () => void;
}) {
  const navigate = useNavigate();
  const recorder = useMicRecorder({ silenceMs: 1200, maxMs: 8000 });
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [transcript, setTranscript] = useState<string>("");
  const inflightRef = useRef(false);

  const runIntent = useCallback(async (parsed: ParsedIntent) => {
    setPhase({ kind: "executing" });
    try {
      const result = await executeIntent(parsed.intent, {
        signedIn,
        navigate: (to, search) => {
          navigate({ to, search: (search ?? {}) as never }).catch(() => {});
        },
        openBreathing: onBreathing,
      });
      if (result.ok) {
        toast.success(result.message, {
          duration: 5000,
          action: result.undo
            ? { label: "Undo", onClick: () => { void result.undo?.(); } }
            : undefined,
        });
      } else {
        toast(result.message);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Voice action failed.");
    } finally {
      setPhase({ kind: "idle" });
    }
  }, [signedIn, navigate, onBreathing]);

  const transcribe = useCallback(async (blob: Blob) => {
    setPhase({ kind: "transcribing" });
    const form = new FormData();
    form.append("file", blob, "command.wav");
    form.append("language", "en");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/stt", {
        method: "POST",
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Transcription failed (${res.status}).`);
      }
      const { text } = (await res.json()) as { text?: string };
      const heard = (text ?? "").trim();
      setTranscript(heard);
      if (!heard) {
        toast("I didn't hear anything.");
        setPhase({ kind: "idle" });
        return;
      }
      const parsed = parseIntent(heard);
      if (parsed.confidence >= 0.85) {
        await runIntent(parsed);
      } else {
        setPhase({ kind: "confirming", parsed });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't transcribe.");
      setPhase({ kind: "idle" });
    }
  }, [runIntent]);

  const startRecording = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;
    setTranscript("");
    setPhase({ kind: "recording" });
    try {
      await recorder.start((blob) => {
        // Auto-stop fired by trailing silence.
        inflightRef.current = false;
        if (!blob) {
          toast("That was too quiet — try again.");
          setPhase({ kind: "idle" });
          return;
        }
        void transcribe(blob);
      });
    } catch (e) {
      inflightRef.current = false;
      setPhase({ kind: "idle" });
      toast.error(e instanceof Error ? e.message : "Microphone unavailable.");
    }
  }, [recorder, transcribe]);

  const stopRecording = useCallback(async () => {
    if (phase.kind !== "recording") return;
    const blob = await recorder.stop();
    inflightRef.current = false;
    if (!blob) {
      toast("That was too quiet — try again.");
      setPhase({ kind: "idle" });
      return;
    }
    void transcribe(blob);
  }, [phase.kind, recorder, transcribe]);

  const cancel = useCallback(async () => {
    if (phase.kind === "recording") {
      await recorder.stop().catch(() => {});
    }
    inflightRef.current = false;
    setPhase({ kind: "idle" });
    setTranscript("");
  }, [phase.kind, recorder]);

  // --- render ---
  const isRecording = phase.kind === "recording";
  const isBusy = phase.kind === "transcribing" || phase.kind === "executing";

  return (
    <Card className="border-border/60 p-4">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="lg"
          variant={isRecording ? "default" : "outline"}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isBusy || phase.kind === "confirming"}
          aria-label={isRecording ? "Stop voice command" : "Start voice command"}
          className={`h-12 w-12 rounded-full p-0 ${isRecording ? "animate-pulse" : ""}`}
        >
          {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-5 w-5" />}
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Voice commands</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {phase.kind === "recording" && "Listening — say 'play rain' or 'goodnight'…"}
            {phase.kind === "transcribing" && "Transcribing…"}
            {phase.kind === "executing" && "Running…"}
            {phase.kind === "idle" && (transcript ? `Heard: "${transcript}"` : "Tap the mic, then speak.")}
            {phase.kind === "confirming" && `Heard: "${phase.parsed.raw}"`}
          </p>
        </div>
        {(isRecording || phase.kind === "confirming") && (
          <Button variant="ghost" size="sm" onClick={cancel} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {phase.kind === "confirming" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px]">
          <span className="text-muted-foreground">Not sure I got that right.</span>
          {phase.parsed.intent.kind === "unknown" && phase.parsed.intent.alternates?.length ? (
            <span>Try: <strong>{phase.parsed.intent.alternates.join(", ")}</strong>.</span>
          ) : (
            <>
              <Button size="sm" variant="default" className="h-7 px-3" onClick={() => void runIntent(phase.parsed)}>
                <Check className="mr-1 h-3.5 w-3.5" /> Run anyway
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-3" onClick={cancel}>
                Cancel
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
