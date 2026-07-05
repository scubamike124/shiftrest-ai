/**
 * /lab/pilot-realtime — hidden beta.
 *
 * 404 unless VITE_ENABLE_REALTIME_PILOT=true.
 * Connects the browser directly to OpenAI Realtime over WebRTC using an
 * ephemeral session minted server-side. No LiveKit, no external worker.
 * Production Companion voice pipeline is untouched.
 */
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { ENABLE_REALTIME_PILOT } from "@/lib/flags";
import { useOpenAIRealtime } from "@/lib/realtime/useOpenAIRealtime";

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

function fmtMs(ms: number | null) {
  return ms != null ? `${Math.round(ms)} ms` : "—";
}

function LabPilotRealtime() {
  const rt = useOpenAIRealtime();
  const active =
    rt.status !== "idle" &&
    rt.status !== "error" &&
    rt.status !== "disconnected" &&
    rt.status !== "connecting";

  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">Pilot Realtime — hidden beta</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Direct OpenAI Realtime over WebRTC. Ephemeral session token is minted
        server-side; the OpenAI key never reaches the browser.
      </p>

      <section className="mt-6 space-y-3">
        <div className="flex items-center gap-3">
          {!active ? (
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
                onClick={() => rt.toggleMute()}
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
          <dt>Mic</dt>
          <dd className="text-foreground">{rt.muted ? "muted" : "live"}</dd>
          <dt>Connect time</dt>
          <dd className="text-foreground">{fmtMs(rt.metrics.connectMs)}</dd>
          <dt>First audio</dt>
          <dd className="text-foreground">{fmtMs(rt.metrics.firstAudioMs)}</dd>
          <dt>Last turn latency</dt>
          <dd className="text-foreground">{fmtMs(rt.metrics.lastTurnMs)}</dd>
        </dl>

        {rt.error && (
          <p className="text-sm text-destructive">Error: {rt.error}</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Debug (last events)</h2>
        {rt.debugEvents.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No events yet. Cutoff details will appear here.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 rounded border bg-muted/40 p-2 font-mono text-[11px] leading-tight">
            {rt.debugEvents.map((e, i) => {
              const t = new Date(e.at).toLocaleTimeString();
              if (e.kind === "response.done") {
                return (
                  <li key={i} className="break-all">
                    {t} done · status: {e.status ?? "—"} · reason:{" "}
                    {e.statusReason ?? e.statusType ?? "—"} · outputTokens:{" "}
                    {e.outputTokens ?? "—"}
                  </li>
                );
              }
              return (
                <li key={i} className="break-all text-destructive">
                  {t} {e.kind}
                  {e.message ? ` · ${e.message}` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium">Transcript</h2>
        {rt.transcript.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No transcript yet. Start a conversation and speak.
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

      <audio ref={rt.remoteAudioRef} autoPlay playsInline className="hidden" />
    </main>
  );
}
