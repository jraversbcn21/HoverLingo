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

  function fillStore(count: number): void {
    // Cache llena de una sesión anterior del SW (antes de cargar el índice)
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      mockStore.set(`hl_cache_word${i}|es|quick`, {
        response: makeResponse(),
        timestamp: now - (count - i) * 1000,
      });
    }
  }

  function cacheSize(): number {
    return [...mockStore.keys()].filter((k) => k.startsWith("hl_cache_")).length;
  }

  it("evicts the oldest batch when cache is full", async () => {
    fillStore(5000);

    await l2Cache.set("overflow|es|quick", makeResponse());

    // Lote del 10% más antiguo (word0..word499) expulsado, el resto intacto
    expect(mockStore.has("hl_cache_word0|es|quick")).toBe(false);
    expect(mockStore.has("hl_cache_word499|es|quick")).toBe(false);
    expect(mockStore.has("hl_cache_word500|es|quick")).toBe(true);
    expect(mockStore.has("hl_cache_overflow|es|quick")).toBe(true);
    expect(cacheSize()).toBe(5000 - 500 + 1);
  });

  it("overwriting an existing key in a full cache does not evict", async () => {
    fillStore(5000);

    await l2Cache.set("word10|es|quick", makeResponse());

    expect(cacheSize()).toBe(5000);
    expect(mockStore.has("hl_cache_word0|es|quick")).toBe(true);
  });

  it("does not read the whole storage on every write", async () => {
    const get = chrome.storage.local.get as ReturnType<typeof vi.fn>;
    get.mockClear();

    for (let i = 0; i < 5; i++) {
      await l2Cache.set(`w${i}|es|quick`, makeResponse());
    }

    // Una sola lectura completa (carga del índice), no una por escritura
    expect(get.mock.calls.filter(([k]) => k === null)).toHaveLength(1);
  });

  it("prefixed keys avoid collisions with other storage", async () => {
    const resp = makeResponse();
    await l2Cache.set("test|es|quick", resp);

    // A non-prefixed key should not interfere
    expect(mockStore.has("other_data")).toBe(false);
    expect(mockStore.has("hl_cache_test|es|quick")).toBe(true);
  });
});
