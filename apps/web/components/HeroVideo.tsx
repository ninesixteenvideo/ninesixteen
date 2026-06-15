"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Landing-page promo player. Houses promo.mp4 (720×1280, exact 9:16) in the same
 * hard-offset, curved frame the desktop app uses for preview/library playback.
 *
 * Browsers forbid unmuted autoplay on first visit, so we autoplay MUTED (which is
 * always allowed) and show a one-tap "Tap for sound" badge. The first click
 * unmutes and the badge disappears.
 */
export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    void video.play().catch(() => {});
  }, []);

  const enableSound = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = 1;
    setMuted(false);
    void video.play().catch(() => {});
  };

  return (
    <div className="ns-hero-video">
      <video
        ref={videoRef}
        src="/promo.mp4"
        autoPlay
        loop
        muted
        playsInline
        controls
        preload="auto"
      />
      {muted && (
        <button type="button" className="ns-hero-video__unmute" onClick={enableSound}>
          <span aria-hidden>🔊</span> Tap for sound
        </button>
      )}
    </div>
  );
}
