/**
 * OpenAI Realtime — ephemeral client_secret mint.
 *
 * Server-only. Exchanges the server-side OpenAI API key for a short-lived
 * ephemeral token (`ek_…`) that the browser uses to open a WebRTC session
 * directly against OpenAI Realtime via POST /v1/realtime/calls. The API
 * key never leaves the server.
 *
 * Uses the newer POST /v1/realtime/client_secrets endpoint (replaces the
 * deprecated /v1/realtime/sessions flow).
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
    // Reuse the existing OPENAI_REALTIME_API_KEY (previously used by the
    // LiveKit worker); fall back to OPENAI_API_KEY if defined. Either works —
    // both are standard OpenAI keys.
    const apiKey =
      process.env.OPENAI_API_KEY || process.env.OPENAI_REALTIME_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI Realtime is not configured");
    }

    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: DEFAULT_MODEL,
          audio: {
            output: { voice: DEFAULT_VOICE },
            input: {
              transcription: { model: "whisper-1" },
              // semantic_vad, low eagerness → matches the tuned LiveKit
              // behavior: natural 2–3s mid-sentence pauses don't end the turn.
              turn_detection: {
                type: "semantic_vad",
                eagerness: "low",
                create_response: true,
                interrupt_response: true,
              },
            },
          },
          instructions: INSTRUCTIONS,
          // Cap replies so the model doesn't compose essay-length answers.
          max_output_tokens: 200,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[realtime/openai] client_secret_mint_fail status=${res.status} body=${detail.slice(0, 240)}`,
      );
      if (res.status === 429) throw new Error("OpenAI rate limit reached");
      if (res.status === 401) throw new Error("OpenAI key rejected");
      throw new Error("Failed to mint realtime client secret");
    }

    // POST /v1/realtime/client_secrets returns:
    //   { value: "ek_…", expires_at: <epoch seconds>, session: {...} }
    const data = (await res.json()) as {
      value?: string;
      expires_at?: number;
      session?: { model?: string; audio?: { output?: { voice?: string } } };
    };
    const value = data.value;
    if (!value) throw new Error("Missing client_secret value in mint response");

    const expiresAt =
      typeof data.expires_at === "number"
        ? data.expires_at * 1000
        : Date.now() + 55_000;

    return {
      clientSecret: value,
      expiresAt,
      model: data.session?.model ?? DEFAULT_MODEL,
      voice: data.session?.audio?.output?.voice ?? DEFAULT_VOICE,
    };
  });
