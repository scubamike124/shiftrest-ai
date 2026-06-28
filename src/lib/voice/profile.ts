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
  calm:         "Speak in a calm, warm, conversational tone — like a trusted recovery coach. Natural pacing, gentle confidence, never robotic.",
  friendly:     "Speak warmly and brightly, like a close friend who's happy to see them. Conversational, natural pauses, never stiff.",
  professional: "Speak with clear, professional confidence. Composed pacing, precise diction, friendly but focused.",
  motivational: "Speak with upbeat, encouraging energy — like a personal coach. Confident, forward-leaning, never pushy.",
  companion:    "Speak gently and personally, with a relaxed companion vibe. Soft pacing, warmth, like talking to someone you care about.",
  coach:        "Speak with direct, supportive coaching energy. Clear, confident, action-oriented, still warm.",
  energetic:    "Speak with high energy and momentum. Brisk but clear, naturally enthusiastic, never rushed.",
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

export function buildInstructions(profile: Pick<VoiceProfile, "personality" | "accent" | "language" | "instructionsOverride">): string {
  if (profile.instructionsOverride && profile.instructionsOverride.trim()) {
    return profile.instructionsOverride.trim();
  }
  const base = PERSONALITY_TEMPLATES[profile.personality] ?? PERSONALITY_TEMPLATES.calm;
  const lang = LANGUAGE_OPTIONS.find((l) => l.code === profile.language)?.label ?? "English";
  const accent = profile.accent ? ` Use a ${profile.accent} accent.` : "";
  return `${base} Respond in ${lang}.${accent}`;
}
