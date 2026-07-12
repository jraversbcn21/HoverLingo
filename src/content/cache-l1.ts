import type { TranslationResponse } from "../shared/types";

export type { TranslationResponse } from "../shared/types";

interface CachedEntry {
  response: TranslationResponse;
  timestamp: number;
}

const MAX_ENTRIES = 1000;
const TTL = 30 * 60 * 1000;

const cache = new Map<string, CachedEntry>();
const pendingRequests = new Map<string, Promise<TranslationResponse>>();

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
  get(key: string): TranslationResponse | null {
    const entry = cache.get(key);

    if (!entry) return null;
    if (isExpired(entry)) {
      cache.delete(key);
      return null;
    }

    entry.timestamp = Date.now();
    return entry.response;
  },

  set(key: string, response: TranslationResponse): void {
    if (cache.has(key)) {
      cache.get(key)!.timestamp = Date.now();
      return;
    }

    evictLRU();
    cache.set(key, { response, timestamp: Date.now() });
  },

  getPending(key: string): Promise<TranslationResponse> | null {
    return pendingRequests.get(key) || null;
  },

  setPending(key: string, promise: Promise<TranslationResponse>): void {
    pendingRequests.set(key, promise);
    promise.finally(() => {
      pendingRequests.delete(key);
    });
  },
};
