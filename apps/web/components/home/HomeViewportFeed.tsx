"use client";

import { useEffect, useRef } from "react";
import { Wordmark } from "@ninesixteen/brand";
import { viewportDemoStore } from "@/lib/viewport/viewportDemoStore";
import { HomeHeroStage } from "./HomeHeroStage";
import type { HomeView } from "./homeViews";

type HomeViewportFeedProps = {
  active: boolean;
  onNavigate: (view: HomeView) => void;
};

/**
 * Live background layer — mirrors the hero layout and pans with the demo crop
 * so the wallpaper matches what the viewport frame is capturing.
 */
export function HomeViewportFeed({ active, onNavigate }: HomeViewportFeedProps) {
  const feedRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<HTMLDivElement>(null);
  const lastTransformRef = useRef("");

  useEffect(() => {
    if (!active) return;
    const pan = panRef.current;
    const feed = feedRef.current;
    if (!pan || !feed) return;

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
        <div className="home-shell home-shell--feed-mirror">
          <h1 className="home-hero__title home-hero__title--hero" aria-hidden>
            <Wordmark size={160} showSuffix className="home-hero__wordmark" />
          </h1>
          <div className="home-stage">
            <HomeHeroStage onNavigate={onNavigate} mirror />
          </div>
        </div>
      </div>
    </div>
  );
}
