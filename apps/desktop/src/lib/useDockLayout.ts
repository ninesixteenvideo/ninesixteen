import { useEffect, useState } from "react";
import { isDesktop } from "./bridge";
import type { Orientation } from "./types";
import {
  DOCK,
  SIDEBAR_COLLAPSE_MS,
  dockWidth,
  filmStripWidth,
  syncDockWindow,
  waitForDockWidth,
} from "./windowDock";

/** Keeps the native window pinned to the left edge and sized to the dock + film strip. */
export function useDockLayout(opts: {
  ready: boolean;
  expanded: boolean;
  capturing: boolean;
  /** User is on the Library tab — reserve film-strip width while expanded. */
  libraryTab: boolean;
  /** A take is selected. */
  filmSelected: boolean;
  /** The film strip is visually extended (player slid out). */
  filmVisible: boolean;
  /** Aspect of the selected take, or the Studio format when browsing the library. */
  filmOrientation: Orientation;
}) {
  const { ready, expanded, capturing, libraryTab, filmSelected, filmVisible, filmOrientation } =
    opts;
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== "undefined" ? window.innerHeight : 900
  );

  /**
   * Lags `expanded` on collapse so the native window and film strip stay wide
   * while the sidebar CSS width transition runs. Updates immediately on expand.
   */
  const [layoutExpanded, setLayoutExpanded] = useState(expanded);

  useEffect(() => {
    if (expanded) {
      setLayoutExpanded(true);
      return;
    }
    const t = window.setTimeout(() => setLayoutExpanded(false), SIDEBAR_COLLAPSE_MS);
    return () => window.clearTimeout(t);
  }, [expanded]);

  const filmSpace =
    layoutExpanded && (libraryTab || filmSelected || filmVisible);

  useEffect(() => {
    if (!isDesktop) return;
    void (async () => {
      const { monitorWorkArea } = await import("./windowDock");
      const { height } = await monitorWorkArea();
      setViewportHeight(height);
    })();
  }, [ready, layoutExpanded, libraryTab, filmSelected, filmVisible, capturing, filmOrientation]);

  useEffect(() => {
    if (!ready || !isDesktop) return;
    void (async () => {
      const targetW = await syncDockWindow({
        expanded: layoutExpanded,
        filmExtended: filmSpace,
        hide: capturing,
        filmOrientation,
      });
      if (filmSpace) await waitForDockWidth(targetW);
    })();
  }, [ready, layoutExpanded, filmSpace, capturing, filmOrientation, viewportHeight]);

  // Track the sidebar's animated width so the film strip stays glued to its edge.
  useEffect(() => {
    if (!ready) return;
    const el = document.querySelector(".sidebar");
    if (!el) return;

    const syncSidebarWidth = (width: number) => {
      if (width > 0) {
        document.documentElement.style.setProperty("--sidebar-w", `${Math.round(width)}px`);
      }
    };

    syncSidebarWidth(el.getBoundingClientRect().width);

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) syncSidebarWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--film-w",
      `${filmSpace ? filmStripWidth(viewportHeight, filmOrientation) : 0}px`
    );
    document.documentElement.style.setProperty(
      "--film-aspect",
      filmOrientation === "landscape" ? "landscape" : "portrait"
    );
    document.documentElement.style.setProperty(
      "--dock-w",
      `${dockWidth({
        expanded: layoutExpanded,
        filmExtended: filmSpace,
        viewportHeight,
        filmOrientation,
      })}px`
    );
  }, [filmSpace, viewportHeight, layoutExpanded, filmOrientation]);

  return { sidebarPx: expanded ? DOCK.EXPANDED : DOCK.RAIL, viewportHeight };
}
