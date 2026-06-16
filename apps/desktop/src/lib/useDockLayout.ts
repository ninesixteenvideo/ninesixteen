import { useEffect, useState } from "react";
import { isDesktop } from "./bridge";
import { DOCK, dockWidth, filmStripWidth, syncDockWindow, waitForDockWidth } from "./windowDock";

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
}) {
  const { ready, expanded, capturing, libraryTab, filmSelected, filmVisible } = opts;
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== "undefined" ? window.innerHeight : 900
  );

  // While the Library is open and expanded, keep the window wide enough for the
  // player *before* a take is selected — avoids a resize race on first click.
  const filmSpace =
    expanded && (libraryTab || filmSelected || filmVisible);

  useEffect(() => {
    if (!isDesktop) return;
    void (async () => {
      const { monitorWorkArea } = await import("./windowDock");
      const { height } = await monitorWorkArea();
      setViewportHeight(height);
    })();
  }, [ready, expanded, libraryTab, filmSelected, filmVisible, capturing]);

  useEffect(() => {
    if (!ready || !isDesktop) return;
    void (async () => {
      const targetW = await syncDockWindow({
        expanded,
        filmExtended: filmSpace,
        hide: capturing,
      });
      if (filmSpace) await waitForDockWidth(targetW);
    })();
  }, [ready, expanded, filmSpace, capturing]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-w",
      `${expanded ? DOCK.EXPANDED : DOCK.RAIL}px`
    );
    document.documentElement.style.setProperty(
      "--film-w",
      `${filmSpace ? filmStripWidth(viewportHeight) : 0}px`
    );
    document.documentElement.style.setProperty(
      "--dock-w",
      `${dockWidth({ expanded, filmExtended: filmSpace, viewportHeight })}px`
    );
  }, [filmSpace, viewportHeight, expanded]);

  return { sidebarPx: expanded ? DOCK.EXPANDED : DOCK.RAIL, viewportHeight };
}
