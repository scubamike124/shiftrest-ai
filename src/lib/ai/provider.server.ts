/** Direct OpenAI-compatible providers. No Lovable gateway or token is used. */
export function aiApiKey(audio = false): string | undefined {
  return audio ? process.env.AI_AUDIO_API_KEY || process.env.OPENAI_API_KEY : process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
}
export function aiEndpoint(path: 'chat/completions' | 'audio/speech' | 'audio/transcriptions'): string {
  const audio = path.startsWith('audio/');
  const raw = (audio ? process.env.AI_AUDIO_BASE_URL : process.env.AI_BASE_URL)
    || (process.env.OPENAI_API_KEY ? 'https://api.openai.com/v1' : undefined);
  if (!raw) throw new Error('AI provider endpoint is not configured');
  const base = new URL(raw);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Invalid AI provider endpoint');
  if (base.hostname === 'lovable.dev' || base.hostname.endsWith('.lovable.dev')) throw new Error('Use a direct AI provider endpoint');
  return base.href.replace(/\/$/,'') + '/' + path;
}
export function aiAudioModel(kind:'tts'|'stt'): string {
  const model = process.env[kind === 'tts' ? 'AI_TTS_MODEL' : 'AI_STT_MODEL'];
  if (!model) throw new Error('Audio model is not configured');
  return model;
}
