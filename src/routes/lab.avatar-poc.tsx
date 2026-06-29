// /lab/avatar-poc — gated POC picker. Noindex, not linked from the app.

import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/lab/avatar-poc")({
  head: () => ({
    meta: [
      { title: "Avatar POC — RestPilot Lab" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: LabPicker,
});

function LabPicker() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.3em] text-foreground/50">Internal lab</p>
      <h1 className="mt-2 text-3xl font-semibold">Avatar Proof of Concept</h1>
      <p className="mt-3 text-sm text-foreground/70">
        Isolated routes used to evaluate avatar providers against real iOS Safari.
        Not linked from the app. Not indexed.
      </p>
      <a
        href="/lab/avatar-poc/simli"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-400/20 px-4 py-2 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-300/40 active:bg-emerald-400/30"
        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "rgba(16,185,129,0.25)" }}
      >
        Direct link → /lab/avatar-poc/simli
      </a>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/lab/avatar-poc/simli"
          preload={false}
          role="link"
          aria-label="Open Simli + ElevenLabs POC"
          className="block cursor-pointer select-none rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-white/20 hover:bg-white/10 active:bg-white/15"
          style={{ touchAction: "manipulation", WebkitTapHighlightColor: "rgba(255,255,255,0.08)" }}
        >
          <div className="text-xs uppercase tracking-[0.2em] text-emerald-300/80">POC #1</div>
          <div className="mt-1 text-lg font-medium">Simli + ElevenLabs Flash v2.5</div>
          <div className="mt-2 text-sm text-foreground/60">
            WebRTC streaming face. Low latency, BYO TTS. Recommended baseline.
          </div>
          <div className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-emerald-300">
            Open POC →
          </div>
        </Link>
        {/* Fallback plain anchor — guarantees navigation on iOS Safari even if the SPA router click handler is blocked. */}
        <noscript>
          <a href="/lab/avatar-poc/simli">Open Simli POC</a>
        </noscript>
        <div className="rounded-2xl border border-dashed border-white/10 p-5 opacity-60">
          <div className="text-xs uppercase tracking-[0.2em] text-foreground/40">POC #2 — Paused</div>
          <div className="mt-1 text-lg font-medium">HeyGen + ElevenLabs Turbo v2.5</div>
          <div className="mt-2 text-sm text-foreground/50">
            Requires HeyGen paid plan. Build only after Simli QA decision.
          </div>
        </div>
      </div>
    </main>
  );
}
