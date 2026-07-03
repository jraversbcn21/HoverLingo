import { describe, it, expect, beforeEach, vi } from "vitest";

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

describe("L1 Cache", () => {
  it("returns null for missing key", () => {
    expect(l1Cache.get("hello", "es", "quick")).toBeNull();
  });

  it("stores and retrieves a translation", () => {
    const resp = makeResponse();
    l1Cache.set("hello", "es", "quick", resp);
    expect(l1Cache.get("hello", "es", "quick")).toEqual(resp);
  });

  it("distinguishes by target language", () => {
    const resp = makeResponse();
    l1Cache.set("hello", "es", "quick", resp);
    expect(l1Cache.get("hello", "fr", "quick")).toBeNull();
  });

  it("distinguishes by mode", () => {
    const resp = makeResponse();
    l1Cache.set("hello", "es", "quick", resp);
    expect(l1Cache.get("hello", "es", "learning")).toBeNull();
  });

  it("expires entry after TTL", () => {
    const resp = makeResponse();
    l1Cache.set("hello", "es", "quick", resp);

    vi.advanceTimersByTime(31 * 60 * 1000);

    expect(l1Cache.get("hello", "es", "quick")).toBeNull();
  });

  it("evicts LRU entry when cache is full", () => {
    for (let i = 0; i < 1000; i++) {
      l1Cache.set(`word${i}`, "es", "quick", makeResponse());
    }

    // "word0" was the oldest, should be evicted when inserting #1001
    l1Cache.set("overflow", "es", "quick", makeResponse());

    expect(l1Cache.get("word0", "es", "quick")).toBeNull();
    expect(l1Cache.get("word1", "es", "quick")).not.toBeNull();
  });

  it("deduplicates in-flight requests", async () => {
    let resolvePromise!: (v: ReturnType<typeof makeResponse>) => void;
    const promise = new Promise<ReturnType<typeof makeResponse>>((resolve) => {
      resolvePromise = resolve;
    });

    l1Cache.setPending("hello", "es", "quick", promise);
    expect(l1Cache.getPending("hello", "es", "quick")).toBe(promise);

    const resp = makeResponse();
    resolvePromise(resp);
    await promise;

    expect(l1Cache.getPending("hello", "es", "quick")).toBeNull();
  });
});
