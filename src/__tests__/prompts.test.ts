import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../shared/prompts";

describe("Prompts", () => {
  describe("buildSystemPrompt", () => {
    it("includes target language name for known code", () => {
      const prompt = buildSystemPrompt("es");
      expect(prompt).toContain("Spanish translator");
      expect(prompt).toContain("translate the user's text into Spanish");
    });

    it("falls back to language code if unknown", () => {
      const prompt = buildSystemPrompt("zz");
      expect(prompt).toContain("zz translator");
      expect(prompt).toContain("translate the user's text into zz");
    });

    it('requires JSON-only output and target language enforcement', () => {
      const prompt = buildSystemPrompt("fr");
      expect(prompt).toContain("valid JSON only");
      expect(prompt).toContain("Never output text in any language other than French");
    });
  });

  describe("buildUserPrompt (quick mode)", () => {
    it("includes word and sentence context", () => {
      const prompt = buildUserPrompt("bank", "The bank is near the river.", "es", "quick");
      expect(prompt).toContain('WORD: "bank"');
      expect(prompt).toContain('CONTEXT: "The bank is near the river."');
    });

    it("contains target language name", () => {
      const prompt = buildUserPrompt("hello", "Hello world.", "de", "quick");
      expect(prompt).toContain("German");
      expect(prompt).toContain('translation" MUST be in German');
    });

    it("contains JSON format instructions with alternatives", () => {
      const prompt = buildUserPrompt("test", "This is a test.", "ja", "quick");
      expect(prompt).toContain('"alternatives":');
      expect(prompt).toContain('"direction": "ltr"');
      expect(prompt).toContain('"confidence": 0.95');
    });

    it("does not include learning fields", () => {
      const prompt = buildUserPrompt("test", "context.", "fr", "quick");
      expect(prompt).not.toContain('"pronunciation"');
      expect(prompt).not.toContain('"partOfSpeech"');
      expect(prompt).not.toContain('"explanation"');
    });
  });

  describe("buildUserPrompt (learning mode)", () => {
    it("includes pronunciation, partOfSpeech, explanation, example", () => {
      const prompt = buildUserPrompt("bank", "The bank is near.", "es", "learning");
      expect(prompt).toContain('"pronunciation"');
      expect(prompt).toContain('"partOfSpeech"');
      expect(prompt).toContain('"explanation"');
      expect(prompt).toContain('"example"');
    });

    it("does NOT include alternatives field", () => {
      const prompt = buildUserPrompt("bank", "context.", "it", "learning");
      expect(prompt).not.toContain('"alternatives"');
    });

    it("falls back to language code for unknown target", () => {
      const prompt = buildUserPrompt("hello", "Hello.", "xx", "learning");
      expect(prompt).toContain("Translate the following word into xx");
    });

    it("requires explanation to be written in the target language", () => {
      const prompt = buildUserPrompt("bank", "The bank is near.", "es", "learning");
      expect(prompt).toContain('"explanation" MUST be written in Spanish');
    });
  });
});
