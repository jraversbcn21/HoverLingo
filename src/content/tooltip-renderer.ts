import { computePosition, flip, shift, offset, autoUpdate } from "@floating-ui/dom";
import type { TranslationResponse } from "./cache-l1";

type CleanupFn = () => void;

export class TooltipRenderer {
  private tooltip: HTMLDivElement | null = null;
  private cleanupFloating: CleanupFn | null = null;

  show(
    x: number,
    y: number,
    originalText: string,
    data: TranslationResponse,
    showSkeleton: boolean
  ): void {
    this.hide();

    this.tooltip = document.createElement("div");
    this.tooltip.setAttribute("data-hl-tooltip", "");
    this.tooltip.setAttribute("role", "tooltip");
    this.tooltip.setAttribute("aria-live", "polite");

    if (data.direction === "rtl") {
      this.tooltip.dir = "rtl";
    }

    const mode = detectColorScheme();
    this.tooltip.classList.add(mode);

    if (showSkeleton) {
      this.tooltip.innerHTML = this.renderSkeleton(originalText, data.direction);
    } else {
      this.tooltip.innerHTML = this.renderContent(originalText, data);
    }

    document.body.appendChild(this.tooltip);

    const virtualEl = {
      getBoundingClientRect() {
        return {
          x,
          y,
          top: y,
          left: x,
          bottom: y,
          right: x,
          width: 0,
          height: 0,
        };
      },
    };

    const tooltip = this.tooltip;
    this.cleanupFloating = autoUpdate(virtualEl, tooltip, () => {
      if (!tooltip) return;
      computePosition(virtualEl, tooltip, {
        placement: "top-start",
        middleware: [
          offset(10),
          flip({ padding: 10 }),
          shift({ padding: 8 }),
        ],
      }).then(({ x: px, y: py }) => {
        if (this.tooltip) {
          Object.assign(this.tooltip.style, {
            left: `${px}px`,
            top: `${py}px`,
          });
        }
      });
    });

    requestAnimationFrame(() => {
      if (this.tooltip) {
        this.tooltip.classList.add("hl-visible");
      }
    });
  }

  updateContent(originalText: string, data: TranslationResponse): void {
    if (!this.tooltip) return;
    this.tooltip.innerHTML = this.renderContent(originalText, data);

    if (data.direction === "rtl") {
      this.tooltip.dir = "rtl";
    }
  }

  hide(): void {
    if (this.tooltip) {
      this.tooltip.classList.remove("hl-visible");
      this.tooltip.classList.add("hl-hiding");
      const el = this.tooltip;
      setTimeout(() => {
        el.remove();
      }, 150);
      this.tooltip = null;
    }

    if (this.cleanupFloating) {
      this.cleanupFloating();
      this.cleanupFloating = null;
    }
  }

  isVisible(): boolean {
    return this.tooltip !== null;
  }

  private renderSkeleton(originalText: string, direction: string): string {
    return `
      <div class="hl-original">${esc(originalText)}</div>
      <div class="hl-skeleton">
        <span class="hl-dot">.</span><span class="hl-dot">.</span><span class="hl-dot">.</span>
      </div>
    `;
  }

  private renderContent(originalText: string, data: TranslationResponse): string {
    const confidenceLow = data.confidence < 0.7;
    const prefix = confidenceLow ? "~" : "";
    const hasAlternatives = data.alternatives && data.alternatives.length > 0;

    let html = "";

    if (data.pronunciation && data.partOfSpeech) {
      html += `
        <div class="hl-meta">
          <span class="hl-pos">${esc(data.partOfSpeech)}</span>
          ${data.pronunciation ? `<span class="hl-pron">${esc(data.pronunciation)}</span>` : ""}
        </div>
      `;
    }

    html += `<div class="hl-original">"${esc(originalText)}"</div>`;
    html += `<div class="hl-translation">${prefix}${esc(data.translation)}</div>`;

    if (hasAlternatives) {
      html += `<div class="hl-alternatives">${esc(data.alternatives!.join(", "))}</div>`;
    }

    if (data.explanation) {
      html += `<div class="hl-explanation">${esc(data.explanation)}</div>`;
    }

    if (data.example) {
      html += `<div class="hl-example">"${esc(data.example)}"</div>`;
    }

    return html;
  }
}

function esc(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function detectColorScheme(): "hl-light" | "hl-dark" {
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "hl-dark";
  }
  return "hl-light";
}
