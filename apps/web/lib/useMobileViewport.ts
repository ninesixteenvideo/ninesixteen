"use client";

import { useSyncExternalStore } from "react";

/** Matches site-wide mobile breakpoint — viewport demo is desktop-only. */
export const MOBILE_VIEWPORT_MQL = "(max-width: 767px)";

function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(MOBILE_VIEWPORT_MQL);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getSnapshot() {
  return window.matchMedia(MOBILE_VIEWPORT_MQL).matches;
}

function getServerSnapshot() {
  return false;
}

export function useMobileViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
