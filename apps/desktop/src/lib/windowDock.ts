import { invoke, isDesktop } from "./bridge";

/** Must stay in sync with styles.css sidebar widths. */
export const DOCK = {
  RAIL: 48,
  EXPANDED: 520,
  FILM_PAD_X: 76,
  FILM_PAD_Y: 64,
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
  if (!opts.filmExtended) return side;
  return side + filmStripWidth(opts.viewportHeight);
}

async function workAreaHeight(): Promise<number> {
  if (!isDesktop) return window.innerHeight;
  const { primaryMonitor } = await import("@tauri-apps/api/window");
  const mon = await primaryMonitor();
  const scale = mon?.scaleFactor ?? 1;
  const h = mon?.workArea?.size?.height ?? mon?.size?.height ?? window.innerHeight * scale;
  return h / scale;
}

export async function syncDockWindow(opts: {
  expanded: boolean;
  filmExtended: boolean;
  hide?: boolean;
}) {
  if (!isDesktop) return;

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();

  if (opts.hide) {
    await win.hide();
    return;
  }

  await win.show();
  const height = await workAreaHeight();
  const width = dockWidth({
    expanded: opts.expanded,
    filmExtended: opts.filmExtended,
    viewportHeight: height,
  });
  await invoke("sync_dock_window", { width });
}
