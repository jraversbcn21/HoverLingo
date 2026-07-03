let overlays: HTMLDivElement[] = [];

export const wordHighlight = {
  show(range: Range): void {
    this.hide();

    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const div = document.createElement("div");
      div.style.cssText = `
        position: fixed;
        left: ${r.left - 2}px;
        top: ${r.top - 1}px;
        width: ${r.width + 4}px;
        height: ${r.height + 2}px;
        background: rgba(255, 230, 50, 0.35);
        border-radius: 2px;
        pointer-events: none;
        z-index: 2147483646;
      `;
      document.body.appendChild(div);
      overlays.push(div);
    }
  },

  hide(): void {
    for (const div of overlays) {
      div.remove();
    }
    overlays = [];
  },
};
