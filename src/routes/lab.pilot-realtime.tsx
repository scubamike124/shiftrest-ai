/**
 * /lab/pilot-realtime — Phase 1 hidden beta shell.
 *
 * This route exists only to prove the token-minting foundation works.
 * It renders a 404 unless `VITE_ENABLE_REALTIME_PILOT=true` AND the
 * signed-in user has the `admin` or `tester` role.
 *
 * No production users reach this route. The current voice pipeline is
 * untouched.
 */
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ENABLE_REALTIME_PILOT } from "@/lib/flags";
import { mintRealtimePilotToken, type RealtimeTokenResult } from "@/lib/realtime.functions";

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
  const mint = useServerFn(mintRealtimePilotToken);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; token: RealtimeTokenResult }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-semibold">Pilot Realtime — hidden beta</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Phase 1 foundation. This page only mints a LiveKit token to prove
        the server pipeline works. It does not start a voice session and it
        does not affect the current Pilot voice.
      </p>

      <button
        className="mt-6 rounded border px-3 py-2 text-sm"
        disabled={state.kind === "loading"}
        onClick={async () => {
          setState({ kind: "loading" });
          try {
            const token = await mint();
            setState({ kind: "ready", token });
          } catch (e) {
            setState({
              kind: "error",
              message: e instanceof Error ? e.message : String(e),
            });
          }
        }}
      >
        {state.kind === "loading" ? "Minting…" : "Mint LiveKit token"}
      </button>

      {state.kind === "ready" && (
        <pre className="mt-4 overflow-auto rounded bg-muted p-3 text-xs">
          {JSON.stringify(
            {
              url: state.token.url,
              room: state.token.room,
              identity: state.token.identity,
              expiresAt: new Date(state.token.expiresAt).toISOString(),
              tokenPreview: state.token.token.slice(0, 24) + "…",
            },
            null,
            2,
          )}
        </pre>
      )}

      {state.kind === "error" && (
        <p className="mt-4 text-sm text-destructive">Error: {state.message}</p>
      )}
    </main>
  );
}
