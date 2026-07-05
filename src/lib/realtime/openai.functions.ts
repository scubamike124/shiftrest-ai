/**
 * OpenAI Realtime — ephemeral session mint.
 *
 * Server-only. Exchanges the server-side OpenAI API key for a short-lived
 * client_secret that the browser uses to open a WebRTC session directly
 * against OpenAI Realtime. The API key never leaves the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type RealtimeSessionResult = {
  clientSecret: string;
  expiresAt: number; // epoch ms
  model: string;
  voice: string;
};

const DEFAULT_MODEL = "gpt-realtime";
const DEFAULT_VOICE = "alloy";

// Reply-shape system prompt — keeps answers conversational and short so
// audio starts fast and there are no long paragraph gaps between sentences.
const INSTRUCTIONS = [
  "You are RestPilot, a warm and calm sleep and rest companion.",
  "Speak like a person on a phone call: one or two short sentences at a time.",
  "Use plain, natural conversational language. No lists, no headings, no long paragraphs.",
  "Give the shortest useful answer first, then offer to go deeper if the user wants more.",
  "Pause after a beat so the user can respond. Never lecture.",
].join(" ");

export const mintRealtimeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<RealtimeSessionResult> => {
    // Reuse OPENAI_REALTIME_API_KEY if present, fall back to OPENAI_API_KEY.
    const apiKey =
      process.env.OPENAI_API_KEY || process.env.OPENAI_REALTIME_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI Realtime is not configured");
    }

    const res = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        voice: DEFAULT_VOICE,
        modalities: ["audio", "text"],
        instructions: INSTRUCTIONS,
        // server_vad with a long silence window so natural 2–3s mid-thought
        // pauses don't get treated as end-of-turn. Threshold + prefix padding
        // stay at OpenAI defaults.
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 2500,
          create_response: true,
          interrupt_response: true,
        },
        // Cap replies so the model doesn't compose essay-length answers that
        // land with long TTS pauses at every paragraph break.
        max_response_output_tokens: 200,
        // Enables the transcript panel in the lab UI.
        input_audio_transcription: { model: "whisper-1" },
      }),
    });


    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[realtime/openai] session_mint_fail status=${res.status} body=${detail.slice(0, 240)}`,
      );
      if (res.status === 429) throw new Error("OpenAI rate limit reached");
      if (res.status === 401) throw new Error("OpenAI key rejected");
      throw new Error("Failed to mint realtime session");
    }

    const data = (await res.json()) as {
      client_secret?: { value?: string; expires_at?: number };
      model?: string;
      voice?: string;
    };
    const value = data.client_secret?.value;
    if (!value) throw new Error("Missing client_secret in session response");

    // OpenAI returns expires_at as epoch seconds; convert to ms.
    const expSec = data.client_secret?.expires_at;
    const expiresAt =
      typeof expSec === "number" ? expSec * 1000 : Date.now() + 55_000;

    return {
      clientSecret: value,
      expiresAt,
      model: data.model ?? DEFAULT_MODEL,
      voice: data.voice ?? DEFAULT_VOICE,
    };
  });
