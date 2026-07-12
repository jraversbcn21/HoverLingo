/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractTextAt } from "../content/text-extractor";

describe("Text Extractor", () => {
  const originalGetClientRects = Range.prototype.getClientRects;

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    Range.prototype.getClientRects = originalGetClientRects;
  });

  function mockSelectionRect(left: number, top: number, right: number, bottom: number): void {
    Range.prototype.getClientRects = function () {
      const rect = {
        left, top, right, bottom,
        width: right - left,
        height: bottom - top,
        x: left, y: top,
        toJSON: () => ({}),
      } as DOMRect;
      return [rect] as unknown as DOMRectList;
    };
  }

  it("returns null when not hovering over text", () => {
    const result = extractTextAt(0, 0);
    expect(result).toBeNull();
  });

  it("returns selected text when hovering inside the selection", () => {
    const div = document.createElement("div");
    div.textContent = "Hello world";
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    mockSelectionRect(0, 0, 100, 20);

    const result = extractTextAt(10, 10);
    expect(result).not.toBeNull();
    expect(result!.isSelection).toBe(true);
    expect(result!.word).toContain("Hello");
  });

  it("ignores the selection when hovering outside it", () => {
    const div = document.createElement("div");
    div.textContent = "Hello world";
    document.body.appendChild(div);

    const range = document.createRange();
    range.selectNodeContents(div);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    mockSelectionRect(0, 0, 100, 20);

    const result = extractTextAt(300, 300);
    expect(result).toBeNull();
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
    mockSelectionRect(0, 0, 100, 20);

    const result = extractTextAt(10, 10);
    expect(result).not.toBeNull();
    expect(result!.word.length).toBeLessThanOrEqual(500);
    expect(result!.sentence.length).toBeLessThanOrEqual(500);
  });

  it("returns null when caretRangeFromPoint is unavailable and no selection", () => {
    const textNode = document.createTextNode("hello world test");
    document.body.appendChild(textNode);

    const result = extractTextAt(10, 10);
    expect(result).toBeNull();
  });

  it("returns null for empty text node", () => {
    const textNode = document.createTextNode("   ");
    document.body.appendChild(textNode);

    const result = extractTextAt(5, 5);
    expect(result).toBeNull();
  });
});
