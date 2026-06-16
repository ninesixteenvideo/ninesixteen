import { useEffect, useRef } from "react";
import { invoke, listen } from "../lib/bridge";
import { cropRect, zoomLabel } from "../lib/geometry";
import type { CaptureState, OverlayFrame, Viewport } from "../lib/types";

/**
 * The on-desktop overlay. A transparent, click-through, always-on-top window
 * that draws the exact 9×16 region being recorded directly over the real
 * desktop. Crop rect comes from Rust (`overlay:frame`) so it always matches
 * the recorder — including Alt+scroll zoom through letterbox transitions.
 */
export function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const monitor = useRef({ w: 1920, h: 1080 });
  const shortEdge = useRef(1080);
  const frame = useRef<OverlayFrame>({ x: 0, y: 0, w: 607, h: 1080, zoom: 1 });
  const recording = useRef(false);
  const arming = useRef(false);
  const countdown = useRef(0);
  const recordingStartedAt = useRef<number | null>(null);
  const captureCursor = useRef(true);
  const frameFrozen = useRef(false);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    (async () => {
      try {
        const st = await invoke<CaptureState>("get_state");
        if (st.monitor) monitor.current = { w: st.monitor.width, h: st.monitor.height };
        shortEdge.current = st.outputWidth <= 720 ? 720 : 1080;
        if (st.overlayFrame) frame.current = st.overlayFrame;
        recording.current = st.recording;
        arming.current = st.recordingArmed ?? false;
        countdown.current = st.countdownSeconds ?? 0;
        captureCursor.current = st.captureCursor ?? true;
        frameFrozen.current = st.frameFrozen ?? false;
      } catch {
        /* mock / not ready */
      }
      unsubs.push(
        await listen("overlay:cursor-capture", (on: boolean) => {
          captureCursor.current = on;
        }),
      );
      unsubs.push(
        await listen("overlay:frame", (p: OverlayFrame) => {
          frame.current = p;
        }),
      );
      unsubs.push(
        await listen("viewport:update", (vp: Viewport) => {
          if (
            typeof vp?.x !== "number" ||
            typeof vp?.y !== "number" ||
            typeof vp?.zoom !== "number"
          ) {
            return;
          }
          const m = monitor.current;
          if (m.w <= 0 || m.h <= 0) return;
          const crop = cropRect(vp, m.w, m.h, shortEdge.current);
          frame.current = { x: crop.x, y: crop.y, w: crop.w, h: crop.h, zoom: vp.zoom };
        }),
      );
      unsubs.push(
        await listen("frame:freeze", (p: { frozen: boolean }) => {
          frameFrozen.current = p.frozen;
        }),
      );
      unsubs.push(
        await listen("recording:state", (p: { recording: boolean; arming?: boolean }) => {
          recording.current = p.recording;
          if (p.arming !== undefined) {
            arming.current = p.arming;
          }
          if (p.recording) {
            countdown.current = 0;
            recordingStartedAt.current = performance.now();
          } else {
            recordingStartedAt.current = null;
          }
        }),
      );
      unsubs.push(
        await listen("recording:countdown", (p: { seconds: number }) => {
          countdown.current = p.seconds;
          arming.current = p.seconds > 0;
          if (p.seconds === 0) {
            arming.current = false;
          }
        }),
      );
    })();
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    let raf = 0;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = window.innerWidth;
      const ch = window.innerHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const scale = canvas.width / monitor.current.w;
      const f = frame.current;
      const rx = f.x * scale;
      const ry = f.y * scale;
      const rw = f.w * scale;
      const rh = f.h * scale;

      ctx.fillStyle = "rgba(10,10,16,0.34)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.clearRect(rx, ry, rw, rh);

      const accent = "#8f5e55";

      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = "#ffffff";
      ctx.shadowColor = accent;
      ctx.shadowBlur = 22 * dpr;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1 * dpr;
      ctx.strokeStyle = "rgba(10,10,16,0.9)";
      ctx.strokeRect(rx - 2 * dpr, ry - 2 * dpr, rw + 4 * dpr, rh + 4 * dpr);

      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1 * dpr;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(rx + (rw * i) / 3, ry);
        ctx.lineTo(rx + (rw * i) / 3, ry + rh);
        ctx.moveTo(rx, ry + (rh * i) / 3);
        ctx.lineTo(rx + rw, ry + (rh * i) / 3);
        ctx.stroke();
      }

      ctx.strokeStyle = accent;
      ctx.lineWidth = 4 * dpr;
      const L = 22 * dpr;
      tick(ctx, rx, ry, L, 1, 1);
      tick(ctx, rx + rw, ry, L, -1, 1);
      tick(ctx, rx, ry + rh, L, 1, -1);
      tick(ctx, rx + rw, ry + rh, L, -1, -1);

      const label = `9×16 · ${zoomLabel(f.zoom)}`;
      ctx.font = `${13 * dpr}px "IBM Plex Mono", monospace`;
      const padX = 8 * dpr;
      const tw = ctx.measureText(label).width;
      let chipW = tw + padX * 2;
      const chipH = 22 * dpr;
      const chipX = rx + 6 * dpr;
      const chipY = ry + 6 * dpr;
      const recW = recording.current ? 64 * dpr : 0;
      chipW += recW;

      ctx.fillStyle = "rgba(10,10,16,0.78)";
      roundRect(ctx, chipX, chipY, chipW, chipH, 6 * dpr);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, chipX + padX, chipY + chipH / 2);

      if (recording.current) {
        const dotX = chipX + padX + tw + 14 * dpr;
        const cy = chipY + chipH / 2;
        ctx.fillStyle = "#ff4d4d";
        ctx.beginPath();
        ctx.arc(dotX, cy, 4 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffd0d0";
        const secs =
          recordingStartedAt.current !== null
            ? (performance.now() - recordingStartedAt.current) / 1000
            : 0;
        ctx.fillText(fmt(secs), dotX + 9 * dpr, cy);
      }

      if (!captureCursor.current) {
        const text = "cursor hidden";
        ctx.font = `${12 * dpr}px "IBM Plex Mono", monospace`;
        const cpadX = 7 * dpr;
        const ctw = ctx.measureText(text).width;
        const cChipW = ctw + cpadX * 2;
        const cChipH = 20 * dpr;
        const cChipX = rx + rw - cChipW - 6 * dpr;
        const cChipY = ry + 6 * dpr;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        roundRect(ctx, cChipX, cChipY, cChipW, cChipH, 6 * dpr);
        ctx.fill();
        ctx.fillStyle = "#000000";
        ctx.textBaseline = "middle";
        ctx.fillText(text, cChipX + cpadX, cChipY + cChipH / 2);
      }

      if (frameFrozen.current && (recording.current || arming.current)) {
        const text = "frame frozen";
        ctx.font = `${12 * dpr}px "IBM Plex Mono", monospace`;
        const fpadX = 7 * dpr;
        const ftw = ctx.measureText(text).width;
        const fChipW = ftw + fpadX * 2;
        const fChipH = 20 * dpr;
        const fChipX = rx + rw - fChipW - 6 * dpr;
        const fChipY = ry + (captureCursor.current ? 6 : 30) * dpr;
        ctx.fillStyle = "rgba(120, 255, 212, 0.92)";
        roundRect(ctx, fChipX, fChipY, fChipW, fChipH, 6 * dpr);
        ctx.fill();
        ctx.fillStyle = "#1b1a18";
        ctx.textBaseline = "middle";
        ctx.fillText(text, fChipX + fpadX, fChipY + fChipH / 2);
      }

      const cd = countdown.current;
      if (cd > 0 && (arming.current || !recording.current)) {
        drawCountdown(ctx, cd, rx + rw / 2, ry + rh / 2, Math.min(rw, rh), dpr);
      }
    };

    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} style={{ display: "block", width: "100vw", height: "100vh" }} />;
}

// Brand palette, cycled per digit counting down from 5:
// 5 coral, 4 mint, 3 white, 2 coral, 1 mint …
const COUNTDOWN_COLORS = ["#FF6B58", "#78FFD4", "#FFFFFF"];
const COUNTDOWN_BORDER = "#1B1A18";

function drawCountdown(
  ctx: CanvasRenderingContext2D,
  seconds: number,
  cx: number,
  cy: number,
  frameShortEdge: number,
  dpr: number,
) {
  const text = String(seconds);
  // Slightly smaller than before (0.30 vs 0.36 of the frame's short edge).
  const fontSize = Math.max(32 * dpr, frameShortEdge * 0.3);
  // Medium-thickness charcoal border that scales with the glyph.
  const lineWidth = Math.max(3 * dpr, fontSize * 0.08);
  const fill = COUNTDOWN_COLORS[(5 - seconds) % COUNTDOWN_COLORS.length];

  ctx.font = `700 ${fontSize}px "Inter", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  // Soft drop shadow so the number reads on any desktop content behind it.
  ctx.shadowColor = "rgba(10, 10, 16, 0.45)";
  ctx.shadowBlur = fontSize * 0.06;
  ctx.shadowOffsetY = 2 * dpr;

  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = COUNTDOWN_BORDER;
  ctx.strokeText(text, cx, cy);

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = fill;
  ctx.fillText(text, cx, cy);

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function tick(ctx: CanvasRenderingContext2D, x: number, y: number, L: number, sx: number, sy: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + sy * L);
  ctx.lineTo(x, y);
  ctx.lineTo(x + sx * L, y);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
