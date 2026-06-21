"use client";

import { useCallback, useRef, useState } from "react";
import type { HomeView } from "./homeViews";

const GLITCH_MS = 420;

export function useGlitchTransition(initial: HomeView = "hero") {
  const [view, setView] = useState<HomeView>(initial);
  const [phase, setPhase] = useState<"idle" | "active">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const transitionTo = useCallback((next: HomeView) => {
    if (next === view) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    setPhase("active");

    timerRef.current = setTimeout(() => {
      setView(next);
      timerRef.current = setTimeout(() => {
        setPhase("idle");
        timerRef.current = null;
      }, GLITCH_MS);
    }, GLITCH_MS);
  }, [view]);

  return {
    view,
    setView,
    phase,
    transitionTo,
    glitching: phase === "active",
  };
}
