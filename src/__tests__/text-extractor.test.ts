/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { extractTextAt, extractBlockSentence } from "../content/text-extractor";

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

  describe("single hit-test per hover", () => {
    type CaretDoc = { caretRangeFromPoint?: (x: number, y: number) => Range | null };

    // jsdom no implementa caretRangeFromPoint: x se interpreta como offset
    function stubCaret(node: Text): ReturnType<typeof vi.fn> {
      const fn = vi.fn((x: number) => {
        const r = document.createRange();
        r.setStart(node, x);
        r.collapse(true);
        return r;
      });
      (document as unknown as CaretDoc).caretRangeFromPoint = fn;
      return fn;
    }

    afterEach(() => {
      delete (document as unknown as CaretDoc).caretRangeFromPoint;
      window.getSelection()?.removeAllRanges();
    });

    it("returns the word, its sentence and its range from one caretRangeFromPoint call", () => {
      document.body.innerHTML = "<p>The bank, near the river.</p>";
      const node = document.querySelector("p")!.firstChild as Text;
      const caret = stubCaret(node);

      const result = extractTextAt(6, 0); // dentro de "bank"

      expect(caret).toHaveBeenCalledTimes(1);
      expect(result!.word).toBe("bank");
      expect(result!.sentence).toBe("The bank, near the river");
      expect(result!.wordRange!.toString()).toBe("bank");
    });

    it("keeps the hovered-word range when translating a selection", () => {
      document.body.innerHTML = "<p>hello world</p>";
      const node = document.querySelector("p")!.firstChild as Text;
      stubCaret(node);
      const sel = document.createRange();
      sel.selectNodeContents(node);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(sel);
      mockSelectionRect(0, 0, 100, 20);

      const result = extractTextAt(8, 10); // dentro de "world"

      expect(result!.isSelection).toBe(true);
      expect(result!.word).toBe("hello world");
      expect(result!.wordRange!.toString()).toBe("world");
    });
  });

  describe("extractBlockSentence", () => {
    function textNodes(html: string): Text[] {
      document.body.innerHTML = html;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let n = walker.nextNode();
      while (n) {
        nodes.push(n as Text);
        n = walker.nextNode();
      }
      return nodes;
    }

    it("spans inline elements within the block", () => {
      const [first] = textNodes(
        "<label>Guarda los <b>datos</b> de la tarjeta para compras futuras.</label>"
      );
      // hovered word "Guarda" occupies [0, 6) in the first text node
      expect(extractBlockSentence(first, 0, 6)).toBe(
        "Guarda los datos de la tarjeta para compras futuras"
      );
    });

    it("computes offsets from the hovered node, not by string search", () => {
      const nodes = textNodes("<p>Primera uno. Segunda <i>uno</i> fin.</p>");
      // nodes[1] is the "uno" inside <i>; word occupies [0, 3)
      expect(extractBlockSentence(nodes[1], 0, 3)).toBe("Segunda uno fin");
    });

    it("stops at sentence enders inside the block", () => {
      const [node] = textNodes("<p>Una frase. Otra cosa dicha. Y más.</p>");
      // "Otra" occupies [11, 15) in the single text node
      expect(extractBlockSentence(node, 11, 15)).toBe("Otra cosa dicha");
    });

    it("collapses whitespace runs in the result", () => {
      const [node] = textNodes("<label>Guarda\t los  datos.</label>");
      expect(extractBlockSentence(node, 0, 6)).toBe("Guarda los datos");
    });

    it("falls back to single-node extraction when the block text is huge", () => {
      const [node] = textNodes(`<div>Frase corta aquí. ${"x".repeat(6000)}</div>`);
      // "Frase" occupies [0, 5); fallback path must still work on the node itself
      expect(extractBlockSentence(node, 0, 5)).toBe("Frase corta aquí");
    });

    it("does not bleed text from a nested block into the sentence", () => {
      const [node] = textNodes(
        "<li>Inicio quiere decir algo<ul><li>Productos</li></ul></li>"
      );
      // "Inicio" occupies [0, 6) in the outer <li>'s text node
      const result = extractBlockSentence(node, 0, 6);
      expect(result).toBe("Inicio quiere decir algo");
      expect(result).not.toContain("Productos");
    });

    it("excludes text inside <style> from the sentence", () => {
      const [node] = textNodes(
        "<p>Hola<style>.a{color:red}</style> mundo</p>"
      );
      // "Hola" occupies [0, 4) in the first text node
      const result = extractBlockSentence(node, 0, 4);
      expect(result).not.toContain("color");
      expect(result).not.toContain(".a");
      expect(result).toContain("Hola");
    });
  });
});
