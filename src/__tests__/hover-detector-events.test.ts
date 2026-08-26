/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HoverDetector, HoverState } from "../content/hover-detector";

describe("HoverDetector tooltip guards", () => {
  let detector: HoverDetector;
  let hoverCalls: Array<[number, number]>;
  let states: HoverState[];

  beforeEach(() => {
    document.body.innerHTML = `<div data-hl-tooltip><div class="hl-scrollable">tooltip content</div></div>`;
    vi.useFakeTimers();
    hoverCalls = [];
    states = [];
    detector = new HoverDetector(
      300,
      (x, y) => hoverCalls.push([x, y]),
      (state) => states.push(state)
    );
    detector.init();
  });

  afterEach(() => {
    detector.destroy();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("scrolling inside the tooltip does not flip state to idle", () => {
    const pageEl = document.createElement("div");
    pageEl.textContent = "some page text";
    document.body.appendChild(pageEl);

    // drive the detector into "hovering" via a real mouseover + debounce
    const moveOnPage = new MouseEvent("mouseover", {
      bubbles: true,
      clientX: 10,
      clientY: 10,
    });
    pageEl.dispatchEvent(moveOnPage);
    vi.advanceTimersByTime(300);
    expect(states).toContain("hovering");
    states.length = 0;

    const tooltip = document.querySelector("[data-hl-tooltip]")!;
    const inner = tooltip.querySelector(".hl-scrollable")!;
    const scrollEvent = new Event("scroll", { bubbles: true });
    inner.dispatchEvent(scrollEvent);

    expect(states).not.toContain("idle");
  });

  function enterHoveringState(): void {
    const pageEl = document.createElement("div");
    pageEl.textContent = "some page text";
    document.body.appendChild(pageEl);
    pageEl.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, clientX: 10, clientY: 10 })
    );
    vi.advanceTimersByTime(300);
    expect(states).toContain("hovering");
    states.length = 0;
  }

  function addNodes(parent: Element, count: number): void {
    for (let i = 0; i < count; i++) {
      parent.appendChild(document.createElement("span"));
    }
  }

  it("mutations inside the tooltip do not count toward the mutation threshold", async () => {
    enterHoveringState();

    // simulate the sentence flow's churn: > MUTATION_THRESHOLD (20) nodes
    addNodes(document.querySelector("[data-hl-tooltip]")!, 25);
    await Promise.resolve(); // flush MutationObserver microtask
    vi.advanceTimersByTime(500); // MUTATION_DEBOUNCE

    expect(states).not.toContain("idle");
  });

  it("page mutations do not flip state to idle while the pointer is inside the tooltip", async () => {
    enterHoveringState();

    // pointer parks on the tooltip (e.g. after clicking "frase completa")
    document.querySelector("[data-hl-tooltip]")!.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, clientX: 50, clientY: 50 })
    );

    // page JS (analytics, SPA re-render) churns the DOM past the threshold
    addNodes(document.body, 25);
    await Promise.resolve();
    vi.advanceTimersByTime(500);

    expect(states).not.toContain("idle");
  });

  it("page mutations past the threshold still flip state to idle", async () => {
    enterHoveringState();

    addNodes(document.body, 25);
    await Promise.resolve();
    vi.advanceTimersByTime(500);

    expect(states).toContain("idle");
  });

  it("a mousemove into the tooltip cancels the pending debounce timer", () => {
    const pageEl = document.createElement("div");
    pageEl.textContent = "some page text";
    document.body.appendChild(pageEl);

    const moveOnPage = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 10,
      clientY: 10,
    });
    pageEl.dispatchEvent(moveOnPage);

    const tooltip = document.querySelector("[data-hl-tooltip]")!;
    const moveOnTooltip = new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 20,
      clientY: 20,
    });
    tooltip.dispatchEvent(moveOnTooltip);

    vi.advanceTimersByTime(1000);

    expect(hoverCalls.length).toBe(0);
  });
});
