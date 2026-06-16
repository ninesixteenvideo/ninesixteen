import { useEffect, useState } from "react";
import { isDesktop } from "./bridge";
import { DOCK, filmStripWidth, syncDockWindow } from "./windowDock";

/** Keeps the native window pinned to the left edge and sized to the dock + film strip. */
export function useDockLayout(opts: {
  ready: boolean;
  expanded: boolean;
  capturing: boolean;
  /** A take is selected — keep the window wide for slide animations. */
  filmOpen: boolean;
  /** The film strip is visually extended (player slid out). */
  filmVisible: boolean;
}) {
  const { ready, expanded, capturing, filmOpen, filmVisible } = opts;
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== "undefined" ? window.innerHeight : 900
  );

  useEffect(() => {
    if (!isDesktop) return;

    void (async () => {
      const { primaryMonitor } = await import("@tauri-apps/api/window");
      const mon = await primaryMonitor();
      const scale = mon?.scaleFactor ?? 1;
      const h = mon?.workArea?.size?.height ?? mon?.size?.height ?? window.innerHeight * scale;
      setViewportHeight(h / scale);
    })();
  }, [ready, expanded, filmOpen, filmVisible, capturing]);

  useEffect(() => {
    if (!ready || !isDesktop) return;
    void syncDockWindow({ expanded, filmExtended: filmOpen, hide: capturing });
  }, [ready, expanded, filmOpen, capturing]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--film-w",
      `${filmVisible ? filmStripWidth(viewportHeight) : 0}px`
    );
  }, [filmVisible, viewportHeight]);

  return { sidebarPx: expanded ? DOCK.EXPANDED : DOCK.RAIL };
}
