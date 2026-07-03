import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Square, Heart, Trash2, Save, Timer, Volume2, Moon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { TRACKS, PRESETS, type SoundTrack } from "@/lib/sounds/catalog";
import { mixer } from "@/lib/sounds/mixer";
import { listMixes, saveMix, deleteMix, toggleFavorite } from "@/lib/sounds/mixes";
import { supabase } from "@/integrations/supabase/client";
import { VoiceCommandButton } from "@/components/sleep/VoiceCommandButton";
import { BreathingOverlay } from "@/components/sleep/BreathingOverlay";

export const Route = createFileRoute("/sleep")({
  component: SleepPage,
  head: () => ({
    meta: [
      { title: "Sleep Sounds — RestPilot AI" },
      {
        name: "description",
        content:
          "Mix calming rain, ocean, fan, and noise tracks. Save your favorite blends and drift off with a sleep timer.",
      },
    ],
  }),
});

const TIMERS = [15, 30, 45, 60, 90] as const;

function useMixerSnapshot() {
  // Force re-render whenever the mixer updates.
  const [, setTick] = useState(0);
  useEffect(() => {
    const unsub = mixer.subscribe(() => setTick((t) => t + 1));
    return () => { unsub(); };
  }, []);
}

function TrackCard({ track }: { track: SoundTrack }) {
  const active = mixer.isActive(track.slug);
  const volume = mixer.trackVolume(track.slug);
  const isAvailable = track.kind === "synth" || (track.kind === "file" && track.src);

  const toggle = useCallback(async () => {
    if (!isAvailable) {
      toast("Coming soon", { description: "We're adding this sound shortly." });
      return;
    }
    if (active) await mixer.stop(track.slug);
    else await mixer.play(track.slug);
  }, [active, isAvailable, track.slug]);

  return (
    <Card
      className={`relative overflow-hidden p-4 transition ${
        active
          ? "border-2 border-primary bg-primary/15 shadow-[var(--shadow-glow)]"
          : "border border-border/60 hover:border-border"
      } ${!isAvailable ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 text-left"
        aria-label={`${active ? "Stop" : "Play"} ${track.label}`}
      >
        <span className="text-3xl" aria-hidden>
          {track.emoji}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`truncate text-sm font-semibold ${active ? "text-primary" : ""}`}>{track.label}</p>
            {!isAvailable && (
              <Badge variant="outline" className="text-[10px]">
                Soon
              </Badge>
            )}
            {active && (
              <Badge className="border-primary/40 bg-primary/20 text-[10px] font-semibold text-primary">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse motion-reduce:animate-none rounded-full bg-primary" />
                Playing
              </Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {active ? "Playing" : track.kind === "synth" ? "Synthesized" : "Looping audio"}
          </p>
        </div>
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full border ${
            active ? "border-primary/60 bg-primary text-primary-foreground" : "border-border bg-background"
          }`}
        >
          {active ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </span>
      </button>

      {active && (
        <div className="mt-3 flex items-center gap-3">
          <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
          <Slider
            value={[Math.round(volume * 100)]}
            max={100}
            step={1}
            onValueChange={(v) => mixer.setTrackVolume(track.slug, (v[0] ?? 0) / 100)}
            className="flex-1"
            aria-label={`${track.label} volume`}
          />
          <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
            {Math.round(volume * 100)}%
          </span>
        </div>
      )}
    </Card>
  );
}

function SleepPage() {
  useMixerSnapshot();
  const qc = useQueryClient();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [mixName, setMixName] = useState("");
  const [timer, setTimer] = useState<number | null>(null);
  const [breathingOpen, setBreathingOpen] = useState(false);
  const masterRef = useRef(mixer.masterVolume);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (mounted) setSignedIn(Boolean(data.user));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(Boolean(session?.user));
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const mixesQuery = useQuery({
    queryKey: ["sound-mixes"],
    queryFn: listMixes,
    enabled: signedIn === true,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const snap = mixer.snapshot();
      if (snap.length === 0) throw new Error("Start some sounds first.");
      const name = mixName.trim() || "Untitled mix";
      await saveMix(name, snap);
    },
    onSuccess: () => {
      toast.success("Mix saved");
      setMixName("");
      void qc.invalidateQueries({ queryKey: ["sound-mixes"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save mix"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMix,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sound-mixes"] }),
  });

  const favoriteMutation = useMutation({
    mutationFn: ({ id, fav }: { id: string; fav: boolean }) => toggleFavorite(id, fav),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sound-mixes"] }),
  });

  const setTimerFor = (minutes: number | null) => {
    setTimer(minutes);
    mixer.setSleepTimer(minutes);
    if (minutes) toast(`Sleep timer set: ${minutes} min`);
    else mixer.clearTimer();
  };

  const activeCount = mixer.listActive().length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 lg:py-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <Moon className="h-3.5 w-3.5" />
          Sleep environment
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Build your soundscape
        </h1>
        <p className="text-sm text-muted-foreground">
          Tap any sound to start it, blend several together, then save the mix.
          The sleep timer fades everything out when you drift off.
        </p>
      </header>

      <VoiceCommandButton signedIn={Boolean(signedIn)} onBreathing={() => setBreathingOpen(true)} />

      {/* Presets */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Quick presets
        </h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.slug}
              size="sm"
              variant="outline"
              onClick={() => void mixer.applyMix(p.tracks)}
              className="rounded-full"
            >
              {p.name}
              <span className="ml-2 text-[10px] text-muted-foreground">{p.description}</span>
            </Button>
          ))}
          {activeCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void mixer.stopAll()}
              className="rounded-full text-muted-foreground"
            >
              Stop all
            </Button>
          )}
        </div>
      </section>

      {/* Master + timer controls */}
      <Card className="border-border/60 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex flex-1 items-center gap-3">
            <Volume2 className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Master
              </p>
              <Slider
                defaultValue={[Math.round(masterRef.current * 100)]}
                max={100}
                step={1}
                onValueChange={(v) => mixer.setMasterVolume((v[0] ?? 0) / 100)}
                aria-label="Master volume"
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Timer className="h-4 w-4 text-muted-foreground" />
            <span className="mr-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Timer
            </span>
            <Button
              size="sm"
              variant={timer === null ? "default" : "outline"}
              onClick={() => setTimerFor(null)}
              className="h-7 rounded-full px-3 text-[11px]"
            >
              Off
            </Button>
            {TIMERS.map((m) => (
              <Button
                key={m}
                size="sm"
                variant={timer === m ? "default" : "outline"}
                onClick={() => setTimerFor(m)}
                className="h-7 rounded-full px-3 text-[11px]"
              >
                {m}m
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Track grid */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TRACKS.map((t) => (
          <TrackCard key={t.slug} track={t} />
        ))}
      </section>

      {/* Save mix */}
      <Card className="border-border/60 p-4">
        <h2 className="text-sm font-semibold">Save this mix</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {activeCount > 0
            ? `${activeCount} sound${activeCount === 1 ? "" : "s"} playing.`
            : "Start a sound first."}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={mixName}
            onChange={(e) => setMixName(e.target.value)}
            placeholder="Name your mix (e.g. Rainy Night)"
            maxLength={60}
          />
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={activeCount === 0 || saveMutation.isPending || !signedIn}
            className="sm:w-32"
          >
            <Save className="mr-1.5 h-4 w-4" />
            Save
          </Button>
        </div>
        {!signedIn && signedIn !== null && (
          <p className="mt-2 text-[11px] text-muted-foreground">Sign in to save mixes.</p>
        )}
      </Card>

      {/* Saved mixes */}
      {signedIn && (mixesQuery.data?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Your mixes
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {mixesQuery.data?.map((m) => (
              <Card key={m.id} className="flex items-center gap-3 border-border/60 p-3">
                <button
                  type="button"
                  onClick={() => void mixer.applyMix(m.tracks)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Play className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {m.tracks.length} sound{m.tracks.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => favoriteMutation.mutate({ id: m.id, fav: !m.is_favorite })}
                  className={`rounded-full p-2 transition ${
                    m.is_favorite ? "text-rose-400" : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-label={m.is_favorite ? "Unfavorite" : "Favorite"}
                >
                  <Heart className={`h-4 w-4 ${m.is_favorite ? "fill-current" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(m.id)}
                  className="rounded-full p-2 text-muted-foreground hover:text-destructive"
                  aria-label="Delete mix"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <BreathingOverlay open={breathingOpen} onClose={() => setBreathingOpen(false)} />
    </div>
  );
}
