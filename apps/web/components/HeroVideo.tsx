"use client";

import { useEffect, useRef, useState } from "react";
import { SpeakerSimpleHigh, SpeakerSimpleSlash } from "@phosphor-icons/react";

/**
 * Landing-page promo player. Houses promo.mp4 (720×1280, exact 9:16) in the same
 * hard-offset, curved frame the desktop app uses for preview/library playback.
 *
 * Playback strategy:
 * - Autoplay MUTED on load — the only mode every browser allows unconditionally.
 *   We set `muted` via the DOM property (the React `muted` attribute is unreliable
 *   and otherwise lets Chrome treat it as a blocked unmuted autoplay).
 * - A subtle speaker glyph to the left of the frame toggles sound on/off.
 */
export function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.volume = 1;

    const tryPlay = () => {
      void video.play().catch(() => {});
    };
    tryPlay();
    video.addEventListener("canplay", tryPlay, { once: true });
    video.addEventListener("loadeddata", tryPlay, { once: true });

    const syncMuted = () => setMuted(video.muted);
    video.addEventListener("volumechange", syncMuted);

    return () => {
      video.removeEventListener("canplay", tryPlay);
      video.removeEventListener("loadeddata", tryPlay);
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
        autoPlay
        loop
        muted
        playsInline
        controls
        preload="auto"
      />
    </div>
  );
}
