export interface TranslationRequest {
  text: string;
  sentence: string;
  targetLang: string;
  mode: TranslationMode;
}

export interface TranslationResponse {
  translation: string;
  sourceLanguage: string;
  direction: "ltr" | "rtl";
  confidence: number;
  alternatives?: string[];
  pronunciation?: string;
  partOfSpeech?: string;
  explanation?: string;
  example?: string;
}

export interface CachedEntry {
  response: TranslationResponse;
  timestamp: number;
}

export interface StorageData {
  groqApiKey?: string;
  groqModel?: string;
  targetLang?: string;
  translationMode?: TranslationMode;
  enabledSites?: string[];
  hoverDelay?: number;
  enabled?: boolean;
}

export type TranslationMode = "quick" | "learning";

export const TARGET_LANGUAGES: Record<string, string> = {
  es: "Spanish",
  en: "English",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese (Simplified)",
  ar: "Arabic",
  he: "Hebrew",
  fa: "Persian",
  hi: "Hindi",
  tr: "Turkish",
  nl: "Dutch",
  pl: "Polish",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  fi: "Finnish",
  el: "Greek",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  uk: "Ukrainian",
  cs: "Czech",
  ro: "Romanian",
  hu: "Hungarian",
};
