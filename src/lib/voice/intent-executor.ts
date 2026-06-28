/**
 * Side-effect executor for parsed /sleep voice intents. All mutations go
 * through the existing `mixer` API — no direct AudioContext access — so we
 * never bypass the safety in mixer.ts (fade-outs, teardown order).
 *
 * Returns a small ExecutionResult the UI uses for the toast.
 */
import type { Intent } from "./intent-router";
import { mixer } from "@/lib/sounds/mixer";
import { TRACK_BY_SLUG, PRESETS } from "@/lib/sounds/catalog";
import { saveMix as saveMixDb } from "@/lib/sounds/mixes";

export type ExecutionResult = {
  ok: boolean;
  message: string;
  /** Optional reverse action so the UI can offer "Undo" for 5s. */
  undo?: () => Promise<void> | void;
};

export type ExecutorContext = {
  signedIn: boolean;
  /** When true, navigate is allowed; UI handles router import. */
  navigate: (to: string, search?: Record<string, string>) => void;
  /** UI-owned: open the inline breathing overlay. */
  openBreathing: () => void;
};

const WIND_DOWN_PRESET = PRESETS.find((p) => p.slug === "deep_sleep") ?? PRESETS[0];

export async function executeIntent(
  intent: Intent,
  ctx: ExecutorContext,
): Promise<ExecutionResult> {
  switch (intent.kind) {
    case "play_track": {
      const track = TRACK_BY_SLUG[intent.slug];
      if (!track) return { ok: false, message: `I don't know "${intent.label}" yet.` };
      const available = track.kind === "synth" || (track.kind === "file" && track.src);
      if (!available) return { ok: false, message: `${track.label} is coming soon.` };
      const wasActive = mixer.isActive(track.slug);
      await mixer.play(track.slug);
      return {
        ok: true,
        message: `Playing ${track.label}.`,
        undo: wasActive ? undefined : () => mixer.stop(track.slug),
      };
    }

    case "stop_all": {
      const snap = mixer.snapshot();
      if (snap.length === 0) return { ok: true, message: "Nothing was playing." };
      await mixer.stopAll();
      return {
        ok: true,
        message: "Stopped all sounds.",
        undo: () => mixer.applyMix(snap),
      };
    }

    case "set_timer": {
      mixer.setSleepTimer(intent.minutes);
      return {
        ok: true,
        message: `Sleep timer set for ${intent.minutes} minute${intent.minutes === 1 ? "" : "s"}.`,
        undo: () => mixer.clearTimer(),
      };
    }

    case "save_mix": {
      if (!ctx.signedIn) return { ok: false, message: "Sign in to save a mix." };
      const snap = mixer.snapshot();
      if (snap.length === 0) return { ok: false, message: "Start a sound first, then save." };
      const name = intent.name?.trim() || `Voice mix ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      try {
        await saveMixDb(name, snap);
        return { ok: true, message: `Saved "${name}".` };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "Couldn't save mix." };
      }
    }

    case "wake_at": {
      const hh = String(intent.hour).padStart(2, "0");
      const mm = String(intent.minute).padStart(2, "0");
      // Pass through query string so SmartAlarmCard can prefill in a later slice;
      // for now we navigate and toast the time so nothing fires automatically.
      ctx.navigate("/events", { wake: `${hh}:${mm}` });
      return { ok: true, message: `Opening Smart Alarm for ${hh}:${mm}.` };
    }

    case "sleep_mode":
    case "goodnight": {
      const snap = mixer.snapshot();
      await mixer.applyMix(WIND_DOWN_PRESET.tracks);
      mixer.setSleepTimer(45);
      return {
        ok: true,
        message: `${intent.kind === "goodnight" ? "Goodnight." : "Sleep mode on."} Wind-down preset · 45 min timer.`,
        undo: async () => {
          mixer.clearTimer();
          await mixer.applyMix(snap);
        },
      };
    }

    case "breathing": {
      ctx.openBreathing();
      return { ok: true, message: "Starting 4-7-8 breathing." };
    }

    case "cancel":
      return { ok: true, message: "Cancelled." };

    case "unknown": {
      if (intent.alternates && intent.alternates.length) {
        return { ok: false, message: `Did you mean ${intent.alternates.slice(0, 3).join(", ")}?` };
      }
      return { ok: false, message: "Sorry, I didn't catch that. Try 'play rain' or 'goodnight'." };
    }
  }
}
