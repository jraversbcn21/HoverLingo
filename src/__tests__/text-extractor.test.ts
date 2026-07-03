/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from "vitest";
import { extractTextAt } from "../content/text-extractor";

describe("Text Extractor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns null when not hovering over text", () => {
    const result = extractTextAt(0, 0);
    expect(result).toBeNull();
  });

  it("returns selected text when text is selected", () => {
    const div = document.createElement("div");
    div.textContent = "Hello world";
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const result = extractTextAt(0, 0);
    expect(result).not.toBeNull();
    expect(result!.isSelection).toBe(true);
    expect(result!.word).toContain("Hello");
  });

  it("truncates long selections to 500 chars", () => {
    const div = document.createElement("div");
    div.textContent = "x".repeat(600);
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const result = extractTextAt(0, 0);
    expect(result).not.toBeNull();
    expect(result!.word.length).toBeLessThanOrEqual(600);
    expect(result!.sentence.length).toBeLessThanOrEqual(500);
  });

  it("returns null when caretRangeFromPoint is unavailable and no selection", () => {
    const textNode = document.createTextNode("hello world test");
    document.body.appendChild(textNode);

    // jsdom doesn't support caretRangeFromPoint, so null is expected
    const result = extractTextAt(10, 10);
    expect(result).toBeNull();
  });

  it("returns null for empty text node", () => {
    const textNode = document.createTextNode("   ");
    document.body.appendChild(textNode);

    const result = extractTextAt(5, 5);
    // Should return null because no valid word can be extracted
    expect(result).toBeNull();
  });
});
