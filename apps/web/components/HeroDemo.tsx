"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Orientation = "landscape" | "portrait";

/**
 * A live, in-browser miniature of the ninesixteen framing viewport.
 * Drag to pan, scroll to zoom, press the button (or R) to rotate orientation.
 * This mirrors exactly what the second-mouse does in the desktop app.
 */
export function HeroDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ active: boolean; sx: number; sy: number; px: number; py: number }>({
    active: false,
    sx: 0,
    sy: 0,
    px: 0,
    py: 0,
  });

  const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
    const stage = stageRef.current;
    if (!stage) return p;
    const r = stage.getBoundingClientRect();
    // viewport size as fraction of stage
    const isLand = orientation === "landscape";
    const vw = (isLand ? 0.52 : 0.3) / z;
    const vh = (isLand ? 0.52 * (9 / 16) : 0.3 * (16 / 9)) / z;
    const maxX = (r.width * (1 - vw)) / 2;
    const maxY = (r.height * (1 - vh)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    };
  }, [orientation]);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { active: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const nx = drag.current.px + (e.clientX - drag.current.sx);
    const ny = drag.current.py + (e.clientY - drag.current.sy);
    setPan(clampPan({ x: nx, y: ny }, zoom));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current.active = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => {
      const next = Math.max(1, Math.min(2.6, z - e.deltaY * 0.0015));
      setPan((p) => clampPan(p, next));
      return next;
    });
  };

  const rotate = useCallback(() => {
    setOrientation((o) => (o === "landscape" ? "portrait" : "landscape"));
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "r") rotate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rotate]);

  const isLand = orientation === "landscape";
  const baseW = isLand ? 52 : 30; // % of stage width
  const w = baseW * zoom;
  const h = isLand ? w * (9 / 16) : w * (16 / 9);

  return (
    <div className="w-full">
      <div
        ref={stageRef}
        onWheel={onWheel}
        className="relative aspect-[16/10] w-full select-none overflow-hidden rounded-[18px] border-2 border-ink shadow-[6px_6px_0_var(--color-ink)]"
        style={{
          background:
            "radial-gradient(120% 120% at 20% 10%, #565660 0%, #42424a 45%, #323238 100%)",
        }}
      >
        {/* Mock desktop content behind the frame */}
        <MockDesktop />

        {/* Dim everything outside the viewport */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: "inset 0 0 0 2000px rgba(18,15,34,0.55)" }}
        />

        {/* The framing viewport */}
        <button
          aria-label="Drag to pan the framing viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute left-1/2 top-1/2 cursor-grab touch-none rounded-md active:cursor-grabbing"
          style={{
            width: `${w}%`,
            height: `${h}%`,
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
            transition: drag.current.active
              ? "none"
              : "width 320ms cubic-bezier(.22,1,.36,1), height 320ms cubic-bezier(.22,1,.36,1)",
            boxShadow:
              "0 0 0 2px #fff, 0 0 0 4px var(--color-ink), 0 0 40px rgba(110, 110, 120, 0.16)",
            background: "transparent",
            // punch a clear hole through the dim layer
            mixBlendMode: "normal",
          }}
        >
          {/* clear window: re-show desktop brightness inside frame */}
          <span
            className="absolute inset-0 rounded-[4px]"
            style={{ boxShadow: "0 0 0 2000px rgba(18,15,34,0)" }}
          />
          {/* corner crop marks */}
          {["tl", "tr", "bl", "br"].map((c) => (
            <span
              key={c}
              className="absolute h-4 w-4 border-blue"
              style={{
                borderTopWidth: c[0] === "t" ? 3 : 0,
                borderBottomWidth: c[0] === "b" ? 3 : 0,
                borderLeftWidth: c[1] === "l" ? 3 : 0,
                borderRightWidth: c[1] === "r" ? 3 : 0,
                top: c[0] === "t" ? -2 : "auto",
                bottom: c[0] === "b" ? -2 : "auto",
                left: c[1] === "l" ? -2 : "auto",
                right: c[1] === "r" ? -2 : "auto",
                borderColor: "#fff",
              }}
            />
          ))}
          <span className="absolute left-1.5 top-1.5 rounded bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] text-white">
            {isLand ? "16×9" : "9×16"} · {Math.round(zoom * 100)}%
          </span>
        </button>

        {/* REC badge */}
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-white/30 bg-black/40 px-2.5 py-1 font-mono text-[10px] text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff4d4d]" /> REC
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 font-mono text-xs text-inksoft">
        <span className="rounded-full border border-linesoft bg-surface px-2.5 py-1">drag = pan</span>
        <span className="rounded-full border border-linesoft bg-surface px-2.5 py-1">scroll = zoom</span>
        <button
          onClick={rotate}
          className="rounded-full border-2 border-ink bg-pink px-3 py-1 font-display shadow-[2px_2px_0_var(--color-ink)] transition-transform hover:-translate-y-0.5"
        >
          press R = rotate ↻
        </button>
      </div>
    </div>
  );
}

function MockDesktop() {
  return (
    <div className="absolute inset-0">
      {/* fake editor window */}
      <div className="absolute left-[8%] top-[14%] h-[58%] w-[55%] rounded-lg border border-white/10 bg-[#191527] shadow-2xl">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="space-y-2 p-4">
          {[80, 55, 70, 40, 62, 48].map((w, i) => (
            <div key={i} className="flex gap-2">
              <span className="h-2 w-6 rounded bg-blue/50" />
              <span className="h-2 rounded bg-white/15" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      </div>
      {/* fake browser / webcam bubble */}
      <div className="absolute right-[10%] top-[22%] h-[34%] w-[24%] overflow-hidden rounded-full border-2 border-white/20 bg-gradient-to-br from-pink/60 to-blue/60" />
      <div className="absolute bottom-[10%] left-[22%] h-[26%] w-[40%] rounded-lg border border-white/10 bg-gradient-to-r from-[#2a2440] to-[#1d1933]" />
    </div>
  );
}
