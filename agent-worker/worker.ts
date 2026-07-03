/**
 * RestPilot Realtime Agent Worker.
 *
 * Runs OUTSIDE the TanStack app (Node.js on LiveKit Cloud or self-hosted).
 * Do not import this file from the app.
 *
 * Responsibilities:
 *   - Register a LiveKit Agent worker.
 *   - When dispatched into a `pilot-<userId>` room, open an OpenAI
 *     Realtime session using @livekit/agents-plugin-openai.
 *   - Publish Realtime audio back into the room and forward transcript
 *     events on the data channel so the browser UI can render them.
 *
 * Tools (memory / signals / sleep / recovery / schedule) are Phase 3.
 */
import {
  AutoSubscribe,
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  llm,
  pipeline,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";

const SYSTEM_INSTRUCTIONS = [
  "You are Pilot, RestPilot's sleep and recovery voice companion.",
  "Keep responses concise, warm, and conversational — you are speaking, not writing.",
  "Never introduce yourself twice in a session. Never use the user's email prefix as a name.",
  "If the user interrupts, stop immediately and listen.",
].join(" ");

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    const participant = await ctx.waitForParticipant();

    const model = new openai.realtime.RealtimeModel({
      apiKey: process.env.OPENAI_REALTIME_API_KEY!,
      model: "gpt-realtime",
      voice: "marin",
      instructions: SYSTEM_INSTRUCTIONS,
      turnDetection: {
        type: "server_vad",
        threshold: 0.5,
        prefixPaddingMs: 200,
        silenceDurationMs: 400,
      },
    });

    const agent = new pipeline.VoicePipelineAgent(new llm.ChatContext(), {
      // Realtime plugin owns STT + LLM + TTS in one duplex stream.
      llm: model,
    });

    agent.on("user_speech_committed", (msg: llm.ChatMessage) => {
      void ctx.room.localParticipant?.publishData(
        new TextEncoder().encode(
          JSON.stringify({ type: "transcript", from: "user", text: msg.content, final: true }),
        ),
        { reliable: true },
      );
    });

    agent.on("agent_speech_committed", (msg: llm.ChatMessage) => {
      void ctx.room.localParticipant?.publishData(
        new TextEncoder().encode(
          JSON.stringify({ type: "transcript", from: "assistant", text: msg.content, final: true }),
        ),
        { reliable: true },
      );
    });

    agent.start(ctx.room, participant);
  },
});

cli.runApp(new WorkerOptions({ agent: __filename }));
