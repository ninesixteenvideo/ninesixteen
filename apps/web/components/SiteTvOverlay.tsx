"use client";

import { useEffect, useRef, useState } from "react";

const STATIC_FPS = 8;
const NOISE_SCALE = 0.2;
const ALPHA_BASE = 12;
const ALPHA_RANGE = 22;
const BURST_ALPHA_BASE = 28;
const BURST_ALPHA_RANGE = 70;
const BURST_MIN_DELAY_MS = 3800;
const BURST_MAX_DELAY_MS = 9000;
const BURST_DOUBLE_CHANCE = 0.25;

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/** Site-wide TV snow, scanlines, and random bursts (synced to wordmarks via body class). */
export function SiteTvOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const burstRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [burstOn, setBurstOn] = useState(false);

  burstRef.current = burstOn;

  useEffect(() => {
    document.body.classList.toggle("site-tv-burst", burstOn);
    return () => document.body.classList.remove("site-tv-burst");
  }, [burstOn]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    const resize = () => {
      canvas.width = Math.max(1, Math.floor(window.innerWidth * NOISE_SCALE));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * NOISE_SCALE));
    };

    resize();
    window.addEventListener("resize", resize);

    let lastFrame = 0;

    const draw = (time: number) => {
      const burst = burstRef.current;
      const interval = burst ? 0 : 1000 / STATIC_FPS;

      if (time - lastFrame >= interval) {
        lastFrame = time;
        const targetW = Math.max(1, Math.floor(window.innerWidth * NOISE_SCALE));
        const targetH = Math.max(1, Math.floor(window.innerHeight * NOISE_SCALE));
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
        const { width, height } = canvas;

        if (width && height) {
          const frame = ctx.createImageData(width, height);
          const data = frame.data;

          for (let i = 0; i < data.length; i += 4) {
            const v = Math.random() * 255;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = burst
              ? BURST_ALPHA_BASE + Math.random() * BURST_ALPHA_RANGE
              : ALPHA_BASE + Math.random() * ALPHA_RANGE;
          }

          ctx.putImageData(frame, 0, 0);
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) return;

    const clearTimers = () => {
      for (const id of timersRef.current) clearTimeout(id);
      timersRef.current = [];
    };

    const pushTimer = (fn: () => void, ms: number) => {
      timersRef.current.push(setTimeout(fn, ms));
    };

    const burst = () => {
      setBurstOn(true);
      pushTimer(() => setBurstOn(false), randomBetween(160, 480));
    };

    const schedule = () => {
      pushTimer(() => {
        burst();
        if (Math.random() < BURST_DOUBLE_CHANCE) {
          pushTimer(burst, randomBetween(80, 180));
        }
        schedule();
      }, randomBetween(BURST_MIN_DELAY_MS, BURST_MAX_DELAY_MS));
    };

    pushTimer(schedule, randomBetween(2400, 4500));

    return clearTimers;
  }, []);

  return (
    <div className={`site-tv${burstOn ? " site-tv--burst" : ""}`} aria-hidden>
      <canvas ref={canvasRef} className="site-tv__snow" />
      <div className="site-tv__scan" />
      <div className="site-tv__hum" />
      <div className="site-tv__roll" />
    </div>
  );
}
