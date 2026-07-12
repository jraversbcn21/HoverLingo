import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildCacheKey } from "../shared/cache-key";

let l1Cache: typeof import("../content/cache-l1").l1Cache;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const mod = await import("../content/cache-l1");
  l1Cache = mod.l1Cache;
});

function makeResponse() {
  return {
    translation: "casa",
    sourceLanguage: "en",
    direction: "ltr" as const,
    confidence: 0.95,
  };
}

const key = (text: string, lang: string, mode: string) =>
  buildCacheKey(text, "ctx", lang, mode, "test-model");

describe("L1 Cache", () => {
  it("returns null for missing key", () => {
    expect(l1Cache.get(key("hello", "es", "quick"))).toBeNull();
  });

  it("stores and retrieves a translation", () => {
    const resp = makeResponse();
    l1Cache.set(key("hello", "es", "quick"), resp);
    expect(l1Cache.get(key("hello", "es", "quick"))).toEqual(resp);
  });

  it("distinguishes by target language", () => {
    l1Cache.set(key("hello", "es", "quick"), makeResponse());
    expect(l1Cache.get(key("hello", "fr", "quick"))).toBeNull();
  });

  it("distinguishes by mode", () => {
    l1Cache.set(key("hello", "es", "quick"), makeResponse());
    expect(l1Cache.get(key("hello", "es", "learning"))).toBeNull();
  });

  it("distinguishes by sentence context", () => {
    l1Cache.set(buildCacheKey("bank", "river ctx", "es", "quick", "m"), makeResponse());
    expect(l1Cache.get(buildCacheKey("bank", "money ctx", "es", "quick", "m"))).toBeNull();
  });

  it("expires entry after TTL", () => {
    l1Cache.set(key("hello", "es", "quick"), makeResponse());

    vi.advanceTimersByTime(31 * 60 * 1000);

    expect(l1Cache.get(key("hello", "es", "quick"))).toBeNull();
  });

  it("evicts LRU entry when cache is full", () => {
    for (let i = 0; i < 1000; i++) {
      l1Cache.set(key(`word${i}`, "es", "quick"), makeResponse());
    }

    l1Cache.set(key("overflow", "es", "quick"), makeResponse());

    expect(l1Cache.get(key("word0", "es", "quick"))).toBeNull();
    expect(l1Cache.get(key("word1", "es", "quick"))).not.toBeNull();
  });

  it("deduplicates in-flight requests", async () => {
    let resolvePromise!: (v: ReturnType<typeof makeResponse>) => void;
    const promise = new Promise<ReturnType<typeof makeResponse>>((resolve) => {
      resolvePromise = resolve;
    });

    l1Cache.setPending(key("hello", "es", "quick"), promise);
    expect(l1Cache.getPending(key("hello", "es", "quick"))).toBe(promise);

    resolvePromise(makeResponse());
    await promise;

    expect(l1Cache.getPending(key("hello", "es", "quick"))).toBeNull();
  });
});
