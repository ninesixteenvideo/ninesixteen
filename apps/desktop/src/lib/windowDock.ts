import { isDesktop } from "./bridge";

/** Must stay in sync with styles.css sidebar widths and .handle overhang. */
export const DOCK = {
  RAIL: 48,
  EXPANDED: 520,
  HANDLE: 15,
  FILM_PAD_X: 100,
  FILM_PAD_Y: 128,
} as const;

export function sidebarWidth(expanded: boolean) {
  return expanded ? DOCK.EXPANDED : DOCK.RAIL;
}

export function filmPlayerWidth(viewportHeight: number) {
  const innerH = Math.max(320, viewportHeight - DOCK.FILM_PAD_Y);
  return Math.ceil((innerH * 9) / 16);
}

export function filmStripWidth(viewportHeight: number) {
  return filmPlayerWidth(viewportHeight) + DOCK.FILM_PAD_X;
}

export function dockWidth(opts: {
  expanded: boolean;
  filmExtended: boolean;
  viewportHeight: number;
}) {
  const side = sidebarWidth(opts.expanded);
  const handle = DOCK.HANDLE;
  if (!opts.filmExtended) return side + handle;
  return side + filmStripWidth(opts.viewportHeight) + handle;
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
}): Promise<number> {
  if (!isDesktop) return window.innerWidth;

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
  const win = getCurrentWindow();

  if (opts.hide) {
    await win.hide();
    return dockWidth({ expanded: opts.expanded, filmExtended: false, viewportHeight: window.innerHeight });
  }

  await win.show();
  const { height, x, y } = await monitorWorkArea();
  const width = dockWidth({
    expanded: opts.expanded,
    filmExtended: opts.filmExtended,
    viewportHeight: height,
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
