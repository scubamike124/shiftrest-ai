// Voice personalization catalog + helpers. Client-safe (no server imports).
// Shared between settings UI and the /api/tts route.

export type VoiceGender = "female" | "male" | "neutral";

export type VoiceOption = {
  id: string;          // openai voice id
  label: string;       // user-facing
  gender: VoiceGender;
  tone: string;        // descriptor
};

export const VOICE_OPTIONS: VoiceOption[] = [
  { id: "sage",    label: "Sage",    gender: "female",  tone: "Calm & warm" },
  { id: "coral",   label: "Coral",   gender: "female",  tone: "Bright & friendly" },
  { id: "shimmer", label: "Shimmer", gender: "female",  tone: "Soft & soothing" },
  { id: "nova",    label: "Nova",    gender: "female",  tone: "Upbeat & energetic" },
  { id: "ash",     label: "Ash",     gender: "male",    tone: "Steady & grounded" },
  { id: "ballad",  label: "Ballad",  gender: "male",    tone: "Calm & reassuring" },
  { id: "echo",    label: "Echo",    gender: "male",    tone: "Clear & confident" },
  { id: "alloy",   label: "Alloy",   gender: "neutral", tone: "Neutral & balanced" },
  { id: "verse",   label: "Verse",   gender: "neutral", tone: "Expressive coach" },
];

export type LanguageOption = {
  code: string;        // BCP-47
  label: string;
  sample: string;      // short preview phrase in this language
};

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en-US", label: "English (US)",          sample: "Hi! I'm your Pilot. I'll help you sleep smarter and recover faster." },
  { code: "en-GB", label: "English (UK)",          sample: "Hello! I'm your Pilot. Let's help you sleep better and recover faster." },
  { code: "en-AU", label: "English (Australia)",   sample: "G'day! I'm your Pilot. Let's get your sleep and recovery on track." },
  { code: "en-CA", label: "English (Canada)",      sample: "Hi! I'm your Pilot. Let's help you sleep smarter and feel better." },
  { code: "es-MX", label: "Spanish (Mexico)",      sample: "¡Hola! Soy tu Pilot. Te ayudaré a dormir mejor y recuperarte más rápido." },
  { code: "es-ES", label: "Spanish (Spain)",       sample: "¡Hola! Soy tu Pilot. Te ayudaré a dormir mejor y a recuperarte más rápido." },
  { code: "fr-FR", label: "French",                sample: "Bonjour, je suis votre Pilot. Je vais vous aider à mieux dormir et à mieux récupérer." },
  { code: "de-DE", label: "German",                sample: "Hallo, ich bin dein Pilot. Ich helfe dir, besser zu schlafen und dich schneller zu erholen." },
  { code: "it-IT", label: "Italian",               sample: "Ciao, sono il tuo Pilot. Ti aiuterò a dormire meglio e a recuperare più in fretta." },
  { code: "pt-BR", label: "Portuguese (Brazil)",   sample: "Olá! Eu sou seu Pilot. Vou te ajudar a dormir melhor e se recuperar mais rápido." },
  { code: "pt-PT", label: "Portuguese (Portugal)", sample: "Olá! Sou o seu Pilot. Vou ajudá-lo a dormir melhor e a recuperar mais depressa." },
  { code: "ja-JP", label: "Japanese",              sample: "こんにちは。私はあなたのパイロットです。より良い睡眠と回復をサポートします。" },
  { code: "ko-KR", label: "Korean",                sample: "안녕하세요. 저는 당신의 파일럿입니다. 더 잘 자고 빠르게 회복하도록 돕겠습니다." },
  { code: "zh-CN", label: "Chinese (Mandarin)",    sample: "你好,我是你的Pilot。我会帮你睡得更好,恢复得更快。" },
  { code: "vi-VN", label: "Vietnamese",            sample: "Xin chào, tôi là Pilot của bạn. Tôi sẽ giúp bạn ngủ ngon hơn và hồi phục nhanh hơn." },
  { code: "hi-IN", label: "Hindi",                 sample: "नमस्ते, मैं आपका पायलट हूँ। मैं आपको बेहतर नींद और तेज़ रिकवरी में मदद करूँगा।" },
];

export const ACCENT_OPTIONS: Record<string, string[]> = {
  en: ["American", "British", "Australian", "Canadian", "Irish", "Scottish"],
  es: ["Mexican", "Castilian (Spain)", "Argentine", "Colombian"],
  pt: ["Brazilian", "European"],
  fr: ["Parisian", "Canadian"],
  de: ["Standard", "Austrian", "Swiss"],
  zh: ["Mainland Mandarin", "Taiwanese Mandarin"],
};

export function accentsForLanguage(code: string): string[] {
  const base = code.split("-")[0]?.toLowerCase() ?? "";
  return ACCENT_OPTIONS[base] ?? [];
}

export type PersonalityKey =
  | "calm"
  | "friendly"
  | "professional"
  | "motivational"
  | "companion"
  | "coach"
  | "energetic";

export const PERSONALITY_OPTIONS: { key: PersonalityKey; label: string; desc: string }[] = [
  { key: "calm",         label: "Calm",         desc: "Warm, steady, reassuring." },
  { key: "friendly",     label: "Friendly",     desc: "Bright and conversational." },
  { key: "professional", label: "Professional", desc: "Clear and confident." },
  { key: "motivational", label: "Motivational", desc: "Upbeat and encouraging." },
  { key: "companion",    label: "Companion",    desc: "Gentle and personal." },
  { key: "coach",        label: "Coach",        desc: "Direct and supportive." },
  { key: "energetic",    label: "Energetic",    desc: "High momentum, brisk." },
];

const PERSONALITY_TEMPLATES: Record<PersonalityKey, string> = {
  calm:         "Speak like a calm, present human friend — warm, unhurried, never robotic. Take a soft breath before the first word so the line starts naturally, not abruptly. Land each sentence with a gentle downstep instead of a flat tail. Vary pace within a sentence: a touch quicker on supporting clauses, a touch slower on the key idea. Read times the way a person would ('eight o'clock', 'eight a.m.' — never 'eight colon zero zero') and never read punctuation aloud. Allow tiny natural micro-pauses where a person would breathe.",
  friendly:     "Speak warmly and brightly, like a close friend genuinely glad to hear from them. Conversational rhythm, real breath pauses, pitch that moves — never stiff or sing-song.",
  professional: "Speak with clear, composed confidence. Measured pacing, precise diction, warmth underneath the polish. Natural pitch movement, not a newsreader monotone.",
  motivational: "Speak with upbeat, forward-leaning energy, like a coach who believes in them. Confident lift on the verb, soft on the encouragement. Never pushy, never shouty.",
  companion:    "Speak gently and personally, the way you'd talk to someone you care about. Soft pacing, real warmth, occasional small breath between thoughts. Avoid anything that sounds read aloud.",
  coach:        "Speak with direct, supportive coaching energy. Clear, confident, action-oriented — still warm. Stress the action word, soften the ask.",
  energetic:    "Speak with high, natural energy. Brisk but clean, audibly smiling, momentum without rushing.",
};

export type VoiceProfile = {
  voiceId: string;
  language: string;       // BCP-47
  accent: string | null;
  personality: PersonalityKey;
  speed: number;          // 0.7 – 1.4
  instructionsOverride: string | null;
};

export const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  voiceId: "sage",
  language: "en-US",
  accent: null,
  personality: "calm",
  speed: 1.0,
  instructionsOverride: null,
};

export function clampSpeed(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 1.0;
  return Math.min(1.4, Math.max(0.7, v));
}

export type SpeakMode = "normal" | "sleep" | "encouraging" | "thinking";

const MODE_OVERLAYS: Record<SpeakMode, string> = {
  normal:
    "Warm, conversational, unhurried. Use natural breath pauses between clauses and soften the end of every sentence. Vary pitch gently — never monotone.",
  sleep:
    "Slow, hushed, near-whisper. Long pauses between ideas. Trailing endings that fade. Lower pitch slightly. Never bright. Never crisp. Sound like a friend sitting on the edge of the bed.",
  encouraging:
    "Slight smile in the voice. A touch brighter without speeding up. Warm, supportive cadence.",
  thinking:
    "Reflective and unhurried. Brief pause before key points as if considering them aloud.",
};

export const MODE_SPEED: Record<SpeakMode, number> = {
  normal: 0.92,
  sleep: 0.82,
  encouraging: 0.96,
  thinking: 0.9,
};

export function buildInstructions(
  profile: Pick<VoiceProfile, "personality" | "accent" | "language" | "instructionsOverride">,
  mode: SpeakMode = "normal",
): string {
  if (profile.instructionsOverride && profile.instructionsOverride.trim()) {
    return profile.instructionsOverride.trim();
  }
  const base = PERSONALITY_TEMPLATES[profile.personality] ?? PERSONALITY_TEMPLATES.calm;
  const overlay = MODE_OVERLAYS[mode] ?? MODE_OVERLAYS.normal;
  const lang = LANGUAGE_OPTIONS.find((l) => l.code === profile.language)?.label ?? "English";
  const accent = profile.accent ? ` Use a ${profile.accent} accent.` : "";
  return `${base} ${overlay} Respond in ${lang}.${accent}`;
}
