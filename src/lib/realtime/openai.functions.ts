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
