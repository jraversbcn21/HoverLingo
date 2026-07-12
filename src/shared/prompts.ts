import type { TranslationMode } from "./types";
import { TARGET_LANGUAGES } from "./types";

export function buildSystemPrompt(targetLang: string): string {
  const langName = TARGET_LANGUAGES[targetLang] || targetLang;
  return `You are a ${langName} translator. Your sole job is to translate the user's text into ${langName}. Always respond with valid JSON only. Never output text in any language other than ${langName} in the "translation" field.`;
}

export function buildUserPrompt(
  word: string,
  sentence: string,
  targetLang: string,
  mode: TranslationMode
): string {
  const langName = TARGET_LANGUAGES[targetLang] || targetLang;

  if (mode === "learning") {
    return `Translate the following word into ${langName}.

WORD: "${word}"
CONTEXT: "${sentence}"

The translation must be in ${langName}. Return JSON:
{
  "translation": "translation in ${langName}",
  "sourceLanguage": "en",
  "direction": "ltr",
  "confidence": 0.95,
  "pronunciation": "pronunciation guide",
  "partOfSpeech": "noun",
  "explanation": "brief usage note",
  "example": "example sentence in ${langName}"
}

RULES:
- "translation" MUST be in ${langName}. Never return the original word.
- "explanation" MUST be written in ${langName}, not English.
- "direction": "rtl" only if the TRANSLATION text uses Arabic, Hebrew, Persian, or Urdu script. Otherwise "ltr".
- "confidence": 0.0 to 1.0. Lower if the context doesn't help.
- "sourceLanguage": ISO 639-1 code of the WORD's original language.`;
  }

  return `Translate the following word into ${langName}.

WORD: "${word}"
CONTEXT: "${sentence}"

The translation must be in ${langName}. Return JSON:
{
  "translation": "translation in ${langName}",
  "sourceLanguage": "en",
  "direction": "ltr",
  "confidence": 0.95,
  "alternatives": []
}

RULES:
- "translation" MUST be in ${langName}. Never return the original word.
- "direction": "rtl" only if the TRANSLATION text uses Arabic, Hebrew, Persian, or Urdu script. Otherwise "ltr".
- "confidence": 0.0 to 1.0. Lower if the context doesn't help.
- "sourceLanguage": ISO 639-1 code of the WORD's original language.
- Include up to 3 "alternatives" only if the word is truly ambiguous. Otherwise return empty array [].`;
}
