"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Interactive preview of the desktop framing workflow: a 9×16 viewport on your
 * desktop, panned by cursor position and zoomed with Alt + scroll.
 */
export function HeroDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1.12);
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
    const vw = 0.34 / z;
    const vh = vw * (16 / 9);
    const maxX = (r.width * (1 - vw)) / 2;
    const maxY = (r.height * (1 - vh)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    };
  }, []);

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
      const next = Math.max(0.85, Math.min(2.2, z - e.deltaY * 0.0018));
      setPan((p) => clampPan(p, next));
      return next;
    });
  };

  const w = 34 * zoom;
  const h = w * (16 / 9);

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <span className="ns-chip bg-yellow/80 text-onbright">Live preview</span>
        <span className="font-mono text-[11px] text-inkfaint">9×16 · portrait capture</span>
      </div>

      <div
        ref={stageRef}
        onWheel={onWheel}
        className="relative aspect-[16/10] w-full select-none overflow-hidden rounded-[18px] border-2 border-ink shadow-[8px_8px_0_var(--color-shadow)]"
        style={{
          background:
            "radial-gradient(120% 120% at 20% 10%, #4c4a45 0%, #3a3833 45%, #2c2a27 100%)",
        }}
      >
        <MockDesktop />

        <div
          className="pointer-events-none absolute inset-0"
          style={{ boxShadow: "inset 0 0 0 2000px rgba(16,15,12,0.58)" }}
        />

        <button
          aria-label="Drag to move the framing viewport"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute left-1/2 top-1/2 cursor-grab touch-none rounded-md active:cursor-grabbing"
          style={{
            width: `${w}%`,
            height: `${h}%`,
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
            transition: drag.current.active ? "none" : "width 280ms cubic-bezier(.22,1,.36,1)",
            boxShadow:
              "0 0 0 2px #fff, 0 0 0 4px var(--color-ink), 0 0 48px rgba(231,216,182,0.12)",
            background: "transparent",
          }}
        >
          <RuleOfThirds />
          {["tl", "tr", "bl", "br"].map((c) => (
            <span
              key={c}
              className="absolute h-4 w-4"
              style={{
                borderTopWidth: c[0] === "t" ? 3 : 0,
                borderBottomWidth: c[0] === "b" ? 3 : 0,
                borderLeftWidth: c[1] === "l" ? 3 : 0,
                borderRightWidth: c[1] === "r" ? 3 : 0,
                borderStyle: "solid",
                borderColor: "#fff",
                top: c[0] === "t" ? -2 : "auto",
                bottom: c[0] === "b" ? -2 : "auto",
                left: c[1] === "l" ? -2 : "auto",
                right: c[1] === "r" ? -2 : "auto",
              }}
            />
          ))}
          <span className="absolute left-1.5 top-1.5 rounded bg-shadow/85 px-1.5 py-0.5 font-mono text-[10px] text-onaccent">
            9×16 · {Math.round(zoom * 100)}%
          </span>
          <span className="absolute bottom-1.5 right-1.5 rounded bg-pink/90 px-1.5 py-0.5 font-mono text-[9px] text-onaccent">
            5s countdown
          </span>
        </button>

        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-white/30 bg-black/45 px-2.5 py-1 font-mono text-[10px] text-onaccent">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff4d4d]" /> REC
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] text-inksoft">
        <span className="rounded-full border border-linesoft bg-surface px-2.5 py-1">move = frame</span>
        <span className="rounded-full border border-linesoft bg-surface px-2.5 py-1">scroll = zoom</span>
        <span className="rounded-full border-2 border-ink bg-yellow/70 px-2.5 py-1 text-onbright">Alt + scroll in app</span>
      </div>
    </div>
  );
}

function RuleOfThirds() {
  return (
    <div className="pointer-events-none absolute inset-0 opacity-35">
      <span className="absolute left-1/3 top-0 h-full w-px bg-white/70" />
      <span className="absolute left-2/3 top-0 h-full w-px bg-white/70" />
      <span className="absolute left-0 top-1/3 h-px w-full bg-white/70" />
      <span className="absolute left-0 top-2/3 h-px w-full bg-white/70" />
    </div>
  );
}

function MockDesktop() {
  return (
    <div className="absolute inset-0">
      <div className="absolute left-[8%] top-[14%] h-[58%] w-[55%] rounded-lg border border-white/10 bg-[#1f1d1a] shadow-2xl">
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
      <div className="absolute right-[10%] top-[22%] h-[34%] w-[24%] overflow-hidden rounded-full border-2 border-white/20 bg-gradient-to-br from-pink/60 to-blue/60" />
      <div className="absolute bottom-[10%] left-[22%] h-[26%] w-[40%] rounded-lg border border-white/10 bg-gradient-to-r from-[#2c2a26] to-[#1d1b18]" />
    </div>
  );
}
