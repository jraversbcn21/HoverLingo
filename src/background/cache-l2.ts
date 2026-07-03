import type { TranslationResponse } from "../shared/types";
import { DEFAULTS } from "../shared/constants";

const STORAGE_PREFIX = "hl_cache_";

export const l2Cache = {
  async get(key: string): Promise<TranslationResponse | null> {
    const storageKey = STORAGE_PREFIX + key;
    const data = await chrome.storage.local.get(storageKey);
    const entry = data[storageKey];

    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > DEFAULTS.L2_CACHE_TTL) {
      await chrome.storage.local.remove(storageKey);
      return null;
    }

    return entry.response as TranslationResponse;
  },

  async set(key: string, response: TranslationResponse): Promise<void> {
    const storageKey = STORAGE_PREFIX + key;
    const entry = {
      response,
      timestamp: Date.now(),
    };

    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter((k) => k.startsWith(STORAGE_PREFIX));

    if (cacheKeys.length >= DEFAULTS.L2_CACHE_MAX) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const k of cacheKeys) {
        const val = all[k];
        if (val && val.timestamp < oldestTime) {
          oldestTime = val.timestamp;
          oldestKey = k;
        }
      }

      if (oldestKey) {
        await chrome.storage.local.remove(oldestKey);
      }
    }

    await chrome.storage.local.set({ [storageKey]: entry });
  },
};
