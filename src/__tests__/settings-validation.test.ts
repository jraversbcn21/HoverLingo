import { describe, it, expect } from "vitest";
import { sanitizeImportedSettings } from "../shared/settings-validation";

describe("sanitizeImportedSettings", () => {
  it("accepts a fully valid settings object", () => {
    const out = sanitizeImportedSettings({
      groqModel: "llama-3.1-8b-instant",
      targetLang: "fr",
      translationMode: "learning",
      hoverDelay: 500,
      enabled: false,
      disabledSites: ["example.com", "foo.org"],
    });
    expect(out).toEqual({
      groqModel: "llama-3.1-8b-instant",
      targetLang: "fr",
      translationMode: "learning",
      hoverDelay: 500,
      enabled: false,
      disabledSites: ["example.com", "foo.org"],
    });
  });

  it("rejects non-object input", () => {
    expect(sanitizeImportedSettings(null)).toEqual({});
    expect(sanitizeImportedSettings("x")).toEqual({});
    expect(sanitizeImportedSettings([1, 2])).toEqual({});
  });

  it("drops disabledSites that is not a string array", () => {
    expect(sanitizeImportedSettings({ disabledSites: {} })).toEqual({});
    expect(sanitizeImportedSettings({ disabledSites: "example.com" })).toEqual({});
    expect(sanitizeImportedSettings({ disabledSites: ["a.com", 42, null] })).toEqual({
      disabledSites: ["a.com"],
    });
  });

  it("clamps hoverDelay to [100, 1000] and drops non-numbers", () => {
    expect(sanitizeImportedSettings({ hoverDelay: 5 })).toEqual({ hoverDelay: 100 });
    expect(sanitizeImportedSettings({ hoverDelay: 99999 })).toEqual({ hoverDelay: 1000 });
    expect(sanitizeImportedSettings({ hoverDelay: {} })).toEqual({});
    expect(sanitizeImportedSettings({ hoverDelay: "300" })).toEqual({});
  });

  it("drops unknown models and languages", () => {
    expect(sanitizeImportedSettings({ groqModel: "evil/model" })).toEqual({});
    expect(sanitizeImportedSettings({ targetLang: "xx" })).toEqual({});
  });

  it("drops invalid translationMode and non-boolean enabled", () => {
    expect(sanitizeImportedSettings({ translationMode: "fast" })).toEqual({});
    expect(sanitizeImportedSettings({ enabled: "true" })).toEqual({});
  });

  it("ignores keys outside the allowlist", () => {
    expect(sanitizeImportedSettings({ groqApiKey: "sk-123", evil: 1 })).toEqual({});
  });
});
