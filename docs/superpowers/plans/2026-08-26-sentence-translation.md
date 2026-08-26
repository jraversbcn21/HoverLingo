# Sentence Translation in Tooltip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "→ frase completa" button to the hover tooltip that translates the full sentence containing the hovered word, with sentence extraction upgraded to span inline elements.

**Architecture:** Content-script-only change. Sentence extraction moves from single-text-node to closest-block-ancestor scope in `text-extractor.ts`. The tooltip becomes interactive (`pointer-events: auto`); the hover detector learns to ignore mouse events inside the tooltip. The sentence request reuses the existing `TRANSLATE` message with `text = sentence` (same as the manual-selection path today), so the service worker, prompts, L1/L2 caches and cross-tab request collapsing need zero changes.

**Tech Stack:** TypeScript, Chrome extension MV3 content script, vitest + jsdom, @floating-ui/dom (already installed).

**Spec:** `docs/superpowers/specs/2026-08-26-sentence-translation-design.md`

## Global Constraints

- Button label is the fixed Spanish string `→ frase completa` (tooltip copy is Spanish today, e.g. "También:"; no i18n).
- Sentence translation always uses mode `"quick"`, even when the user is in `learning` mode.
- No changes to `src/background/`, `src/shared/prompts.ts`, or the popup.
- Sentence cap stays 500 chars (already enforced by `extractSentence`).
- `npm test` (vitest) must stay green: 56 existing tests + new ones.
- `tsc` runs with `noUnusedLocals`/`noUnusedParameters` — no dead code.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01SvF2hv6Db1SiFq99yExfWJ`

---

### Task 1: Block-level sentence extraction

**Files:**
- Modify: `src/content/text-extractor.ts`
- Test: `src/__tests__/text-extractor.test.ts`

**Interfaces:**
- Consumes: existing `extractSentence(text, wordStart, wordEnd): string` (private helper in the same file, unchanged).
- Produces: `export function extractBlockSentence(node: Text, wordStart: number, wordEnd: number): string` — word offsets are relative to `node`. Also: `extractTextAt` now fills `ExtractedText.sentence` via this function (signature of `extractTextAt` unchanged; Task 4 relies only on the existing `ExtractedText` shape).

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/text-extractor.test.ts` (inside the top-level `describe`, after the existing tests). Add `extractBlockSentence` to the existing import from `../content/text-extractor`:

```typescript
import { extractTextAt, extractBlockSentence } from "../content/text-extractor";
```

```typescript
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
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/__tests__/text-extractor.test.ts`
Expected: FAIL — `extractBlockSentence` is not exported.

- [ ] **Step 3: Implement**

In `src/content/text-extractor.ts`, add below `extractSentence`:

```typescript
const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "TD", "TH", "LABEL", "BLOCKQUOTE", "ARTICLE", "SECTION",
  "ASIDE", "HEADER", "FOOTER", "MAIN", "FIGCAPTION", "CAPTION", "DD", "DT",
  "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "BODY",
]);

// ponytail: cota para no reconstruir el texto de bloques gigantes en cada hover;
// si se supera, la frase queda limitada al nodo de texto (comportamiento previo)
const MAX_BLOCK_TEXT = 5000;

function closestBlock(node: Text): HTMLElement | null {
  let el = node.parentElement;
  while (el) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

function offsetInBlock(block: HTMLElement, node: Text): number {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let current = walker.nextNode();
  while (current && current !== node) {
    offset += (current.textContent || "").length;
    current = walker.nextNode();
  }
  return offset;
}

export function extractBlockSentence(
  node: Text,
  wordStart: number,
  wordEnd: number
): string {
  const nodeText = node.textContent || "";
  const block = closestBlock(node);
  const blockText = block ? block.textContent || "" : "";

  if (!block || blockText.length > MAX_BLOCK_TEXT) {
    return extractSentence(nodeText, wordStart, wordEnd);
  }

  const base = offsetInBlock(block, node);
  const sentence = extractSentence(blockText, base + wordStart, base + wordEnd);
  return sentence.replace(/\s+/g, " ").trim();
}
```

Then in `extractTextAt`, replace the line

```typescript
  const sentence = extractSentence(text, start, end);
```

with

```typescript
  const sentence = extractBlockSentence(textNode, start, end);
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all tests PASS (56 existing + 5 new). If an existing text-extractor test fails, the new block scope changed its expectation — fix the implementation, not the old test, unless the old expectation contradicts the spec.

- [ ] **Step 5: Commit**

```bash
git add src/content/text-extractor.ts src/__tests__/text-extractor.test.ts
git commit -m "feat: extract sentences at block level, spanning inline elements"
```

---

### Task 2: Hover detector ignores the tooltip

**Files:**
- Modify: `src/content/hover-detector.ts`
- Test: `src/__tests__/hover-detector.test.ts` (create)

**Interfaces:**
- Produces: `export function isInTooltip(target: EventTarget | null): boolean` — true when `target` is an Element inside (or being) `[data-hl-tooltip]`. The class's private handlers use it; no public API change to `HoverDetector`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/hover-detector.test.ts`:

```typescript
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from "vitest";
import { isInTooltip } from "../content/hover-detector";

describe("isInTooltip", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("is true for the tooltip element and its descendants", () => {
    document.body.innerHTML =
      `<div data-hl-tooltip><button class="hl-sentence-btn">→ frase completa</button></div>`;
    const tooltip = document.querySelector("[data-hl-tooltip]")!;
    const btn = document.querySelector("button")!;
    expect(isInTooltip(tooltip)).toBe(true);
    expect(isInTooltip(btn)).toBe(true);
  });

  it("is false for other nodes and null", () => {
    document.body.innerHTML = `<p>texto normal</p>`;
    expect(isInTooltip(document.querySelector("p"))).toBe(false);
    expect(isInTooltip(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/hover-detector.test.ts`
Expected: FAIL — `isInTooltip` is not exported.

- [ ] **Step 3: Implement**

In `src/content/hover-detector.ts`, add at the top (after the existing type declarations):

```typescript
export function isInTooltip(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-hl-tooltip]") !== null;
}
```

Guard the three mouse handlers:

`onMouseOver` and `onMouseMove` — add the guard right after the `enabled` check, before touching `currentX/currentY`:

```typescript
  private onMouseOver = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (isInTooltip(e.target)) return;
    this.currentX = e.clientX;
    this.currentY = e.clientY;
    this.resetTimer();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if (isInTooltip(e.target)) return;
    this.currentX = e.clientX;
    this.currentY = e.clientY;
    this.resetTimer();
  };
```

`onMouseOut` — take the event and ignore transitions *into* the tooltip (moving word → tooltip must not hide it; leaving the tooltip to the page still goes idle and hides):

```typescript
  private onMouseOut = (e: MouseEvent): void => {
    if (isInTooltip(e.relatedTarget)) return;
    this.clearTimer();
    if (this.state !== "idle") {
      this.setState("idle");
    }
  };
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/hover-detector.ts src/__tests__/hover-detector.test.ts
git commit -m "feat: hover detector ignores mouse events inside the tooltip"
```

---

### Task 3: Tooltip button and sentence section

**Files:**
- Modify: `src/content/tooltip-renderer.ts`
- Modify: `src/content/styles.css`
- Test: `src/__tests__/tooltip-renderer.test.ts` (create)

**Interfaces:**
- Consumes: `TranslationResponse` from `./cache-l1`; existing `esc()` helper in the same file.
- Produces (Task 4 relies on these exact signatures):
  - `constructor(onTranslateSentence?: (sentence: string) => void)`
  - `show(x, y, originalText, data, showSkeleton, sentence?: string)` — new optional last param
  - `updateContent(originalText: string, data: TranslationResponse, sentence?: string)` — new optional last param
  - `updateSentence(data: TranslationResponse): void`
  - `updateSentenceError(message: string): void`

  The button renders only when `sentence` is provided and differs from `originalText`. Clicking it swaps the button for the dots skeleton and invokes `onTranslateSentence(sentence)`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/tooltip-renderer.test.ts`:

```typescript
/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { TooltipRenderer } from "../content/tooltip-renderer";
import type { TranslationResponse } from "../content/cache-l1";

const wordData: TranslationResponse = {
  translation: "guardar",
  sourceLanguage: "ar",
  direction: "ltr",
  confidence: 0.95,
};

describe("TooltipRenderer sentence section", () => {
  beforeAll(() => {
    // @floating-ui autoUpdate necesita ResizeObserver; jsdom no lo trae
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the button, requests the sentence on click, then shows it", () => {
    const calls: string[] = [];
    const renderer = new TooltipRenderer((s) => calls.push(s));
    renderer.show(10, 10, "حفظ", {} as TranslationResponse, true);
    renderer.updateContent("حفظ", wordData, "حفظ تفاصيل البطاقة");

    const btn = document.querySelector<HTMLButtonElement>(".hl-sentence-btn");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("→ frase completa");

    btn!.click();
    expect(calls).toEqual(["حفظ تفاصيل البطاقة"]);
    expect(document.querySelector(".hl-sentence .hl-skeleton")).not.toBeNull();

    renderer.updateSentence({
      ...wordData,
      translation: "guardar los datos de la tarjeta",
    });
    expect(
      document.querySelector(".hl-sentence-translation")!.textContent
    ).toBe("guardar los datos de la tarjeta");

    renderer.hide();
  });

  it("omits the button when the sentence equals the word", () => {
    const renderer = new TooltipRenderer(() => {});
    renderer.show(10, 10, "hola", {} as TranslationResponse, true);
    renderer.updateContent("hola", wordData, "hola");
    expect(document.querySelector(".hl-sentence-btn")).toBeNull();
    renderer.hide();
  });

  it("omits the button when no sentence is given", () => {
    const renderer = new TooltipRenderer(() => {});
    renderer.show(10, 10, "hola", wordData, false);
    expect(document.querySelector(".hl-sentence-btn")).toBeNull();
    renderer.hide();
  });

  it("shows an error inside the sentence section", () => {
    const renderer = new TooltipRenderer(() => {});
    renderer.show(10, 10, "hola", {} as TranslationResponse, true);
    renderer.updateContent("hola", wordData, "hola mundo entero");
    document.querySelector<HTMLButtonElement>(".hl-sentence-btn")!.click();
    renderer.updateSentenceError("No se pudo traducir. Inténtalo de nuevo.");
    expect(document.querySelector(".hl-sentence .hl-error")!.textContent).toBe(
      "No se pudo traducir. Inténtalo de nuevo."
    );
    renderer.hide();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/tooltip-renderer.test.ts`
Expected: FAIL — constructor takes no argument / `.hl-sentence-btn` never rendered / `updateSentence` does not exist.

- [ ] **Step 3: Implement the renderer changes**

In `src/content/tooltip-renderer.ts`:

Add state and constructor (inside the class, next to the existing fields):

```typescript
  private currentSentence: string | null = null;

  constructor(private onTranslateSentence?: (sentence: string) => void) {}
```

In `show(...)`, add the optional param and reset/assign the sentence. New signature and the relevant edits (body otherwise unchanged):

```typescript
  show(
    x: number,
    y: number,
    originalText: string,
    data: TranslationResponse,
    showSkeleton: boolean,
    sentence?: string
  ): void {
    this.hide();
    this.currentSentence =
      sentence && sentence !== originalText ? sentence : null;
    // ... resto del método igual ...
  }
```

and just after the existing `document.body.appendChild(this.tooltip);` line add:

```typescript
    if (!showSkeleton) {
      this.wireSentenceButton();
    }
```

Replace `updateContent` with:

```typescript
  updateContent(
    originalText: string,
    data: TranslationResponse,
    sentence?: string
  ): void {
    if (!this.tooltip) return;
    this.currentSentence =
      sentence && sentence !== originalText ? sentence : null;
    this.tooltip.innerHTML = this.renderContent(originalText, data);

    if (data.direction === "rtl") {
      this.tooltip.dir = "rtl";
    }
    this.wireSentenceButton();
  }
```

In `renderContent`, append after the `hl-example` block (just before `return html;`):

```typescript
    if (this.currentSentence) {
      html += `<div class="hl-sentence"><button type="button" class="hl-sentence-btn">→ frase completa</button></div>`;
    }
```

Add the new methods after `updateError`:

```typescript
  updateSentence(data: TranslationResponse): void {
    const section = this.tooltip?.querySelector(".hl-sentence");
    if (!section || !this.currentSentence) return;
    section.innerHTML = `
      <div class="hl-original">"${esc(this.currentSentence)}"</div>
      <div class="hl-sentence-translation">${esc(data.translation)}</div>
    `;
  }

  updateSentenceError(message: string): void {
    const section = this.tooltip?.querySelector(".hl-sentence");
    if (!section) return;
    section.innerHTML = `<div class="hl-error">${esc(message)}</div>`;
  }

  private wireSentenceButton(): void {
    const btn = this.tooltip?.querySelector<HTMLButtonElement>(".hl-sentence-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const sentence = this.currentSentence;
      if (!this.tooltip || !sentence) return;
      const section = this.tooltip.querySelector(".hl-sentence");
      if (section) {
        section.innerHTML = `<div class="hl-skeleton"><span class="hl-dot">.</span><span class="hl-dot">.</span><span class="hl-dot">.</span></div>`;
      }
      this.onTranslateSentence?.(sentence);
    });
  }
```

In `hide()`, add `this.currentSentence = null;` as the first line.

- [ ] **Step 4: CSS**

In `src/content/styles.css`, change line 12 from `pointer-events: none;` to `pointer-events: auto;` (the toast's `pointer-events: none` at line ~170 stays). Append at the end of the tooltip section:

```css
[data-hl-tooltip] .hl-sentence {
  margin-top: 6px;
  border-top: 1px solid rgba(128, 128, 128, 0.25);
  padding-top: 6px;
}

[data-hl-tooltip] .hl-sentence-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
}

[data-hl-tooltip] .hl-sentence-btn:hover {
  opacity: 1;
  text-decoration: underline;
}

[data-hl-tooltip] .hl-sentence-translation {
  font-size: 14px;
  font-weight: 500;
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/content/tooltip-renderer.ts src/content/styles.css src/__tests__/tooltip-renderer.test.ts
git commit -m "feat: on-demand sentence section in tooltip with translate button"
```

---

### Task 4: Wire the sentence request in the content script

**Files:**
- Modify: `src/content/index.ts`

**Interfaces:**
- Consumes: `extractBlockSentence`-backed `ExtractedText` (Task 1), interactive tooltip (Tasks 2–3): `TooltipRenderer(onTranslateSentence)`, `show(..., sentence?)`, `updateContent(..., sentence?)`, `updateSentence(data)`, `updateSentenceError(msg)`. Existing: `buildCacheKey`, `l1Cache`, `requestTranslation`, `tooltipErrorFor`, `recordCacheHit`, `recordTranslation`, `requestGeneration`.
- Produces: user-facing feature complete; nothing downstream.

- [ ] **Step 1: Pass the renderer its callback**

In `src/content/index.ts`, replace `const renderer = new TooltipRenderer();` with:

```typescript
const renderer = new TooltipRenderer(onTranslateSentence);
```

and add the handler (near `onHoverReady`). Note: `mode` is always `"quick"` and the sentence is both `text` and its own context, mirroring the manual-selection path:

```typescript
function onTranslateSentence(sentence: string): void {
  const gen = requestGeneration;
  const cacheKey = buildCacheKey(
    sentence,
    sentence,
    currentTargetLang,
    "quick",
    currentModel
  );

  const cached = l1Cache.get(cacheKey);
  if (cached) {
    recordCacheHit();
    renderer.updateSentence(cached);
    return;
  }

  let resultPromise = l1Cache.getPending(cacheKey);
  if (!resultPromise) {
    const controller = new AbortController();
    const outcomePromise = requestTranslation(
      sentence,
      sentence,
      currentTargetLang,
      "quick",
      controller.signal
    );
    resultPromise = outcomePromise.then(({ result, cached: fromL2 }) => {
      l1Cache.set(cacheKey, result);
      if (fromL2) {
        recordCacheHit();
      } else {
        recordTranslation(result.sourceLanguage);
      }
      return result;
    });
    resultPromise.catch(() => {
      // evita "unhandled rejection" cuando nadie está suscrito al pending
    });
    l1Cache.setPending(cacheKey, resultPromise);
  }

  resultPromise
    .then((result) => {
      if (gen !== requestGeneration) return;
      renderer.updateSentence(result);
    })
    .catch((err) => {
      if (gen !== requestGeneration) return;
      const msg = err instanceof Error ? err.message : "";
      renderer.updateSentenceError(tooltipErrorFor(msg));
    });
}
```

- [ ] **Step 2: Thread the sentence into the three render sites in `onHoverReady`**

Only non-selection extractions offer the button (a selection already IS the phrase):

```typescript
  const sentenceForTooltip = extracted.isSelection ? undefined : extracted.sentence;
```

Add that line right after the `cacheKey` construction, then:

1. Cached branch: `renderer.show(x, y, extracted.word, cached, false);` becomes
   `renderer.show(x, y, extracted.word, cached, false, sentenceForTooltip);`
2. `existingPromise.then(...)`: `renderer.updateContent(extracted.word, result);` becomes
   `renderer.updateContent(extracted.word, result, sentenceForTooltip);`
3. `outcomePromise.then(...)`: same replacement as (2).

The two `renderer.show(..., true)` skeleton calls stay as they are (no button while loading the word).

- [ ] **Step 3: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: no type errors, all tests PASS, `dist/` builds.

- [ ] **Step 4: Manual QA**

Load `dist/` as unpacked extension (chrome://extensions → Load unpacked). On a page with real sentences (e.g. any Wikipedia article, and ideally an Arabic/RTL page like the checkout in the bug report):

1. Hover a word inside a sentence with links/bold → tooltip shows the word; button "→ frase completa" appears.
2. Move the mouse onto the tooltip → it does NOT disappear.
3. Click the button → dots skeleton → full sentence translation appears under a divider; original sentence spans the inline elements (the reported bug).
4. Click the button on a second hover of the same word → sentence appears instantly (L1 cache).
5. Move the mouse from the tooltip back to the page → tooltip hides normally.
6. Hover a standalone single word (e.g. a nav item) where sentence == word → no button.
7. Learning mode on → word still shows learning fields; sentence section stays simple translation.

- [ ] **Step 5: Commit**

```bash
git add src/content/index.ts
git commit -m "feat: translate full sentence on demand from tooltip button"
```
