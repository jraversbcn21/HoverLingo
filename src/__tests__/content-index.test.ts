/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type SendCallback = (response: unknown) => void;

const sendMessage = vi.fn();

function stubChrome(): void {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: { sendMessage, lastError: undefined },
    i18n: { getMessage: () => "→ full sentence" },
  });
  // @floating-ui autoUpdate necesita ResizeObserver; jsdom no lo trae
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

const TEXT = "hello world";
let textNode: Text;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// jsdom no implementa caretRangeFromPoint: x se interpreta como offset en TEXT
function stubCaret(): void {
  (document as unknown as { caretRangeFromPoint: unknown }).caretRangeFromPoint = (
    x: number
  ) => {
    const r = document.createRange();
    r.setStart(textNode, x);
    r.collapse(true);
    return r;
  };
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

function hoverAt(x: number): void {
  textNode.parentElement!.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: 5 })
  );
  vi.advanceTimersByTime(300);
}

function translateCalls(): unknown[][] {
  return sendMessage.mock.calls.filter(([m]) => (m as { type: string }).type === "TRANSLATE");
}

function respond(callIndex: number, translation: string): void {
  const cb = translateCalls()[callIndex][1] as SendCallback;
  cb({
    success: true,
    data: { translation, sourceLanguage: "en", direction: "ltr", confidence: 0.9 },
    cached: false,
  });
}

// Cada test reimporta el módulo; sus listeners en document/window se
// registran aquí para retirarlos y que no se acumulen entre tests.
const listeners: Array<[EventTarget, string, EventListenerOrEventListenerObject, unknown]> = [];

function trackListeners(target: EventTarget): void {
  const original = target.addEventListener.bind(target);
  vi.spyOn(target, "addEventListener").mockImplementation((type, fn, opts) => {
    listeners.push([target, type, fn!, opts]);
    original(type, fn, opts);
  });
}

beforeEach(async () => {
  vi.resetModules();
  trackListeners(document);
  trackListeners(window);
  vi.useFakeTimers();
  sendMessage.mockReset();
  document.body.innerHTML = `<p>${TEXT}</p>`;
  textNode = document.querySelector("p")!.firstChild as Text;
  stubChrome();
  stubCaret();
  await import("../content/index");
  await flush(); // loadSettings → hoverDetector.init()
});

afterEach(() => {
  // Volver a idle desconecta el MutationObserver del detector
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  for (const [target, type, fn, opts] of listeners.splice(0)) {
    target.removeEventListener(type, fn, opts as EventListenerOptions);
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("content script: re-hover on the same word", () => {
  it("does not rebuild the tooltip or re-request when resting again on the same word", async () => {
    hoverAt(1); // "hello"
    expect(translateCalls()).toHaveLength(1);
    respond(0, "hola");
    await flush();

    const tooltip = document.querySelector("[data-hl-tooltip]");
    expect(tooltip?.textContent).toContain("hola");

    hoverAt(3); // sigue sobre "hello"
    await flush();

    expect(translateCalls()).toHaveLength(1);
    expect(document.querySelector("[data-hl-tooltip]")).toBe(tooltip);
  });

  it("does not abort the in-flight request when resting again on the same word", async () => {
    hoverAt(1);
    hoverAt(2); // misma palabra mientras la petición está en vuelo
    respond(0, "hola");
    await flush();

    expect(translateCalls()).toHaveLength(1);
    expect(document.querySelector("[data-hl-tooltip]")?.textContent).toContain("hola");
  });

  it("still translates when moving to a different word", async () => {
    hoverAt(1); // "hello"
    respond(0, "hola");
    await flush();

    hoverAt(8); // "world"
    expect(translateCalls()).toHaveLength(2);
    respond(1, "mundo");
    await flush();

    expect(document.querySelector("[data-hl-tooltip]:not(.hl-hiding)")?.textContent).toContain(
      "mundo"
    );
  });

  it("allows retrying the same word after an error", async () => {
    hoverAt(1);
    const cb = translateCalls()[0][1] as SendCallback;
    cb({ success: false, error: "boom" });
    await flush();

    hoverAt(2);
    expect(translateCalls()).toHaveLength(2);
  });
});
