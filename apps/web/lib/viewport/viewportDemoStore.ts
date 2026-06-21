import type { OverlayFrame } from "./types";

type Monitor = { w: number; h: number };

let frame: OverlayFrame = { x: 0, y: 0, w: 1, h: 1, zoom: 1.28 };
let monitor: Monitor = { w: 1, h: 1 };

/** Shared crop rect for overlay + background feed (no React re-renders per frame). */
export const viewportDemoStore = {
  setFrame(next: OverlayFrame, nextMonitor: Monitor) {
    frame = next;
    monitor = nextMonitor;
  },
  getFrame(): OverlayFrame {
    return frame;
  },
  getMonitor(): Monitor {
    return monitor;
  },
};
