/**
 * RestPilot Realtime Agent Worker.
 *
 * Runs OUTSIDE the TanStack app (Node.js on LiveKit Cloud or self-hosted).
 * Do NOT import this file from the app — it uses `@livekit/rtc-node` and
 * server-only APIs that are not compatible with the Cloudflare Worker
 * runtime.
 *
 * Responsibilities (Phase 3A):
 *   - Register a LiveKit Agent worker.
 *   - When dispatched into a `pilot-<userId>` room, start an AgentSession
 *     that owns audio I/O for the room.
 *   - Drive the session with OpenAI Realtime (`gpt-realtime`) via
 *     @livekit/agents-plugin-openai. One consistent voice, native VAD /
 *     barge-in, no separate STT or TTS.
 *   - Publish transcript events on the LiveKit data channel so the
 *     hidden `/lab/pilot-realtime` UI can render them.
 *
 * Tools (memory / signals / sleep / recovery / schedule) are Phase 3B.
 */
import { fileURLToPath } from "node:url";
import {
  AutoSubscribe,
  type JobContext,
  ServerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";

const SYSTEM_INSTRUCTIONS = [
  "You are Pilot, RestPilot's sleep and recovery voice companion.",
  "Speak in short, warm, conversational turns — you are speaking, not writing.",
  "Never introduce yourself twice in a session.",
  "Never use the user's email address prefix as their name.",
  "If the user starts speaking while you are speaking, stop immediately and listen.",
].join(" ");

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);

    ctx.room.on("trackSubscribed", (track: any, _pub: any, participant: any) => {
      console.log(
        `[worker] TrackSubscribed identity=${participant?.identity} kind=${track?.kind} source=${track?.source}`,
      );
    });

    const participant = await ctx.waitForParticipant();
    console.log(`[worker] participant joined identity=${participant.identity}`);


    const model = new openai.realtime.RealtimeModel({
      apiKey: process.env.OPENAI_REALTIME_API_KEY,
      model: "gpt-realtime",
      voice: "marin",
    });

    const agent = new voice.Agent({
      instructions: SYSTEM_INSTRUCTIONS,
      llm: model,
    });

    const session = new voice.AgentSession({});

    const publish = (payload: unknown) => {
      const room = ctx.room;
      const local = room?.localParticipant;
      if (!local) return;
      try {
        void local.publishData(
          new TextEncoder().encode(JSON.stringify(payload)),
          { reliable: true },
        );
      } catch {
        /* best-effort telemetry */
      }
    };

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (!ev.isFinal) return;
      publish({ type: "transcript", from: "user", text: ev.transcript, final: true });
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const item = ev.item as { role?: string; content?: unknown } | undefined;
      if (!item || item.role !== "assistant") return;
      const text = Array.isArray(item.content)
        ? item.content
            .filter((c): c is string => typeof c === "string")
            .join(" ")
            .trim()
        : typeof item.content === "string"
          ? item.content.trim()
          : "";
      if (!text) return;
      publish({ type: "transcript", from: "assistant", text, final: true });
    });

    await session.start({ agent, room: ctx.room });

    // Reserved: participant identity is `pilot-<userId>`; used in Phase 3B
    // to fetch RestPilot memory/signals for the session.
    void participant;
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
}
