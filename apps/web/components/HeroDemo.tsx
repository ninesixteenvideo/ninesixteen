"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BASE_WIDTH_PCT = 34;
const ZOOM_MIN = 0.85;
const ZOOM_MAX = 2.2;
const PORTRAIT = 16 / 9; // height / width for 9×16

/**
 * Interactive preview of the desktop framing workflow: a 9×16 viewport on your
 * desktop, follows the cursor on hover and zooms with scroll.
 */
export function HeroDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1.12);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hovering, setHovering] = useState(false);

  const viewportSize = useCallback((stageW: number, stageH: number, z: number) => {
    const w = (stageW * BASE_WIDTH_PCT * z) / 100;
    const h = w * PORTRAIT;
    return { w, h };
  }, []);

  const clampPan = useCallback(
    (p: { x: number; y: number }, z: number, stageW: number, stageH: number) => {
      const { w: vpW, h: vpH } = viewportSize(stageW, stageH, z);
      const maxX = Math.max(0, (stageW - vpW) / 2);
      const maxY = Math.max(0, (stageH - vpH) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, p.x)),
        y: Math.max(-maxY, Math.min(maxY, p.y)),
      };
    },
    [viewportSize],
  );

  const panFromCursor = useCallback(
    (clientX: number, clientY: number, z: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const r = stage.getBoundingClientRect();
      const mx = clientX - r.left;
      const my = clientY - r.top;
      setPan(
        clampPan(
          { x: mx - r.width / 2, y: my - r.height / 2 },
          z,
          r.width,
          r.height,
        ),
      );
    },
    [clampPan],
  );

  const onStageMouseMove = (e: React.MouseEvent) => {
    panFromCursor(e.clientX, e.clientY, zoom);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setZoom((z) => {
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z - e.deltaY * 0.0018));
        panFromCursor(e.clientX, e.clientY, next);
        return next;
      });
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [panFromCursor]);

  const viewportWidthPct = BASE_WIDTH_PCT * zoom;

  return (
    <div className="w-full">
      <div className="mb-3 flex justify-end px-1">
        <span className="font-mono text-[11px] text-inkfaint">9×16 · portrait capture</span>
      </div>

      <div
        ref={stageRef}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onMouseMove={onStageMouseMove}
        className="relative aspect-[16/10] w-full cursor-crosshair select-none overflow-hidden rounded-[18px] border-2 border-ink shadow-[8px_8px_0_var(--color-shadow)]"
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

        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-md"
          style={{
            width: `${viewportWidthPct}%`,
            aspectRatio: "9 / 16",
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
            transition: hovering
              ? "width 280ms cubic-bezier(.22,1,.36,1), transform 70ms linear"
              : "width 280ms cubic-bezier(.22,1,.36,1), transform 280ms cubic-bezier(.22,1,.36,1)",
            boxShadow:
              "0 0 0 2px #fff, 0 0 0 4px var(--color-ink), 0 0 48px rgba(250,250,250,0.12)",
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
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1.5 rounded-full border border-white/30 bg-black/45 px-2 py-0.5 font-mono text-[9px] text-onaccent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ff4d4d]" /> REC
          </span>
        </div>
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
