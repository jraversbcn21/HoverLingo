import { TARGET_LANGUAGES } from "../shared/types";
import { AVAILABLE_MODELS, GROQ_MODEL } from "../shared/constants";

const apiKeyInput = document.getElementById("groqApiKey") as HTMLInputElement;
const enabledToggle = document.getElementById("enabledToggle") as HTMLInputElement;
const disableSiteToggle = document.getElementById("disableSiteToggle") as HTMLInputElement;
const disableSiteLabel = document.getElementById("disableSiteLabel") as HTMLLabelElement;
const disableSiteSection = document.getElementById("siteDisableSection") as HTMLElement;
const modelSelect = document.getElementById("groqModel") as HTMLSelectElement;
const targetLangSelect = document.getElementById("targetLang") as HTMLSelectElement;
const modeSelect = document.getElementById("translationMode") as HTMLSelectElement;
const hoverDelayInput = document.getElementById("hoverDelay") as HTMLInputElement;
const hoverDelayLabel = document.getElementById("hoverDelayValue") as HTMLSpanElement;
const shortcutHint = document.getElementById("shortcutHint") as HTMLParagraphElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const statWords = document.getElementById("statWords") as HTMLSpanElement;
const statHitRate = document.getElementById("statHitRate") as HTMLSpanElement;
const topLangs = document.getElementById("topLangs") as HTMLDivElement;
const exportBtn = document.getElementById("exportBtn") as HTMLButtonElement;
const importBtn = document.getElementById("importBtn") as HTMLButtonElement;

let apiKeyDebounce: ReturnType<typeof setTimeout> | null = null;
let currentSiteHostname = "";

async function getCurrentSite(): Promise<string> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url;
    if (!url) return "";
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function loadSiteSettings(): Promise<void> {
  currentSiteHostname = await getCurrentSite();
  if (!currentSiteHostname) {
    disableSiteSection.style.display = "none";
    return;
  }

  disableSiteLabel.textContent = `Disable on ${currentSiteHostname}`;

  const data = await chrome.storage.local.get("disabledSites");
  const disabledSites: string[] = data.disabledSites || [];
  disableSiteToggle.checked = disabledSites.includes(currentSiteHostname);
}

function populateLanguages(): void {
  for (const [code, name] of Object.entries(TARGET_LANGUAGES)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = name;
    targetLangSelect.appendChild(option);
  }
}

function populateModels(): void {
  for (const [id, name] of Object.entries(AVAILABLE_MODELS)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    modelSelect.appendChild(option);
  }
}

async function loadStats(): Promise<void> {
  const data = await chrome.storage.local.get("usageStats");
  const stats = data.usageStats as { wordsTranslated: number; cacheHits: number; topLanguages: Record<string, number> } | undefined;

  if (!stats || stats.wordsTranslated === 0) {
    statWords.textContent = "0";
    statHitRate.textContent = "0%";
    topLangs.textContent = "";
    return;
  }

  statWords.textContent = String(stats.wordsTranslated);

  const total = stats.wordsTranslated;
  const cacheHits = stats.cacheHits || 0;
  const hitRate = total > 0 ? Math.round((cacheHits / total) * 100) : 0;
  statHitRate.textContent = `${hitRate}%`;

  if (stats.topLanguages) {
    const entries = Object.entries(stats.topLanguages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
    if (entries.length > 0) {
      topLangs.textContent = entries.map(([lang, count]) => `${lang}: ${count}`).join(" · ");
    } else {
      topLangs.textContent = "";
    }
  }
}

async function loadSettings(): Promise<void> {
  const data = await chrome.storage.local.get([
    "groqApiKey",
    "groqModel",
    "targetLang",
    "translationMode",
    "hoverDelay",
    "enabled",
  ]);

  apiKeyInput.value = data.groqApiKey || "";
  enabledToggle.checked = data.enabled !== false;
  modelSelect.value = data.groqModel || GROQ_MODEL;
  targetLangSelect.value = data.targetLang || "es";
  modeSelect.value = data.translationMode || "quick";
  hoverDelayInput.value = String(data.hoverDelay || 300);
  hoverDelayLabel.textContent = `${data.hoverDelay || 300}ms`;

  disableSiteSection.style.display = data.enabled !== false ? "" : "none";
}

function exportSettings(): void {
  chrome.storage.local.get([
    "groqModel",
    "targetLang",
    "translationMode",
    "hoverDelay",
    "enabled",
    "disabledSites",
  ]).then((data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hoverlingo-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    showStatus("Exported", "success");
  });
}

function importSettings(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      const allowedKeys = ["groqModel", "targetLang", "translationMode", "hoverDelay", "enabled", "disabledSites"];
      const toSave: Record<string, unknown> = {};
      for (const key of allowedKeys) {
        if (key in data) toSave[key] = data[key];
      }

      if (Object.keys(toSave).length === 0) {
        showStatus("Invalid settings file", "error");
        return;
      }

      await chrome.storage.local.set(toSave);
      await loadSettings();
      await loadSiteSettings();
      showStatus("Imported", "success");
    } catch {
      showStatus("Failed to import", "error");
    }
  };
  input.click();
}

async function saveSetting(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
  showStatus("Saved", "success");
}

async function saveApiKey(): Promise<void> {
  const value = apiKeyInput.value.trim();
  await chrome.storage.local.set({ groqApiKey: value });
  showStatus("Saved", "success");
}

function showStatus(message: string, type: "success" | "error"): void {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  setTimeout(() => {
    statusDiv.textContent = "";
    statusDiv.className = "status";
  }, 2000);
}

apiKeyInput.addEventListener("input", () => {
  if (apiKeyDebounce) clearTimeout(apiKeyDebounce);
  apiKeyDebounce = setTimeout(saveApiKey, 500);
});

apiKeyInput.addEventListener("change", () => {
  if (apiKeyDebounce) clearTimeout(apiKeyDebounce);
  saveApiKey();
});

apiKeyInput.addEventListener("blur", () => {
  if (apiKeyDebounce) clearTimeout(apiKeyDebounce);
  saveApiKey();
});

targetLangSelect.addEventListener("change", () => {
  saveSetting("targetLang", targetLangSelect.value);
});

modelSelect.addEventListener("change", () => {
  saveSetting("groqModel", modelSelect.value);
});

modeSelect.addEventListener("change", () => {
  saveSetting("translationMode", modeSelect.value);
});

hoverDelayInput.addEventListener("input", () => {
  const val = hoverDelayInput.value;
  hoverDelayLabel.textContent = `${val}ms`;
});

hoverDelayInput.addEventListener("change", () => {
  saveSetting("hoverDelay", parseInt(hoverDelayInput.value, 10));
});

enabledToggle.addEventListener("change", () => {
  saveSetting("enabled", enabledToggle.checked);
  disableSiteSection.style.display = enabledToggle.checked ? "" : "none";
});

disableSiteToggle.addEventListener("change", async () => {
  if (!currentSiteHostname) return;

  const data = await chrome.storage.local.get("disabledSites");
  const disabledSites: string[] = data.disabledSites || [];

  if (disableSiteToggle.checked) {
    if (!disabledSites.includes(currentSiteHostname)) {
      disabledSites.push(currentSiteHostname);
    }
  } else {
    const idx = disabledSites.indexOf(currentSiteHostname);
    if (idx !== -1) disabledSites.splice(idx, 1);
  }

  await chrome.storage.local.set({ disabledSites });
  showStatus("Saved", "success");
});

window.addEventListener("pagehide", () => {
  if (apiKeyDebounce) clearTimeout(apiKeyDebounce);
  chrome.storage.local.set({ groqApiKey: apiKeyInput.value.trim() });
});

exportBtn.addEventListener("click", exportSettings);
importBtn.addEventListener("click", importSettings);

populateModels();
populateLanguages();
loadSiteSettings();
loadSettings();
loadStats();

shortcutHint.textContent = "Shortcut: Ctrl+Shift+K";
