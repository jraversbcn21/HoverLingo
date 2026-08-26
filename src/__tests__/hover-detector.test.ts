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
