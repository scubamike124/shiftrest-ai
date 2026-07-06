/**
 * /version — human-readable deployment fingerprint.
 *
 * Use this page to verify Preview and Production are serving the build you
 * just published. After clicking Publish → Update, open this page on both
 * URLs and confirm the Build ID matches. On installed iPhone PWAs, this is
 * also the fastest way to confirm the service worker has activated the
 * new release (the controller's build is shown alongside the page build).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { readBreadcrumbs, clearBreadcrumbs, type PwaBreadcrumb } from "@/lib/pwa/breadcrumbs";

declare const __BUILD_ID__: string;

const PAGE_BUILD_ID = __BUILD_ID__;
const PAGE_BUILT_AT = PAGE_BUILD_ID.startsWith("b-")
  ? new Date(Number(PAGE_BUILD_ID.slice(2))).toISOString()
  : null;

export const Route = createFileRoute("/version")({
  head: () => ({
    meta: [
      { title: "Build · RestPilot AI" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: VersionPage,
});

type ServerVersion = {
  buildId: string;
  builtAt: string | null;
  servedAt: string;
  host: string;
};

function VersionPage() {
  const [server, setServer] = useState<ServerVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swState, setSwState] = useState<string>("checking…");
  const [host, setHost] = useState<string>("");
  const [log, setLog] = useState<PwaBreadcrumb[]>([]);

  const refreshLog = useCallback(() => setLog(readBreadcrumbs()), []);

  useEffect(() => {
    setHost(window.location.host);
    refreshLog();
    fetch("/api/public/version", { cache: "no-store" })
      .then((r) => r.json())
      .then(setServer)
      .catch((e: unknown) => setError(String(e)));

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistration("/sw.js")
        .then((reg) => {
          if (!reg) return setSwState("not registered");
          const parts: string[] = [];
          if (reg.active) parts.push(`active: ${reg.active.state}`);
          if (reg.waiting) parts.push("waiting (update ready)");
          if (reg.installing) parts.push(`installing: ${reg.installing.state}`);
          setSwState(parts.join(" · ") || "registered");
        })
        .catch(() => setSwState("unavailable"));
    } else {
      setSwState("unsupported");
    }
  }, []);

  const match = server && server.buildId === PAGE_BUILD_ID;

  return (
    <main className="min-h-screen bg-[#0b1020] px-5 py-10 text-white">
      <div className="mx-auto max-w-xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Deployment fingerprint</h1>
          <p className="mt-1 text-sm text-white/60">
            Verify which build is being served right now.
          </p>
          <p className="mt-2 inline-block rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-300">
            🟠 Publish canary v5 — breadcrumb test. Log below records every PWA lifecycle event.
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">
            This page (client bundle)
          </h2>
          <Row label="Build ID" value={PAGE_BUILD_ID} mono />
          <Row label="Built at" value={PAGE_BUILT_AT ?? "unknown"} />
          <Row label="Host" value={host} />
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">
            Server (/api/public/version)
          </h2>
          {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
          {server ? (
            <>
              <Row label="Build ID" value={server.buildId} mono />
              <Row label="Built at" value={server.builtAt ?? "unknown"} />
              <Row label="Served at" value={server.servedAt} />
              <Row label="Host" value={server.host} />
              <Row
                label="Match"
                value={match ? "✓ client and server agree" : "✗ mismatch — reload"}
              />
            </>
          ) : (
            !error && <p className="mt-2 text-sm text-white/60">loading…</p>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">
            Service worker
          </h2>
          <Row label="State" value={swState} />
          <p className="mt-3 text-xs text-white/50">
            If &quot;waiting (update ready)&quot; appears, the in-app Update
            banner will offer a one-tap reload.
          </p>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">
              Recent PWA activity ({log.length})
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={refreshLog}
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => { clearBreadcrumbs(); refreshLog(); }}
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/80 hover:bg-white/10"
              >
                Clear log
              </button>
            </div>
          </div>
          {log.length === 0 ? (
            <p className="mt-3 text-sm text-white/60">
              No breadcrumbs yet. If SW is registered, a "registered" entry should appear on next load.
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {[...log].reverse().map((entry, i) => {
                const { ts, type, build, ...rest } = entry;
                return (
                  <li
                    key={`${ts}-${i}`}
                    className="rounded-lg border border-white/10 bg-black/30 p-2 text-xs"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold text-white">{type}</span>
                      <span className="font-mono text-white/50">{ts}</span>
                    </div>
                    <div className="mt-1 font-mono text-white/60">build: {build}</div>
                    {Object.keys(rest).length > 0 && (
                      <pre className="mt-1 overflow-x-auto font-mono text-white/70">
                        {JSON.stringify(rest, null, 2)}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="mt-3 text-xs text-white/50">
            drift-detected → auto-skip-waiting → reload = poll guard fired.
            bfcache-restore-stale → reload = bfcache guard fired.
          </p>
        </section>

        <p className="text-xs text-white/40">
          Compare this Build ID on Preview and Production after every publish.
          Different IDs = production rotated. Identical IDs = either no new
          publish promoted, or your browser cached the old build (use the
          Update banner, or visit <code>?sw=off</code> to bypass the worker).
        </p>

      </div>
    </main>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="mt-3 flex items-baseline justify-between gap-4">
      <span className="text-sm text-white/60">{label}</span>
      <span className={`text-sm text-white ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
