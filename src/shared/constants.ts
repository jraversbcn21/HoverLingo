export const DEFAULTS = {
  TARGET_LANG: "es",
  MODE: "quick" as const,
  HOVER_DELAY: 300,
  ENABLED: true,
  L1_CACHE_MAX: 1000,
  L1_CACHE_TTL: 30 * 60 * 1000,
  L2_CACHE_MAX: 5000,
  L2_CACHE_TTL: 24 * 60 * 60 * 1000,
};

export const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export const GROQ_MODEL = "qwen/qwen3.6-27b";

export const AVAILABLE_MODELS: Record<string, string> = {
  "qwen/qwen3.6-27b": "Qwen 3.6 27B",
  "qwen/qwen3-32b": "Qwen 3 32B",
  "openai/gpt-oss-120b": "GPT OSS 120B",
  "openai/gpt-oss-20b": "GPT OSS 20B",
  "llama-3.3-70b-versatile": "Llama 3.3 70B",
  "meta-llama/llama-4-scout-17b-16e-instruct": "Llama 4 Scout 17B",
  "llama-3.1-8b-instant": "Llama 3.1 8B",
};
