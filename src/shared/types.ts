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
  ca: "Catalan",
};
