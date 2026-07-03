/**
 * /lab/pilot-realtime — hidden Phase 2 beta.
 *
 * 404 unless VITE_ENABLE_REALTIME_PILOT=true.
 * Connects to LiveKit + publishes mic; the external LiveKit Agent worker
 * bridges audio to OpenAI Realtime. The production Companion voice
 * pipeline is untouched.
 *
 * This route lives under the _authenticated layout so only signed-in users
 * can reach it; the URL remains /lab/pilot-realtime.
 */
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ENABLE_REALTIME_PILOT } from "@/lib/flags";
import { useRealtimePilot } from "@/lib/realtime/useRealtimePilot";
import { realtimePreflight, type RealtimePreflightResult } from "@/lib/realtime.functions";

export const Route = createFileRoute("/_authenticated/lab/pilot-realtime")({
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
  const preflight = useServerFn(realtimePreflight);
  const [pf, setPf] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; result: RealtimePreflightResult }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const connected = rt.status === "connected" || rt.status === "reconnecting";
  const ttfaMs = rt.metrics.timeToFirstAudioMs;

  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">Pilot Realtime — hidden beta</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Phase 3A. Uses OpenAI Realtime via LiveKit Cloud. This page is the
        only surface that touches Realtime — production voice is unchanged.
      </p>

      <section className="mt-6 space-y-3 rounded border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Preflight</h2>
          <button
            className="rounded border px-3 py-1 text-xs"
            disabled={pf.kind === "loading"}
            onClick={async () => {
              setPf({ kind: "loading" });
              try {
                const result = await preflight();
                setPf({ kind: "done", result });
              } catch (e) {
                setPf({ kind: "error", message: e instanceof Error ? e.message : String(e) });
              }
            }}
          >
            {pf.kind === "loading" ? "Running…" : "Run preflight"}
          </button>
        </div>
        {pf.kind === "done" && (
          <>
            <p className={pf.result.ok ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
              {pf.result.ok ? "All checks passed" : "One or more checks failed"} · room{" "}
              <code>{pf.result.room}</code>
            </p>
            <ul className="space-y-1 text-xs">
              {pf.result.checks.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <span aria-hidden>{c.ok ? "✓" : "✗"}</span>
                  <span className="flex-1">
                    <span className={c.ok ? "text-foreground" : "text-destructive"}>{c.label}</span>
                    <span className="ml-2 text-muted-foreground">— {c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {pf.kind === "error" && (
          <p className="text-xs text-destructive">Preflight error: {pf.message}</p>
        )}
        {pf.kind === "idle" && (
          <p className="text-xs text-muted-foreground">
            Verifies env vars, LIVEKIT_URL shape, JWT signing, and LiveKit reachability
            before you deploy the external agent worker.
          </p>
        )}
      </section>


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
