export interface HoverCallback {
  (x: number, y: number): void;
}

export type HoverState = "idle" | "hovering";

export class HoverDetector {
  private debounceMs: number;
  private callback: HoverCallback;
  private onStateChange: (state: HoverState) => void;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private currentX = 0;
  private currentY = 0;
  private state: HoverState = "idle";
  private enabled = true;
  private observer: MutationObserver | null = null;
  private mutationTimer: ReturnType<typeof setTimeout> | null = null;
  private mutationCount = 0;
  private static readonly MUTATION_DEBOUNCE = 500;
  private static readonly MUTATION_THRESHOLD = 20;

  constructor(
    debounceMs: number,
    callback: HoverCallback,
    onStateChange: (state: HoverState) => void
  ) {
    this.debounceMs = debounceMs;
    this.callback = callback;
    this.onStateChange = onStateChange;
  }

  init(): void {
    document.addEventListener("mouseover", this.onMouseOver, { passive: true });
    document.addEventListener("mousemove", this.onMouseMove, { passive: true });
    document.addEventListener("mouseout", this.onMouseOut, { passive: true });
    document.addEventListener("keydown", this.onKeyDown, { passive: true });
    document.addEventListener("scroll", this.onScroll, { passive: true, capture: true });
    window.addEventListener("resize", this.onResize, { passive: true });

    this.observer = new MutationObserver(this.onMutation);
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  destroy(): void {
    document.removeEventListener("mouseover", this.onMouseOver);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("mouseout", this.onMouseOut);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("scroll", this.onScroll, { capture: true });
    window.removeEventListener("resize", this.onResize);
    this.clearTimer();

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.mutationTimer) {
      clearTimeout(this.mutationTimer);
      this.mutationTimer = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearTimer();
      this.setState("idle");
    }
  }

  setDebounceMs(ms: number): void {
    this.debounceMs = ms;
  }

  private onMouseOver = (e: MouseEvent): void => {
    if (!this.enabled) return;
    this.currentX = e.clientX;
    this.currentY = e.clientY;
    this.resetTimer();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled) return;
    this.currentX = e.clientX;
    this.currentY = e.clientY;
    this.resetTimer();
  };

  private onMouseOut = (): void => {
    this.clearTimer();
    if (this.state !== "idle") {
      this.setState("idle");
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.clearTimer();
      this.setState("idle");
    }
  };

  private onScroll = (): void => {
    this.clearTimer();
    this.setState("idle");
  };

  private onResize = (): void => {
    this.clearTimer();
    this.setState("idle");
  };

  private onMutation = (records: MutationRecord[]): void => {
    for (const record of records) {
      this.mutationCount += record.addedNodes.length + record.removedNodes.length;
    }

    if (this.mutationTimer) clearTimeout(this.mutationTimer);
    this.mutationTimer = setTimeout(() => {
      if (this.mutationCount > HoverDetector.MUTATION_THRESHOLD && this.state !== "idle") {
        this.setState("idle");
      }
      this.mutationCount = 0;
    }, HoverDetector.MUTATION_DEBOUNCE);
  };

  private resetTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.setState("hovering");
      this.callback(this.currentX, this.currentY);
    }, this.debounceMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setState(state: HoverState): void {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange(state);
    }
  }
}
