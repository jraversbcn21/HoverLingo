import { describe, it, expect } from "vitest";
import { extractJson } from "../shared/extract-json";

interface Payload {
  translation: string;
}

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson<Payload>('{"translation":"casa"}')).toEqual({ translation: "casa" });
  });

  it("parses JSON with text preamble", () => {
    expect(extractJson<Payload>('Here is the JSON:\n{"translation":"casa"}')).toEqual({
      translation: "casa",
    });
  });

  it("strips <think> blocks even when they contain braces", () => {
    const content =
      '<think>Draft: {"translation":"wrong"} no, better...</think>\n{"translation":"casa"}';
    expect(extractJson<Payload>(content)).toEqual({ translation: "casa" });
  });

  it("strips markdown code fences", () => {
    expect(extractJson<Payload>('```json\n{"translation":"casa"}\n```')).toEqual({
      translation: "casa",
    });
  });

  it("handles trailing text after the JSON object", () => {
    expect(extractJson<Payload>('{"translation":"casa"}\nHope this helps!')).toEqual({
      translation: "casa",
    });
  });

  it("handles nested braces inside string values", () => {
    expect(extractJson<Payload>('{"translation":"casa {x}"}')).toEqual({
      translation: "casa {x}",
    });
  });

  it("returns null for content without JSON", () => {
    expect(extractJson<Payload>("no json here")).toBeNull();
    expect(extractJson<Payload>("")).toBeNull();
  });

  it("returns null for truncated JSON", () => {
    expect(extractJson<Payload>('{"translation":"cas')).toBeNull();
  });
});
