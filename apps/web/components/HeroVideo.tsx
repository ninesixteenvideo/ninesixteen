"use client";

import { useEffect, useRef } from "react";

/**
 * Landing-page promo player. Houses promo.mp4 in the same hard-offset, curved
 * frame the desktop app uses for preview/library playback. Attempts to autoplay
 * with sound; browsers that block unmuted autoplay fall back to muted playback
 * so the clip still rolls, and the controls let the viewer unmute.
 */
export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    const play = async () => {
      try {
        video.muted = false;
        video.volume = 1;
        await video.play();
      } catch {
        if (cancelled) return;
        try {
          video.muted = true;
          await video.play();
        } catch {
          /* leave paused — the viewer can press play */
        }
      }
    };

    void play();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="ns-hero-video">
      <video
        ref={videoRef}
        src="/promo.mp4"
        autoPlay
        playsInline
        controls
        preload="auto"
      />
    </div>
  );
}
