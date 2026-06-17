import { isDesktop } from "./bridge";
import type { Orientation } from "./types";

/** Must stay in sync with styles.css sidebar widths and .handle overhang. */
export const DOCK = {
  RAIL: 48,
  EXPANDED: 520,
  HANDLE: 15,
  FILM_PAD_X: 100,
  FILM_PAD_Y: 128,
} as const;

/** Match .sidebar.collapsed width transition (0.06s delay + 0.42s duration). */
export const SIDEBAR_COLLAPSE_MS = 480;

/** Landscape library player width — kept compact so the dock window does not overflow. */
export const LANDSCAPE_FILM_MAX_W = 360;

export function sidebarWidth(expanded: boolean) {
  return expanded ? DOCK.EXPANDED : DOCK.RAIL;
}

export function filmPlayerWidth(viewportHeight: number, orientation: Orientation = "portrait") {
  const innerH = Math.max(320, viewportHeight - DOCK.FILM_PAD_Y);
  if (orientation === "landscape") {
    return LANDSCAPE_FILM_MAX_W;
  }
  return Math.ceil((innerH * 9) / 16);
}

export function filmStripWidth(viewportHeight: number, orientation: Orientation = "portrait") {
  return filmPlayerWidth(viewportHeight, orientation) + DOCK.FILM_PAD_X;
}

export function dockWidth(opts: {
  expanded: boolean;
  filmExtended: boolean;
  viewportHeight: number;
  filmOrientation?: Orientation;
}) {
  const side = sidebarWidth(opts.expanded);
  const handle = DOCK.HANDLE;
  const orientation = opts.filmOrientation ?? "portrait";
  if (!opts.filmExtended) return side + handle;
  return side + filmStripWidth(opts.viewportHeight, orientation) + handle;
}

export async function monitorWorkArea(): Promise<{
  height: number;
  x: number;
  y: number;
  scale: number;
}> {
  if (!isDesktop) {
    return { height: window.innerHeight, x: 0, y: 0, scale: 1 };
  }
  const { primaryMonitor } = await import("@tauri-apps/api/window");
  const mon = await primaryMonitor();
  const scale = mon?.scaleFactor ?? 1;
  const area = mon?.workArea;
  const height =
    (area?.size.height ?? mon?.size.height ?? window.innerHeight * scale) / scale;
  const x = (area?.position.x ?? 0) / scale;
  const y = (area?.position.y ?? 0) / scale;
  return { height, x, y, scale };
}

/**
 * Resize and pin the dock window. Returns the target width in logical px.
 * Uses the Tauri window API directly (needs core:window allow-set-* permissions).
 */
export async function syncDockWindow(opts: {
  expanded: boolean;
  filmExtended: boolean;
  hide?: boolean;
  filmOrientation?: Orientation;
}): Promise<number> {
  if (!isDesktop) return window.innerWidth;

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
  const win = getCurrentWindow();
  const orientation = opts.filmOrientation ?? "portrait";

  if (opts.hide) {
    await win.hide();
    return dockWidth({
      expanded: opts.expanded,
      filmExtended: false,
      viewportHeight: window.innerHeight,
      filmOrientation: orientation,
    });
  }

  await win.show();
  const { height, x, y } = await monitorWorkArea();
  const width = dockWidth({
    expanded: opts.expanded,
    filmExtended: opts.filmExtended,
    viewportHeight: height,
    filmOrientation: orientation,
  });

  await win.setResizable(true);
  await win.setSize(new LogicalSize(width, height));
  await win.setPosition(new LogicalPosition(x, y));

  return width;
}

/** Block until the webview inner width can fit the film strip (or timeout). */
export async function waitForDockWidth(targetWidth: number, timeoutMs = 1200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (window.innerWidth < targetWidth - 4 && Date.now() < deadline) {
    await new Promise((r) => window.setTimeout(r, 16));
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}
