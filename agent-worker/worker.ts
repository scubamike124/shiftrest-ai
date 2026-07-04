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

const BASE_SYSTEM_INSTRUCTIONS = [
  "You are Pilot, RestPilot's sleep and recovery voice companion.",
  "Speak in short, warm, conversational turns — you are speaking, not writing.",
  "Never introduce yourself twice in a session.",
  "Never use the user's email address prefix as their name.",
  "If the user starts speaking while you are speaking, stop immediately and listen.",
].join(" ");

function parseUserName(metadata: string | undefined | null): {
  displayName: string | null;
  firstName: string | null;
} {
  if (!metadata) return { displayName: null, firstName: null };
  try {
    const parsed = JSON.parse(metadata) as {
      displayName?: string | null;
      firstName?: string | null;
    };
    return {
      displayName: parsed.displayName ?? null,
      firstName: parsed.firstName ?? null,
    };
  } catch {
    return { displayName: null, firstName: null };
  }
}

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

    const { displayName, firstName } = parseUserName(
      (participant as any).metadata,
    );
    const name = firstName ?? displayName;
    console.log(`[worker] user name=${name ?? "<none>"}`);

    const instructions = name
      ? `${BASE_SYSTEM_INSTRUCTIONS} The user's name is ${name}. Address them by their first name naturally, but do not overuse it.`
      : BASE_SYSTEM_INSTRUCTIONS;

    const model = new openai.realtime.RealtimeModel({
      apiKey: process.env.OPENAI_REALTIME_API_KEY,
      model: "gpt-realtime",
      voice: "marin",
      turnDetection: {
        type: "server_vad",
        threshold: 0.6,
        prefix_padding_ms: 500,
        silence_duration_ms: 900,
        create_response: true,
        interrupt_response: false,
      },
    });

    const agent = new voice.Agent({
      instructions,
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

    const UserStartedSpeaking = (voice.AgentSessionEventTypes as any).UserStartedSpeaking;
    if (UserStartedSpeaking) {
      session.on(UserStartedSpeaking, () => {
        console.log("[worker] UserStartedSpeaking");
      });
    }

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      console.log(`[worker] UserInputTranscribed final=${ev.isFinal} text=${ev.transcript}`);
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

    // Warm the OpenAI Realtime session with an opening greeting so the
    // first user turn does not pay cold-start latency.
    const greetingInstructions = name
      ? `Greet ${name} warmly by name in exactly two words, such as "Hi ${name}." or "Good morning, ${name}." No second sentence. Do not ask how you can help until the user speaks.`
      : "Greet the user warmly in exactly two words, such as \"Hi there.\" No second sentence. Do not ask how you can help until the user speaks.";
    try {
      await (session as any).generateReply({ instructions: greetingInstructions });
    } catch (err) {
      console.log(`[worker] initial generateReply failed: ${(err as Error)?.message ?? err}`);
    }

    void participant;
  },
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
}

