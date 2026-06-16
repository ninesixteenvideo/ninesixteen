"use client";

import { useEffect, useRef, useState } from "react";
import { SpeakerSimpleHigh, SpeakerSimpleSlash } from "@phosphor-icons/react";

/**
 * Landing-page promo player. Houses promo.mp4 (720×1280, exact 9:16) in the same
 * hard-offset, curved frame the desktop app uses for preview/library playback.
 *
 * Paused on the first frame by default — user hits play via native controls (or
 * unmute, which also starts playback). `muted` is set via the DOM property because
 * the React `muted` attribute is unreliable.
 */
export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.volume = 1;

    const pauseOnFirstFrame = () => {
      video.currentTime = 0;
      video.pause();
    };
    pauseOnFirstFrame();
    video.addEventListener("loadeddata", pauseOnFirstFrame, { once: true });

    const syncMuted = () => setMuted(video.muted);
    video.addEventListener("volumechange", syncMuted);

    return () => {
      video.removeEventListener("loadeddata", pauseOnFirstFrame);
      video.removeEventListener("volumechange", syncMuted);
    };
  }, []);

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = !video.muted;
    video.muted = next;
    if (!next) video.volume = 1;
    setMuted(next);
    void video.play().catch(() => {});
  };

  return (
    <div className="ns-hero-video">
      <button
        type="button"
        onClick={toggleSound}
        className="ns-hero-video__sound"
        aria-label={muted ? "Unmute video" : "Mute video"}
      >
        {muted ? (
          <SpeakerSimpleSlash size={30} weight="bold" aria-hidden />
        ) : (
          <SpeakerSimpleHigh size={30} weight="bold" aria-hidden />
        )}
      </button>
      <video
        ref={videoRef}
        src="/promo.mp4"
        loop
        muted
        playsInline
        controls
        preload="auto"
      />
    </div>
  );
}
