import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BUILD_STAMP } from "@/lib/companion/debug-bus";

const SIMLI_PATH = "/lab/avatar-poc/simli";
const SIMLI_ABSOLUTE_URL = "https://shift-rest-ai.lovable.app/lab/avatar-poc/simli";

type DebugState = {
  path: string;
  serviceWorker: string;
  simliRoute: string;
};

export const Route = createFileRoute("/lab/avatar-poc/$tool")({
  head: () => ({
    meta: [
      { title: "Avatar POC Debug — RestPilot Lab" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AvatarPocDebug,
});

function AvatarPocDebug() {
  const [state, setState] = useState<DebugState>({
    path: "checking…",
    serviceWorker: "checking…",
    simliRoute: "registered in this build; checking network response…",
  });

  useEffect(() => {
    let cancelled = false;

    async function inspect() {
      const next: DebugState = {
        path: window.location.pathname,
        serviceWorker: "unsupported",
        simliRoute: "registered in this build; network check pending",
      };

      if ("serviceWorker" in navigator) {
        try {
          const reg = await navigator.serviceWorker.getRegistration("/sw.js");
          const controller = navigator.serviceWorker.controller ? "controlled" : "not controlled";
          if (!reg) {
            next.serviceWorker = `supported; no /sw.js registration; ${controller}`;
          } else {
            const waiting = reg.waiting ? "; update waiting" : "";
            const installing = reg.installing ? "; installing" : "";
            next.serviceWorker = `registered at ${reg.scope}; ${controller}${waiting}${installing}`;
          }
        } catch (error) {
          next.serviceWorker = `check failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      try {
        const res = await fetch(`${SIMLI_PATH}?debugRouteCheck=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "text/html" },
        });
        const text = await res.text().catch(() => "");
        const hasSimliMarkup = text.includes("Simli + ElevenLabs Flash v2.5") || text.includes("Simli POC");
        next.simliRoute = res.ok
          ? `registered; HTTP ${res.status}${hasSimliMarkup ? "; Simli markup detected" : "; app shell returned"}`
          : `registered in build; HTTP ${res.status}`;
      } catch (error) {
        next.simliRoute = `registered in build; network check failed: ${error instanceof Error ? error.message : String(error)}`;
      }

      if (!cancelled) setState(next);
    }

    inspect();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.3em] text-foreground/50">Internal lab debug</p>
      <h1 className="mt-2 text-3xl font-semibold">Avatar POC Debug</h1>
      <div className="mt-8 space-y-3 rounded-2xl border border-border bg-card/60 p-5">
        <DebugRow label="Current path" value={state.path} />
        <DebugRow label="App build version" value={BUILD_STAMP} />
        <DebugRow label="Service worker status" value={state.serviceWorker} />
        <DebugRow label="/lab/avatar-poc/simli registered" value={state.simliRoute} />
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <a
          href={SIMLI_PATH}
          className="inline-flex items-center justify-center rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground active:bg-secondary"
          style={{ touchAction: "manipulation", WebkitTapHighlightColor: "rgba(255,255,255,0.12)" }}
        >
          Plain link to /lab/avatar-poc/simli
        </a>
        <a
          href={SIMLI_ABSOLUTE_URL}
          className="inline-flex items-center justify-center rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background active:opacity-80"
          style={{ touchAction: "manipulation", WebkitTapHighlightColor: "rgba(255,255,255,0.12)" }}
        >
          Plain link to full Simli URL
        </a>
      </div>
    </main>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-border/60 pb-3 last:border-b-0 last:pb-0 sm:grid-cols-[180px_1fr]">
      <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="break-words font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}