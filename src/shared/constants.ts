export const DEFAULTS = {
  TARGET_LANG: "es",
  MODE: "quick" as const,
  L2_CACHE_MAX: 5000,
  L2_CACHE_TTL: 24 * 60 * 60 * 1000,
};

export const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// Groq decomisionó todos los modelos Llama (2026-07/08). De los que quedan,
// Qwen 3.6 27B es el único que acepta reasoning_effort: "none" — sin bloque
// <think>, cada hover cuesta ~250 tokens y cabe de sobra en el TPM del plan
// gratuito. GPT-OSS solo baja a "low", así que gasta algo más por hover.
export const GROQ_MODEL = "qwen/qwen3.6-27b";

export const AVAILABLE_MODELS: Record<string, string> = {
  "qwen/qwen3.6-27b": "Qwen 3.6 27B",
  "openai/gpt-oss-120b": "GPT OSS 120B",
  "openai/gpt-oss-20b": "GPT OSS 20B",
};
