import { describe, it, expect } from "vitest";
import { buildCacheKey, hashContext } from "../shared/cache-key";

describe("cache key", () => {
  it("is deterministic for identical inputs", () => {
    expect(buildCacheKey("bank", "The bank of the river.", "es", "quick", "m1")).toBe(
      buildCacheKey("bank", "The bank of the river.", "es", "quick", "m1")
    );
  });

  it("differs when the sentence context differs", () => {
    const a = buildCacheKey("bank", "The bank of the river.", "es", "quick", "m1");
    const b = buildCacheKey("bank", "The bank raised rates.", "es", "quick", "m1");
    expect(a).not.toBe(b);
  });

  it("differs when the model differs", () => {
    const a = buildCacheKey("bank", "ctx", "es", "quick", "m1");
    const b = buildCacheKey("bank", "ctx", "es", "quick", "m2");
    expect(a).not.toBe(b);
  });

  it("differs by target language and mode", () => {
    const base = buildCacheKey("bank", "ctx", "es", "quick", "m1");
    expect(buildCacheKey("bank", "ctx", "fr", "quick", "m1")).not.toBe(base);
    expect(buildCacheKey("bank", "ctx", "es", "learning", "m1")).not.toBe(base);
  });

  it("hashContext handles the empty string", () => {
    expect(typeof hashContext("")).toBe("string");
    expect(hashContext("").length).toBeGreaterThan(0);
  });
});
