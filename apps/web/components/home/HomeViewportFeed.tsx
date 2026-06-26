"use client";

import { useEffect, useRef } from "react";
import { viewportDemoStore } from "@/lib/viewport/viewportDemoStore";

/**
 * Panned atmospheric layer behind the hero — glow + vignette only (no duplicate wordmark).
 */
export function HomeViewportFeed({ active }: { active: boolean }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<HTMLDivElement>(null);
  const lastTransformRef = useRef("");

  useEffect(() => {
    if (!active) return;
    const pan = panRef.current;
    if (!pan) return;

    let raf = 0;
    const tick = () => {
      const f = viewportDemoStore.getFrame();
      const m = viewportDemoStore.getMonitor();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cover = Math.max(vw / Math.max(f.w, 1), vh / Math.max(f.h, 1));
      const scaledW = f.w * cover;
      const scaledH = f.h * cover;
      const offsetX = (vw - scaledW) / 2;
      const offsetY = (vh - scaledH) / 2;
      const transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${cover}) translate3d(${-f.x}px, ${-f.y}px, 0)`;

      if (transform !== lastTransformRef.current) {
        lastTransformRef.current = transform;
        pan.style.width = `${m.w}px`;
        pan.style.height = `${m.h}px`;
        pan.style.transform = transform;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;

  return (
    <div ref={feedRef} className="home-viewport-feed" aria-hidden>
      <div ref={panRef} className="home-viewport-feed__pan">
        <div className="home-viewport-feed__atmosphere">
          <div className="home-bg__glow home-bg__glow--mint" />
          <div className="home-bg__glow home-bg__glow--coral" />
          <div className="home-bg__vignette" />
        </div>
      </div>
    </div>
  );
}
