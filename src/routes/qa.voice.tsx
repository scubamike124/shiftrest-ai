// QA harness for Phase 1 Premium Voice System.
// 4 voices × 3 modes = 12 cells. Production /api/tts pipeline via speak().
// Provider toggle forces ElevenLabs ↔ OpenAI fallback for the same matrix.
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { speak, stopSpeaking } from "@/lib/companion/speak";
import {
  ELEVEN_VOICES,
  getTtsProvider,
  setTtsProvider,
  type CompanionTtsProvider,
} from "@/lib/companion/renderer-pref";
import { loadLocalPrefs, saveLocalPrefs } from "@/lib/companion/voice-action-prefs";

export const Route = createFileRoute("/qa/voice")({
  head: () => ({
    meta: [
      { title: "Voice QA — RestPilot AI" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: VoiceQAPage,
  errorComponent: ({ error, reset }) => {
    const r = useRouter();
    return (
      <div className="p-6 text-sm">
        <p className="font-medium">QA harness error</p>
        <pre className="mt-2 whitespace-pre-wrap text-xs opacity-80">{String(error)}</pre>
        <button
          className="mt-3 rounded bg-foreground px-3 py-1 text-background"
          onClick={() => { reset(); void r.invalidate(); }}
        >Retry</button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

type Mode = "normal" | "sleep" | "encouraging";
type Status = "pending" | "pass" | "fail";

const MODES: { id: Mode; label: string; script: string }[] = [
  {
    id: "normal",
    label: "Normal",
    script:
      "Hey, quick check-in. It's 8:30, you've got about 14 hours before your next shift. Want me to block out a short reset before dinner?",
  },
  {
    id: "sleep",
    label: "Sleep",
    script:
      "Let your shoulders drop. Breathe in slowly through your nose, and out through your mouth. You're safe, you're done for the day, and rest is on its way.",
  },
  {
    id: "encouraging",
    label: "Encouraging",
    script:
      "Good morning! You slept seven hours and twelve minutes — that's a real win. Let's make today count. What's the one thing you want to nail first?",
  },
];

type CellKey = `${string}__${Mode}__${CompanionTtsProvider}`;
type Result = {
  voiceId: string;
  voiceLabel: string;
  mode: Mode;
  provider: CompanionTtsProvider;
  status: Status;
  notes: string;
  updatedAt: string;
};

const STORAGE_KEY = "qa.voice.results.v1";
const CATALOG_KEY = "qa.voice.catalog.v1";

function loadResults(): Record<CellKey, Result> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveResults(r: Record<CellKey, Result>) {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch { /* noop */ }
}
function loadCatalog(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(window.localStorage.getItem(CATALOG_KEY) || "{}"); }
  catch { return {}; }
}
function saveCatalog(c: Record<string, boolean>) {
  try { window.localStorage.setItem(CATALOG_KEY, JSON.stringify(c)); } catch { /* noop */ }
}

function keyOf(voiceId: string, mode: Mode, provider: CompanionTtsProvider): CellKey {
  return `${voiceId}__${mode}__${provider}` as CellKey;
}

function VoiceQAPage() {
  const [provider, setProvider] = useState<CompanionTtsProvider>(() =>
    typeof window === "undefined" ? "elevenlabs" : getTtsProvider(),
  );
  const [results, setResults] = useState<Record<CellKey, Result>>(() => loadResults());
  const [catalog, setCatalog] = useState<Record<string, boolean>>(() => {
    const saved = loadCatalog();
    if (Object.keys(saved).length) return saved;
    return Object.fromEntries(ELEVEN_VOICES.map((v) => [v.id, true]));
  });
  const [playing, setPlaying] = useState<string | null>(null);

  // Enable voice replies + bypass quiet hours for the harness session so
  // production gates never silently swallow a test playback.
  useEffect(() => {
    const prefs = loadLocalPrefs();
    if (!prefs.voiceRepliesEnabled) {
      saveLocalPrefs({ ...prefs, voiceRepliesEnabled: true });
    }
  }, []);

  useEffect(() => saveResults(results), [results]);
  useEffect(() => saveCatalog(catalog), [catalog]);

  const setForcedProvider = useCallback((p: CompanionTtsProvider) => {
    setProvider(p);
    setTtsProvider(p);
  }, []);

  const play = useCallback(async (voiceId: string, mode: Mode, script: string) => {
    const cellId = `${voiceId}__${mode}`;
    stopSpeaking();
    setPlaying(cellId);
    try {
      await speak(script, { voice: voiceId, mode, source: "manual" });
    } finally {
      setPlaying((cur) => (cur === cellId ? null : cur));
    }
  }, []);

  const mark = useCallback((voiceId: string, voiceLabel: string, mode: Mode, status: Status) => {
    setResults((prev) => {
      const k = keyOf(voiceId, mode, provider);
      const cur = prev[k];
      return {
        ...prev,
        [k]: {
          voiceId, voiceLabel, mode, provider, status,
          notes: cur?.notes ?? "",
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, [provider]);

  const setNotes = useCallback((voiceId: string, voiceLabel: string, mode: Mode, notes: string) => {
    setResults((prev) => {
      const k = keyOf(voiceId, mode, provider);
      const cur = prev[k];
      return {
        ...prev,
        [k]: {
          voiceId, voiceLabel, mode, provider,
          status: cur?.status ?? "pending",
          notes,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, [provider]);

  const totals = useMemo(() => {
    const all = Object.values(results);
    return {
      pass: all.filter((r) => r.status === "pass").length,
      fail: all.filter((r) => r.status === "fail").length,
      total: ELEVEN_VOICES.length * MODES.length * 2, // both providers
    };
  }, [results]);

  const exportJson = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      providerAtExport: provider,
      voices: ELEVEN_VOICES,
      modes: MODES,
      results: Object.values(results),
      productionCatalog: ELEVEN_VOICES.filter((v) => catalog[v.id]).map((v) => v.label),
    };
    download("voice-qa-results.json", JSON.stringify(payload, null, 2), "application/json");
  }, [results, catalog, provider]);

  const exportMarkdown = useCallback(() => {
    const lines: string[] = [];
    lines.push(`# Voice Catalog QA — ${new Date().toISOString()}`);
    lines.push("");
    for (const p of ["elevenlabs", "openai"] as CompanionTtsProvider[]) {
      lines.push(`## Provider: ${p === "elevenlabs" ? "ElevenLabs (primary)" : "OpenAI (forced fallback)"}`);
      lines.push("");
      lines.push("| Voice | Mode | Status | Notes |");
      lines.push("|---|---|---|---|");
      for (const v of ELEVEN_VOICES) {
        for (const m of MODES) {
          const r = results[keyOf(v.id, m.id, p)];
          const status = r?.status ?? "pending";
          const notes = (r?.notes ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
          lines.push(`| ${v.label} | ${m.label} | ${status.toUpperCase()} | ${notes} |`);
        }
      }
      lines.push("");
    }
    lines.push("## Final Production Catalog");
    lines.push("");
    for (const v of ELEVEN_VOICES) {
      lines.push(`- [${catalog[v.id] ? "x" : " "}] ${v.label} — ${v.tone}`);
    }
    download("voice-qa-results.md", lines.join("\n"), "text/markdown");
  }, [results, catalog]);

  const resetAll = useCallback(() => {
    if (!window.confirm("Clear all QA results for the current run?")) return;
    setResults({});
  }, []);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Premium Voice QA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          4 voices × 3 modes = 12 cells per provider. Test on iPhone speaker + AirPods, at normal and bedtime volume.
        </p>
      </header>

      <section className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card/40 p-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider</span>
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setForcedProvider("elevenlabs")}
            className={`px-3 py-1.5 text-sm ${provider === "elevenlabs" ? "bg-foreground text-background" : "bg-transparent"}`}
          >ElevenLabs (primary)</button>
          <button
            onClick={() => setForcedProvider("openai")}
            className={`px-3 py-1.5 text-sm border-l border-border ${provider === "openai" ? "bg-foreground text-background" : "bg-transparent"}`}
          >Forced OpenAI fallback</button>
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          Pass {totals.pass} · Fail {totals.fail} · of {totals.total}
        </span>
        <button onClick={exportMarkdown} className="rounded-md border border-border px-3 py-1.5 text-sm">Export Markdown</button>
        <button onClick={exportJson} className="rounded-md border border-border px-3 py-1.5 text-sm">Export JSON</button>
        <button onClick={resetAll} className="rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive">Reset</button>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ELEVEN_VOICES.flatMap((v) =>
          MODES.map((m) => {
            const cellId = `${v.id}__${m.id}`;
            const r = results[keyOf(v.id, m.id, provider)];
            const isPlaying = playing === cellId;
            return (
              <article key={cellId} className="rounded-lg border border-border bg-card/40 p-3">
                <header className="mb-2 flex items-baseline justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{v.label}</h2>
                    <p className="text-xs text-muted-foreground">{v.tone}</p>
                  </div>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">{m.label}</span>
                </header>
                <p className="mb-3 text-sm leading-relaxed">{m.script}</p>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => void play(v.id, m.id, m.script)}
                    className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
                    disabled={isPlaying}
                  >{isPlaying ? "Playing…" : "▶ Play"}</button>
                  <button
                    onClick={() => mark(v.id, v.label, m.id, "pass")}
                    className={`rounded-md border px-3 py-1.5 text-sm ${r?.status === "pass" ? "border-green-500 bg-green-500/15 text-green-700 dark:text-green-300" : "border-border"}`}
                  >PASS</button>
                  <button
                    onClick={() => mark(v.id, v.label, m.id, "fail")}
                    className={`rounded-md border px-3 py-1.5 text-sm ${r?.status === "fail" ? "border-red-500 bg-red-500/15 text-red-700 dark:text-red-300" : "border-border"}`}
                  >FAIL</button>
                </div>
                <textarea
                  value={r?.notes ?? ""}
                  onChange={(e) => setNotes(v.id, v.label, m.id, e.target.value)}
                  placeholder="Notes: device, volume, what stood out…"
                  className="h-16 w-full rounded-md border border-border bg-background/60 p-2 text-xs"
                />
              </article>
            );
          }),
        )}
      </div>

      <section className="mt-8 rounded-lg border border-border bg-card/40 p-4">
        <h2 className="text-lg font-semibold">Final Production Catalog</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          After both provider passes, keep only voices that are premium across every mode and both devices.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {ELEVEN_VOICES.map((v) => (
            <li key={v.id} className="flex items-center gap-2 rounded-md border border-border p-2">
              <input
                type="checkbox"
                checked={!!catalog[v.id]}
                onChange={(e) => setCatalog((c) => ({ ...c, [v.id]: e.target.checked }))}
              />
              <span className="text-sm font-medium">{v.label}</span>
              <span className="text-xs text-muted-foreground">{v.tone}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
