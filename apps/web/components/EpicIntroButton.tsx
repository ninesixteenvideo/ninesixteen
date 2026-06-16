"use client";

import { useRef } from "react";
import { confettiBurst } from "@/lib/confettiBurst";

export function EpicIntroButton() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  function playIntro() {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      void audio.play().catch(() => {});
    }

    const btn = buttonRef.current;
    if (btn) {
      const rect = btn.getBoundingClientRect();
      confettiBurst({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    }
  }

  return (
    <>
      <audio ref={audioRef} src="/epic-intro.mp3" preload="auto" />
      <button
        ref={buttonRef}
        type="button"
        onClick={playIntro}
        className="ns-cta ns-cta--sm ns-cta--ghost"
      >
        epic intro
      </button>
    </>
  );
}
