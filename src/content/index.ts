import { HoverDetector, HoverState } from "./hover-detector";
import { extractTextAt, getWordRangeAt } from "./text-extractor";
import { TooltipRenderer } from "./tooltip-renderer";
import { l1Cache } from "./cache-l1";
import type { TranslationResponse } from "./cache-l1";
import { wordHighlight } from "./word-highlight";
import { buildCacheKey } from "../shared/cache-key";
import { GROQ_MODEL } from "../shared/constants";

let currentAbortController: AbortController | null = null;
let requestGeneration = 0;
let currentTargetLang = "es";
let currentMode: "quick" | "learning" = "quick";
let currentEnabled = true;
let currentSiteDisabled = false;
let debounceMs = 300;
let currentModel = GROQ_MODEL;

const renderer = new TooltipRenderer();

const hoverDetector = new HoverDetector(
  debounceMs,
  onHoverReady,
  onStateChange
);

function updateDetectorEnabled(): void {
  hoverDetector.setEnabled(currentEnabled && !currentSiteDisabled);
}

let effectiveHostname = window.location.hostname;

async function resolveEffectiveHostname(): Promise<void> {
  if (window === window.top) return;
  try {
    effectiveHostname = window.top!.location.hostname;
    return;
  } catch {
    // cross-origin: se lo pedimos al service worker
  }
  try {
    const resp = (await chrome.runtime.sendMessage({ type: "GET_TAB_HOST" })) as
      | { host?: string }
      | undefined;
    if (resp && typeof resp.host === "string" && resp.host) {
      effectiveHostname = resp.host;
    }
  } catch {
    // SW no disponible: conservamos el hostname del frame
  }
}

resolveEffectiveHostname()
  .then(loadSettings)
  .then(() => {
    hoverDetector.init();
  });

let currentToast: HTMLDivElement | null = null;

interface UsageStats {
  wordsTranslated: number;
  cacheHits: number;
  topLanguages: Record<string, number>;
}

let pendingStats: UsageStats = { wordsTranslated: 0, cacheHits: 0, topLanguages: {} };
let pendingStatsCount = 0;
const STATS_PERSIST_INTERVAL = 10;

function recordCacheHit(): void {
  pendingStats.cacheHits++;
  pendingStats.wordsTranslated++;
  maybeFlushStats();
}

function recordTranslation(sourceLang: string): void {
  pendingStats.wordsTranslated++;
  pendingStats.topLanguages[sourceLang] = (pendingStats.topLanguages[sourceLang] || 0) + 1;
  maybeFlushStats();
}

function maybeFlushStats(): void {
  pendingStatsCount++;
  if (pendingStatsCount >= STATS_PERSIST_INTERVAL) {
    void flushStats();
  }
}

async function flushStats(): Promise<void> {
  if (pendingStats.wordsTranslated === 0 && pendingStats.cacheHits === 0) return;
  const deltas = pendingStats;
  pendingStats = { wordsTranslated: 0, cacheHits: 0, topLanguages: {} };
  pendingStatsCount = 0;
  try {
    const data = await chrome.storage.local.get("usageStats");
    const stored = data.usageStats as UsageStats | undefined;
    const merged: UsageStats =
      stored && typeof stored.wordsTranslated === "number"
        ? { ...stored, topLanguages: stored.topLanguages || {} }
        : { wordsTranslated: 0, cacheHits: 0, topLanguages: {} };
    merged.wordsTranslated += deltas.wordsTranslated;
    merged.cacheHits += deltas.cacheHits;
    for (const [lang, count] of Object.entries(deltas.topLanguages)) {
      merged.topLanguages[lang] = (merged.topLanguages[lang] || 0) + count;
    }
    await chrome.storage.local.set({ usageStats: merged });
  } catch {
    // storage inaccessible (invalidated context): discard these deltas
  }
}

window.addEventListener("pagehide", () => {
  void flushStats();
});

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
      "groqModel",
    ]);
    currentTargetLang = data.targetLang || "es";
    currentMode = data.translationMode || "quick";
    currentModel = typeof data.groqModel === "string" ? data.groqModel : GROQ_MODEL;
    debounceMs = typeof data.hoverDelay === "number" ? data.hoverDelay : 300;
    currentEnabled = data.enabled !== false;

    const disabledSites: string[] = Array.isArray(data.disabledSites) ? data.disabledSites : [];
    currentSiteDisabled = disabledSites.includes(effectiveHostname);

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
  if (changes.groqModel) {
    const nv = changes.groqModel.newValue;
    currentModel = typeof nv === "string" ? nv : GROQ_MODEL;
  }
  if (changes.hoverDelay) {
    const nv = changes.hoverDelay.newValue;
    debounceMs = typeof nv === "number" ? nv : 300;
    hoverDetector.setDebounceMs(debounceMs);
  }
  if (changes.enabled) {
    currentEnabled = changes.enabled.newValue;
    updateDetectorEnabled();
    if (window === window.top) {
      showToast(currentEnabled ? "HoverLingo: Activado" : "HoverLingo: Desactivado");
    }
  }
  if (changes.disabledSites) {
    const nv = changes.disabledSites.newValue;
    const disabledSites: string[] = Array.isArray(nv) ? nv : [];
    currentSiteDisabled = disabledSites.includes(effectiveHostname);
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

  const cacheKey = buildCacheKey(
    extracted.word,
    extracted.sentence,
    currentTargetLang,
    currentMode,
    currentModel
  );

  const cached = l1Cache.get(cacheKey);
  if (cached) {
    renderer.show(x, y, extracted.word, cached, false);
    recordCacheHit();
    return;
  }

  const existingPromise = l1Cache.getPending(cacheKey);

  if (existingPromise) {
    renderer.show(x, y, extracted.word, {} as TranslationResponse, true);

    existingPromise
      .then((result) => {
        recordCacheHit();
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

  const outcomePromise = requestTranslation(
    extracted.word,
    extracted.sentence,
    currentTargetLang,
    currentMode,
    currentAbortController.signal
  );

  const resultPromise = outcomePromise.then((o) => o.result);
  resultPromise.catch(() => {
    // evita "unhandled rejection" cuando nadie está suscrito al pending
  });
  l1Cache.setPending(cacheKey, resultPromise);

  outcomePromise
    .then(({ result, cached }) => {
      l1Cache.set(cacheKey, result);
      if (cached) {
        recordCacheHit();
      } else {
        recordTranslation(result.sourceLanguage);
      }
      if (gen !== requestGeneration) return;
      renderer.updateContent(extracted.word, result);
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

interface TranslationOutcome {
  result: TranslationResponse;
  cached: boolean;
}

async function requestTranslation(
  text: string,
  sentence: string,
  targetLang: string,
  mode: "quick" | "learning",
  signal: AbortSignal
): Promise<TranslationOutcome> {
  const sendWithRetry = async (attempt: number): Promise<TranslationOutcome> => {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    return new Promise((resolve, reject) => {
      const handler = (message: {
        success: boolean;
        data?: TranslationResponse;
        error?: string;
        cached?: boolean;
      }) => {
        if (message.success && message.data) {
          resolve({ result: message.data, cached: message.cached === true });
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
