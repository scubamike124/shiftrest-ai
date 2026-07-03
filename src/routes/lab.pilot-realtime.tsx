/**
 * /lab/pilot-realtime — hidden Phase 2 beta.
 *
 * 404 unless VITE_ENABLE_REALTIME_PILOT=true.
 * Connects to LiveKit + publishes mic; the external LiveKit Agent worker
 * bridges audio to OpenAI Realtime. The production Companion voice
 * pipeline is untouched.
 */
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ENABLE_REALTIME_PILOT } from "@/lib/flags";
import { useRealtimePilot } from "@/lib/realtime/useRealtimePilot";
import { realtimePreflight, type RealtimePreflightResult } from "@/lib/realtime.functions";

export const Route = createFileRoute("/lab/pilot-realtime")({
  head: () => ({
    meta: [
      { title: "Pilot Realtime (beta) — RestPilot" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  beforeLoad: () => {
    if (!ENABLE_REALTIME_PILOT) throw notFound();
  },
  notFoundComponent: () => <div className="p-8 text-sm">Not found.</div>,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-8 text-sm">
        <p className="mb-2">Realtime beta error: {error.message}</p>
        <button
          className="underline"
          onClick={() => {
            reset();
            router.invalidate();
          }}
        >
          Retry
        </button>
      </div>
    );
  },
  component: LabPilotRealtime,
});

function LabPilotRealtime() {
  const rt = useRealtimePilot();

  const connected = rt.status === "connected" || rt.status === "reconnecting";
  const ttfaMs = rt.metrics.timeToFirstAudioMs;

  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">Pilot Realtime — hidden beta</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Phase 2. Uses OpenAI Realtime via LiveKit Cloud. This page is the
        only surface that touches Realtime — production voice is unchanged.
      </p>

      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-3">
          {!connected ? (
            <button
              className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              disabled={rt.status === "connecting"}
              onClick={() => void rt.connect()}
            >
              {rt.status === "connecting" ? "Connecting…" : "Start conversation"}
            </button>
          ) : (
            <>
              <button
                className="rounded border px-4 py-2 text-sm"
                onClick={() => void rt.toggleMute()}
              >
                {rt.muted ? "Unmute mic" : "Mute mic"}
              </button>
              <button
                className="rounded border px-4 py-2 text-sm"
                onClick={() => void rt.disconnect()}
              >
                End
              </button>
            </>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <dt>Status</dt>
          <dd className="text-foreground">{rt.status}</dd>
          <dt>Pilot speaking</dt>
          <dd className="text-foreground">{rt.remoteSpeaking ? "yes" : "no"}</dd>
          <dt>Time to first audio</dt>
          <dd className="text-foreground">
            {ttfaMs != null ? `${Math.round(ttfaMs)} ms` : "—"}
          </dd>
          <dt>Mic</dt>
          <dd className="text-foreground">{rt.muted ? "muted" : "live"}</dd>
        </dl>

        {rt.error && (
          <p className="text-sm text-destructive">Error: {rt.error}</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Transcript</h2>
        {rt.transcript.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No transcript yet. (The agent worker publishes transcript events
            on the LiveKit data channel; if you don't see any, the worker is
            either not deployed or not emitting them.)
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {rt.transcript.map((t) => (
              <li key={t.id}>
                <span className="text-xs uppercase text-muted-foreground">
                  {t.from}:
                </span>{" "}
                {t.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Hidden audio element the hook attaches remote assistant audio to */}
      <audio ref={rt.remoteAudioRef} autoPlay playsInline className="hidden" />
    </main>
  );
}
