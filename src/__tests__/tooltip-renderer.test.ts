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
