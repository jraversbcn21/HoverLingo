import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TranslationResponse } from "../shared/types";

const mockStore = new Map<string, unknown>();

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: vi.fn((keys: string | string[] | null) => {
        const result: Record<string, unknown> = {};
        if (keys === null) {
          for (const [k, v] of mockStore) {
            result[k] = v;
          }
        } else if (Array.isArray(keys)) {
          for (const k of keys) {
            if (mockStore.has(k)) result[k] = mockStore.get(k);
          }
        } else if (typeof keys === "string") {
          if (mockStore.has(keys)) result[keys] = mockStore.get(keys);
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          mockStore.set(k, v);
        }
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) {
          const prefixed = mockStore.has(k);
          if (prefixed) mockStore.delete(k);
        }
        return Promise.resolve();
      }),
    },
  },
});

let l2Cache: typeof import("../background/cache-l2").l2Cache;

beforeEach(async () => {
  vi.resetModules();
  mockStore.clear();
  const mod = await import("../background/cache-l2");
  l2Cache = mod.l2Cache;
});

function makeResponse(): TranslationResponse {
  return {
    translation: "casa",
    sourceLanguage: "en",
    direction: "ltr",
    confidence: 0.95,
  };
}

describe("L2 Cache", () => {
  it("returns null for missing key", async () => {
    const result = await l2Cache.get("hello|es|quick");
    expect(result).toBeNull();
  });

  it("stores and retrieves a translation", async () => {
    const resp = makeResponse();
    await l2Cache.set("hello|es|quick", resp);
    const result = await l2Cache.get("hello|es|quick");
    expect(result).toEqual(resp);
  });

  it("evicts oldest entry when cache exceeds max", async () => {
    // Pre-populate with entries that would trigger eviction
    // L2 max is 5000, so fill with 5000 entries first
    // Use a smaller batch to avoid timeout
    const batch = 100;
    for (let i = 0; i < batch; i++) {
      await l2Cache.set(`fill${i}|es|quick`, makeResponse());
    }

    // Manually add enough entries to the mockStore to simulate a full cache
    const now = Date.now();
    for (let i = 0; i < 5000; i++) {
      mockStore.set(`hl_cache_word${i}|es|quick`, {
        response: makeResponse(),
        timestamp: now - (5000 - i) * 1000,
      });
    }

    // Next set should evict the oldest
    await l2Cache.set("overflow|es|quick", makeResponse());

    // "word0" should be evicted (oldest)
    const result = await l2Cache.get("word0|es|quick");
    expect(result).toBeNull();
  }, 10000);

  it("prefixed keys avoid collisions with other storage", async () => {
    const resp = makeResponse();
    await l2Cache.set("test|es|quick", resp);

    // A non-prefixed key should not interfere
    expect(mockStore.has("other_data")).toBe(false);
    expect(mockStore.has("hl_cache_test|es|quick")).toBe(true);
  });
});
