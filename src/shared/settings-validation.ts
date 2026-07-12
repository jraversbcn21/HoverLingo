import { AVAILABLE_MODELS } from "./constants";
import { TARGET_LANGUAGES } from "./types";

export function sanitizeImportedSettings(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {};
  }
  const d = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (typeof d.groqModel === "string" && d.groqModel in AVAILABLE_MODELS) {
    out.groqModel = d.groqModel;
  }
  if (typeof d.targetLang === "string" && d.targetLang in TARGET_LANGUAGES) {
    out.targetLang = d.targetLang;
  }
  if (d.translationMode === "quick" || d.translationMode === "learning") {
    out.translationMode = d.translationMode;
  }
  if (typeof d.hoverDelay === "number" && Number.isFinite(d.hoverDelay)) {
    out.hoverDelay = Math.min(1000, Math.max(100, Math.round(d.hoverDelay)));
  }
  if (typeof d.enabled === "boolean") {
    out.enabled = d.enabled;
  }
  if (Array.isArray(d.disabledSites)) {
    out.disabledSites = d.disabledSites
      .filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 253)
      .slice(0, 1000);
  }
  return out;
}
