interface CachedEntry {
  response: TranslationResponse;
  timestamp: number;
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

const MAX_ENTRIES = 1000;
const TTL = 30 * 60 * 1000;

const cache = new Map<string, CachedEntry>();
const pendingRequests = new Map<string, Promise<TranslationResponse>>();

function buildKey(text: string, targetLang: string, mode: string): string {
  return `${text}|${targetLang}|${mode}`;
}

function isExpired(entry: CachedEntry): boolean {
  return Date.now() - entry.timestamp > TTL;
}

function evictLRU(): void {
  if (cache.size < MAX_ENTRIES) return;

  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of cache) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    cache.delete(oldestKey);
  }
}

export const l1Cache = {
  get(text: string, targetLang: string, mode: string): TranslationResponse | null {
    const key = buildKey(text, targetLang, mode);
    const entry = cache.get(key);

    if (!entry) return null;
    if (isExpired(entry)) {
      cache.delete(key);
      return null;
    }

    entry.timestamp = Date.now();
    return entry.response;
  },

  set(text: string, targetLang: string, mode: string, response: TranslationResponse): void {
    const key = buildKey(text, targetLang, mode);
    if (cache.has(key)) {
      cache.get(key)!.timestamp = Date.now();
      return;
    }

    evictLRU();
    cache.set(key, { response, timestamp: Date.now() });
  },

  getPending(text: string, targetLang: string, mode: string): Promise<TranslationResponse> | null {
    const key = buildKey(text, targetLang, mode);
    return pendingRequests.get(key) || null;
  },

  setPending(text: string, targetLang: string, mode: string, promise: Promise<TranslationResponse>): void {
    const key = buildKey(text, targetLang, mode);
    pendingRequests.set(key, promise);
    promise.finally(() => {
      pendingRequests.delete(key);
    });
  },
};
