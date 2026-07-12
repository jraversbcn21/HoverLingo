import type { TranslationResponse } from "../shared/types";
import { GROQ_API_URL, GROQ_MODEL, DEFAULTS } from "../shared/constants";
import { buildSystemPrompt, buildUserPrompt } from "../shared/prompts";
import { l2Cache } from "./cache-l2";
import { extractJson } from "../shared/extract-json";
import { buildCacheKey } from "../shared/cache-key";

const LANGUAGE_SCRIPT: Record<string, string> = {
  es: "latin", en: "latin", fr: "latin", de: "latin", it: "latin", pt: "latin",
  nl: "latin", pl: "latin", sv: "latin", da: "latin", no: "latin", fi: "latin",
  cs: "latin", ro: "latin", hu: "latin", tr: "latin", vi: "latin", id: "latin",
  ru: "cyrillic", uk: "cyrillic",
  ar: "arabic", fa: "arabic",
  he: "hebrew",
  ja: "cjk", ko: "cjk", zh: "cjk",
  hi: "devanagari",
  th: "thai",
  el: "greek",
};

interface TranslationRequest {
  text: string;
  sentence: string;
  targetLang: string;
  mode: "quick" | "learning";
}

class GroqApiError extends Error {
  status: number;
  headers: Headers;

  constructor(status: number, headers: Headers, message: string) {
    super(message);
    this.name = "GroqApiError";
    this.status = status;
    this.headers = headers;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(headers: Headers): number | null {
  const retryAfter = headers.get("Retry-After");
  if (!retryAfter) return null;

  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  const date = Date.parse(retryAfter);
  if (!isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return null;
}

function classifyScript(code: number): string {
  if ((code >= 0x0041 && code <= 0x007A) || (code >= 0x00C0 && code <= 0x024F) || (code >= 0x1E00 && code <= 0x1EFF)) {
    return "latin";
  }
  if ((code >= 0x0400 && code <= 0x04FF) || (code >= 0x0500 && code <= 0x052F)) {
    return "cyrillic";
  }
  if ((code >= 0x0600 && code <= 0x06FF) || (code >= 0x0750 && code <= 0x077F) || (code >= 0xFB50 && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF)) {
    return "arabic";
  }
  if ((code >= 0x0590 && code <= 0x05FF) || (code >= 0xFB1D && code <= 0xFB4F)) {
    return "hebrew";
  }
  if (code >= 0x0900 && code <= 0x097F) {
    return "devanagari";
  }
  if (code >= 0x0E00 && code <= 0x0E7F) {
    return "thai";
  }
  if ((code >= 0x0370 && code <= 0x03FF) || (code >= 0x1F00 && code <= 0x1FFF)) {
    return "greek";
  }
  if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) || (code >= 0x3040 && code <= 0x30FF) || (code >= 0xAC00 && code <= 0xD7AF)) {
    return "cjk";
  }
  return "other";
}

function validateTranslationScript(translation: string, targetLang: string): boolean {
  const expectedScript = LANGUAGE_SCRIPT[targetLang];
  if (!expectedScript) return true;

  let total = 0;
  let matched = 0;

  for (let i = 0; i < translation.length; i++) {
    const code = translation.charCodeAt(i);

    if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A) ||
        (code >= 0x00C0 && code <= 0x024F) || (code >= 0x1E00 && code <= 0x1EFF) ||
        (code >= 0x0370 && code <= 0x03FF) || (code >= 0x1F00 && code <= 0x1FFF) ||
        (code >= 0x0400 && code <= 0x052F) ||
        (code >= 0x0590 && code <= 0x06FF) || (code >= 0x0750 && code <= 0x077F) ||
        (code >= 0x0900 && code <= 0x097F) ||
        (code >= 0x0E00 && code <= 0x0E7F) ||
        (code >= 0x3040 && code <= 0x30FF) || (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) || (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFB1D && code <= 0xFDFF) || (code >= 0xFE70 && code <= 0xFEFF)) {
      total++;
      const script = classifyScript(code);
      if (script === expectedScript) {
        matched++;
      }
    }
  }

  if (total === 0) return true;

  if (expectedScript === "latin") {
    return matched / total >= 0.7;
  }

  return matched > 0;
}

async function getApiKey(): Promise<string | null> {
  const data = await chrome.storage.local.get("groqApiKey");
  return data.groqApiKey || null;
}

async function getTargetLang(): Promise<string> {
  const data = await chrome.storage.local.get("targetLang");
  return data.targetLang || DEFAULTS.TARGET_LANG;
}

async function getMode(): Promise<"quick" | "learning"> {
  const data = await chrome.storage.local.get("translationMode");
  return data.translationMode || DEFAULTS.MODE;
}

async function getModel(): Promise<string> {
  const data = await chrome.storage.local.get("groqModel");
  return data.groqModel || GROQ_MODEL;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Translation timed out after 30s");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function callGroq(
  word: string,
  sentence: string,
  targetLang: string,
  mode: "quick" | "learning",
  apiKey: string,
  model: string
): Promise<TranslationResponse> {
  const systemPrompt = buildSystemPrompt(targetLang);
  const userPrompt = buildUserPrompt(word, sentence, targetLang, mode);

  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.0,
    max_tokens: mode === "learning" ? 2048 : 1024,
    stream: false,
  };
  if (model.startsWith("qwen/")) {
    requestBody.reasoning_format = "hidden";
  }

  const res = await fetchWithTimeout(
    GROQ_API_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    },
    30000
  );

  if (!res.ok) {
    const body = await res.text();
    throw new GroqApiError(
      res.status,
      res.headers,
      `Groq API error: ${res.status} — ${body.slice(0, 200)}`
    );
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Empty response from Groq API");
  }

  const parsed = extractJson<TranslationResponse>(content);

  if (!parsed) {
    throw new Error(`Failed to parse JSON from response: ${content.slice(0, 200)}`);
  }

  if (!parsed.translation || !parsed.sourceLanguage || !parsed.direction) {
    throw new Error("Invalid response format from Groq");
  }

  return parsed;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRANSLATE") {
    handleTranslate(message.payload, sendResponse);
    return true;
  }
  if (message.type === "GET_TAB_HOST") {
    let host = "";
    try {
      if (sender.tab?.url) {
        host = new URL(sender.tab.url).hostname;
      }
    } catch {
      // URL no parseable: devolvemos ""
    }
    sendResponse({ host });
    return false;
  }
  return false;
});

async function callGroqWithRetry(
  word: string,
  sentence: string,
  targetLang: string,
  mode: "quick" | "learning",
  apiKey: string,
  model: string
): Promise<TranslationResponse> {
  const MAX_RETRIES_5XX = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES_5XX; attempt++) {
    try {
      return await callGroq(word, sentence, targetLang, mode, apiKey, model);
    } catch (err) {
      if (!(err instanceof GroqApiError)) throw err;

      if (err.status === 429) {
        if (attempt === 0) {
          const waitMs = Math.min(parseRetryAfter(err.headers) ?? 5000, 10000);
          await sleep(waitMs);
          continue;
        }
        throw err;
      }

      if (err.status >= 500 && attempt < MAX_RETRIES_5XX) {
        const delay = 1000 * Math.pow(2, attempt);
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }

  throw new Error("Max retries exhausted");
}

async function handleTranslate(
  request: TranslationRequest,
  sendResponse: (response: { success: boolean; data?: TranslationResponse; error?: string; cached?: boolean }) => void
) {
  try {
    const targetLang = request.targetLang || (await getTargetLang());
    const mode = request.mode || (await getMode());
    const model = await getModel();
    const cacheKey = buildCacheKey(request.text, request.sentence || "", targetLang, mode, model);

    const cached = await l2Cache.get(cacheKey);
    if (cached) {
      sendResponse({ success: true, data: cached, cached: true });
      return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      sendResponse({ success: false, error: "API key not configured" });
      return;
    }

    const result = await callGroqWithRetry(
      request.text,
      request.sentence,
      targetLang,
      mode,
      apiKey,
      model
    );

    if (result.confidence > 0 && !validateTranslationScript(result.translation, targetLang)) {
      result.confidence = 0;
    }

    await l2Cache.set(cacheKey, result);
    sendResponse({ success: true, data: result, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    sendResponse({ success: false, error: message });
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-hoverlingo") {
    const data = await chrome.storage.local.get("enabled");
    const currentEnabled = data.enabled !== false;
    await chrome.storage.local.set({ enabled: !currentEnabled });
  }
});
