/**
 * Live voice (OpenAI Realtime, model gpt-realtime) cost model: ONE place for
 * prices, conversions and the resulting worst-case dollars and debit.
 * Full write-up: docs/restpilot-upgrade-2026-11/VOICE-COST-MODEL.md
 *
 * Sources (read 2026-11-15; re-check before relying on them):
 *  - Prices: https://developers.openai.com/api/docs/pricing
 *  - Audio tokens, whole conversation re-sent per response:
 *    https://developers.openai.com/api/docs/guides/realtime-costs
 *  - Max session 60 min: https://developers.openai.com/api/docs/guides/realtime-conversations
 *  - expires_after 10..7200 s, truncation.token_limits.post_instructions, max_output_tokens:
 *    https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create
 *  - ElevenLabs TTS $0.04 / 1K chars (Flash): https://elevenlabs.io/pricing/api
 */

/** USD per 1,000,000 tokens (gpt-realtime). */
export const OPENAI_REALTIME_USD_PER_M = {
  audioIn: 32,
  audioInCached: 0.4,
  audioOut: 64,
  textIn: 4,
  textOut: 16,
} as const;

/** Documented audio-to-token conversion. */
export const AUDIO_TOKENS_PER_SECOND = { input: 10, output: 20 } as const;

export const VOICE_LIMITS = {
  /** Hard deadline the client is given. */
  MAX_SESSION_SECONDS: 180,
  /** Ephemeral token lifetime (API minimum is 10 s). It only has to survive the handshake. */
  TOKEN_TTL_SECONDS: 60,
  /** Session-level context cap sent as truncation.token_limits.post_instructions. */
  POST_INSTRUCTIONS_TOKENS: 2000,
  /** Per-response output cap (max_output_tokens). */
  MAX_OUTPUT_TOKENS: 400,
  /** Our system prompt, measured ~850 tokens by default; custom override adds up to ~375 more. */
  INSTRUCTION_TOKENS_ASSUMED: 1500,
  /** Assumed most responses per minute an unmodified client can trigger (turn detection). */
  HONEST_RESPONSES_PER_MIN: 6,
  /** Assumed responses per minute a scripted client could trigger via response.create. */
  HOSTILE_RESPONSES_PER_MIN: 60,
  /** OpenAI's own maximum Realtime session length. */
  PROVIDER_MAX_SESSION_MINUTES: 60,
} as const;

/**
 * 1 "token-equivalent" in the daily cap (user_prefs cap / has_ai_budget) = this
 * many US dollars: $20 per 1M. With the premium cap of 500,000 that is a
 * $10/day ceiling for premium and $0.30/day for the free tier's 15,000. This is
 * an OWNER decision (see the doc); change it here and the debit follows.
 */
export const TOKEN_EQUIVALENT_USD = 0.00002;

const per = (usdPerM: number) => usdPerM / 1_000_000;

/**
 * Worst-case USD per minute for an UNMODIFIED client: every response re-sends
 * the full capped context as uncached audio input, and the model talks as
 * much as real time allows (20 audio tokens/s).
 */
export function worstCaseUsdPerMinute(responsesPerMin: number = VOICE_LIMITS.HONEST_RESPONSES_PER_MIN) {
  const ctx = VOICE_LIMITS.INSTRUCTION_TOKENS_ASSUMED + VOICE_LIMITS.POST_INSTRUCTIONS_TOKENS;
  const inputTokens = responsesPerMin * ctx;
  const outputTokens = Math.min(
    responsesPerMin * VOICE_LIMITS.MAX_OUTPUT_TOKENS,
    AUDIO_TOKENS_PER_SECOND.output * 60,
  );
  return (
    inputTokens * per(OPENAI_REALTIME_USD_PER_M.audioIn) +
    outputTokens * per(OPENAI_REALTIME_USD_PER_M.audioOut)
  );
}

export const usdToTokenEquivalents = (usd: number) => Math.ceil(usd / TOKEN_EQUIVALENT_USD);

/** Token-equivalents charged per started minute of session (honest worst case). */
export const TOKENS_PER_MINUTE = usdToTokenEquivalents(worstCaseUsdPerMinute());

/** Worst-case debit at mint: the maximum session the deadline allows. */
export const WORST_CASE_DEBIT_TOKENS =
  Math.ceil(VOICE_LIMITS.MAX_SESSION_SECONDS / 60) * TOKENS_PER_MINUTE;

/** Max dollars of ONE mint for a client that obeys the deadline. */
export const maxUsdPerMint = () =>
  (VOICE_LIMITS.MAX_SESSION_SECONDS / 60) * worstCaseUsdPerMinute();

/** Max dollars of one mint for a modified client that ignores the deadline (provider 60-min cap). */
export const hostileUsdPerMint = () =>
  VOICE_LIMITS.PROVIDER_MAX_SESSION_MINUTES *
  worstCaseUsdPerMinute(VOICE_LIMITS.HOSTILE_RESPONSES_PER_MIN);

/** How many worst-case mints a daily cap (in token-equivalents) allows. */
export const mintsPerDay = (cap: number) => Math.floor((cap - 1) / WORST_CASE_DEBIT_TOKENS);
