import { HoverDetector, HoverState } from "./hover-detector";
import { extractTextAt, getWordRangeAt } from "./text-extractor";
import { TooltipRenderer } from "./tooltip-renderer";
import { l1Cache } from "./cache-l1";
import type { TranslationResponse } from "./cache-l1";
import { wordHighlight } from "./word-highlight";

let currentAbortController: AbortController | null = null;
let requestGeneration = 0;
let currentTargetLang = "es";
let currentMode: "quick" | "learning" = "quick";
let currentEnabled = true;
let currentSiteDisabled = false;
let debounceMs = 300;

const renderer = new TooltipRenderer();

const hoverDetector = new HoverDetector(
  debounceMs,
  onHoverReady,
  onStateChange
);

function updateDetectorEnabled(): void {
  hoverDetector.setEnabled(currentEnabled && !currentSiteDisabled);
}

loadSettings().then(() => {
  hoverDetector.init();
});

let currentToast: HTMLDivElement | null = null;

interface UsageStats {
  wordsTranslated: number;
  cacheHits: number;
  topLanguages: Record<string, number>;
}

let stats: UsageStats = { wordsTranslated: 0, cacheHits: 0, topLanguages: {} };
let statsWriteCount = 0;
const STATS_PERSIST_INTERVAL = 10;

function loadStats(stored: UsageStats | undefined): void {
  stats = stored || { wordsTranslated: 0, cacheHits: 0, topLanguages: {} };
}

function recordCacheHit(): void {
  stats.cacheHits++;
  stats.wordsTranslated++;
  statsWriteCount++;
  if (statsWriteCount >= STATS_PERSIST_INTERVAL) persistStats();
}

function recordTranslation(sourceLang: string): void {
  stats.wordsTranslated++;
  stats.topLanguages[sourceLang] = (stats.topLanguages[sourceLang] || 0) + 1;
  statsWriteCount++;
  if (statsWriteCount >= STATS_PERSIST_INTERVAL) persistStats();
}

function persistStats(): void {
  statsWriteCount = 0;
  chrome.storage.local.set({ usageStats: stats });
}

function showToast(message: string): void {
  if (currentToast) {
    currentToast.classList.add("hl-toast-out");
    const old = currentToast;
    old.addEventListener("animationend", () => old.remove());
    currentToast = null;
  }

  const toast = document.createElement("div");
  toast.className = "hoverlingo-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  currentToast = toast;

  setTimeout(() => {
    toast.classList.add("hl-toast-out");
    toast.addEventListener("animationend", () => {
      toast.remove();
      if (currentToast === toast) {
        currentToast = null;
      }
    });
  }, 3000);
}

async function loadSettings(): Promise<void> {
  try {
    const data = await chrome.storage.local.get([
      "targetLang",
      "translationMode",
      "hoverDelay",
      "enabled",
      "disabledSites",
      "usageStats",
    ]);
    currentTargetLang = data.targetLang || "es";
    currentMode = data.translationMode || "quick";
    debounceMs = typeof data.hoverDelay === "number" ? data.hoverDelay : 300;
    currentEnabled = data.enabled !== false;

    const disabledSites: string[] = Array.isArray(data.disabledSites) ? data.disabledSites : [];
    currentSiteDisabled = disabledSites.includes(window.location.hostname);

    loadStats(data.usageStats);

    hoverDetector.setDebounceMs(debounceMs);
    updateDetectorEnabled();
  } catch {
    // defaults are fine
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.targetLang) {
    currentTargetLang = changes.targetLang.newValue;
  }
  if (changes.translationMode) {
    currentMode = changes.translationMode.newValue;
  }
  if (changes.hoverDelay) {
    const nv = changes.hoverDelay.newValue;
    debounceMs = typeof nv === "number" ? nv : 300;
    hoverDetector.setDebounceMs(debounceMs);
  }
  if (changes.enabled) {
    currentEnabled = changes.enabled.newValue;
    updateDetectorEnabled();
    showToast(currentEnabled ? "HoverLingo: Activado" : "HoverLingo: Desactivado");
  }
  if (changes.disabledSites) {
    const nv = changes.disabledSites.newValue;
    const disabledSites: string[] = Array.isArray(nv) ? nv : [];
    currentSiteDisabled = disabledSites.includes(window.location.hostname);
    updateDetectorEnabled();
  }
});

function onStateChange(state: HoverState): void {
  if (state === "idle") {
    abortCurrentRequest();
    renderer.hide();
    wordHighlight.hide();
  }
}

function onHoverReady(x: number, y: number): void {
  abortCurrentRequest();
  const gen = requestGeneration;

  const extracted = extractTextAt(x, y);
  if (!extracted || !extracted.word) {
    return;
  }

  const wordRange = getWordRangeAt(x, y);
  if (wordRange) {
    wordHighlight.show(wordRange);
  }

  const cached = l1Cache.get(extracted.word, currentTargetLang, currentMode);
  if (cached) {
    renderer.show(x, y, extracted.word, cached, false);
    recordCacheHit();
    return;
  }

  const existingPromise = l1Cache.getPending(
    extracted.word,
    currentTargetLang,
    currentMode
  );

  if (existingPromise) {
    renderer.show(x, y, extracted.word, {} as TranslationResponse, true);

    existingPromise
      .then((result) => {
        if (gen !== requestGeneration) return;
        renderer.updateContent(extracted.word, result);
      })
      .catch(() => {
        if (gen !== requestGeneration) return;
        wordHighlight.hide();
        renderer.updateError(extracted.word, "No se pudo traducir. Inténtalo de nuevo.");
      });
    return;
  }

  currentAbortController = new AbortController();

  renderer.show(x, y, extracted.word, {} as TranslationResponse, true);

  const promise = requestTranslation(
    extracted.word,
    extracted.sentence,
    currentTargetLang,
    currentMode,
    currentAbortController.signal
  );

  l1Cache.setPending(extracted.word, currentTargetLang, currentMode, promise);

  promise
    .then((result) => {
      l1Cache.set(extracted.word, currentTargetLang, currentMode, result);
      recordTranslation(result.sourceLanguage);
      if (gen !== requestGeneration) return;
      renderer.updateContent(extracted.word, result);
      hoverDetector.notifyTranslationComplete();
    })
    .catch((err) => {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      if (gen !== requestGeneration) return;
      wordHighlight.hide();
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("API key not configured")) {
        renderer.updateError(extracted.word, "Configura tu API key de Groq en el popup de HoverLingo");
      } else if (msg.includes("timed out")) {
        renderer.updateError(extracted.word, "La traducción tardó demasiado. Inténtalo de nuevo.");
      } else {
        renderer.updateError(extracted.word, "No se pudo traducir. Inténtalo de nuevo.");
      }
    });
}

function abortCurrentRequest(): void {
  requestGeneration++;
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
}

async function requestTranslation(
  text: string,
  sentence: string,
  targetLang: string,
  mode: "quick" | "learning",
  signal: AbortSignal
): Promise<TranslationResponse> {
  const sendWithRetry = async (attempt: number): Promise<TranslationResponse> => {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise((resolve, reject) => {
      const handler = (message: { success: boolean; data?: TranslationResponse; error?: string }) => {
        if (message.success && message.data) {
          resolve(message.data);
        } else {
          reject(new Error(message.error || "Translation failed"));
        }
      };

        chrome.runtime.sendMessage(
          {
            type: "TRANSLATE",
            payload: { text, sentence, targetLang, mode },
          },
          (response) => {
            if (chrome.runtime.lastError) {
              const msg = chrome.runtime.lastError.message || "";
              if (
                attempt < 6 &&
                (msg.includes("Extension context invalidated") ||
                  msg.includes("receiving end does not exist") ||
                  msg.includes("message port closed"))
              ) {
                const delay = 300 * Math.pow(2, attempt);
                setTimeout(() => {
                  sendWithRetry(attempt + 1).then(resolve).catch(reject);
                }, delay);
                return;
              }
              reject(new Error(msg));
              return;
            }
            handler(response);
          }
        );
    });
  };

  return sendWithRetry(0);
}
