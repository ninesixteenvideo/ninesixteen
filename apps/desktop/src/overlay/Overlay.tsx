import { useEffect, useRef } from "react";
import { invoke, listen } from "../lib/bridge";
import { cropRect, formatLabel, qualityFromOutputDims, zoomLabel } from "../lib/geometry";
import type { CaptureState, Orientation, OverlayFrame, Viewport } from "../lib/types";

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
  const orientation = useRef<Orientation>("portrait");
  const recording = useRef(false);
  const arming = useRef(false);
  const countdown = useRef(0);
  const recordingStartedAt = useRef<number | null>(null);
  const captureCursor = useRef(true);
  const cinematicCursor = useRef(true);
  const cursorImg = useRef<HTMLImageElement | null>(null);
  const cursorMeta = useRef({ width: 256, height: 256, hotspotX: 0, hotspotY: 0 });
  const frameFrozen = useRef(false);
  const prevCountdown = useRef(0);
  const countdownChangedAt = useRef(0);
  const promoMode = useRef<"portrait" | "landscape" | null>(null);
  const promoInnerActive = useRef(false);

  useEffect(() => {
    let unsubs: Array<() => void> = [];
    (async () => {
      try {
        const st = await invoke<CaptureState>("get_state");
        if (st.monitor) monitor.current = { w: st.monitor.width, h: st.monitor.height };
        shortEdge.current = qualityFromOutputDims(st.outputWidth, st.outputHeight);
        if (st.overlayFrame) frame.current = st.overlayFrame;
        orientation.current = st.viewport?.orientation ?? "portrait";
        recording.current = st.recording;
        arming.current = st.recordingArmed ?? false;
        countdown.current = st.countdownSeconds ?? 0;
        captureCursor.current = st.captureCursor ?? true;
        cinematicCursor.current = st.cinematicCursor ?? true;
        frameFrozen.current = st.frameFrozen ?? false;
        promoMode.current = st.promoMode ?? null;
        promoInnerActive.current = st.promoInnerActive ?? false;
      } catch {
        /* mock / not ready */
      }
      const img = new Image();
      img.src = "/cursor/default.png";
      img.onload = () => {
        cursorImg.current = img;
      };
      void fetch("/cursor/cursor.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((meta) => {
          if (meta && typeof meta.hotspotX === "number" && typeof meta.hotspotY === "number") {
            cursorMeta.current = {
              width: meta.width ?? img.naturalWidth,
              height: meta.height ?? img.naturalHeight,
              hotspotX: meta.hotspotX,
              hotspotY: meta.hotspotY,
            };
          }
        })
        .catch(() => {});
      unsubs.push(
        await listen("overlay:cursor-capture", (p: { captureCursor?: boolean; cinematicCursor?: boolean } | boolean) => {
          if (typeof p === "boolean") {
            captureCursor.current = p;
            return;
          }
          if (p.captureCursor !== undefined) captureCursor.current = p.captureCursor;
          if (p.cinematicCursor !== undefined) cinematicCursor.current = p.cinematicCursor;
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
          orientation.current = vp.orientation ?? "portrait";
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
        await listen("recording:state", (p: {
          recording: boolean;
          arming?: boolean;
          promoMode?: "portrait" | "landscape" | null;
          promoInnerActive?: boolean;
        }) => {
          recording.current = p.recording;
          if (p.arming !== undefined) {
            arming.current = p.arming;
          }
          if (p.promoMode !== undefined) {
            promoMode.current = p.promoMode;
          }
          if (p.promoInnerActive !== undefined) {
            promoInnerActive.current = p.promoInnerActive;
          }
          if (p.recording) {
            if (!p.arming) countdown.current = 0;
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

      const promoBadgeOnly =
        promoMode.current && !promoInnerActive.current && !arming.current;
      if (promoBadgeOnly) {
        drawPromoBadge(ctx, canvas.width, canvas.height, dpr, promoMode.current!);
        return;
      }

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

      const label = `${formatLabel(orientation.current)} · ${zoomLabel(f.zoom, orientation.current)}`;
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

      if (
        captureCursor.current &&
        cinematicCursor.current &&
        cursorImg.current &&
        typeof f.cursorX === "number" &&
        typeof f.cursorY === "number"
      ) {
        const img = cursorImg.current;
        const meta = cursorMeta.current;
        const short = Math.min(monitor.current.w, monitor.current.h);
        const cursorH = Math.max(40 * dpr, Math.min(124 * dpr, short * 0.062 * dpr));
        const cursorScale = cursorH / meta.height;
        const cursorW = (meta.width / meta.height) * cursorH;
        const hx = meta.hotspotX * cursorScale;
        const hy = meta.hotspotY * cursorScale;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, f.cursorX * scale - hx, f.cursorY * scale - hy, cursorW, cursorH);
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
      if (cd !== prevCountdown.current) {
        prevCountdown.current = cd;
        countdownChangedAt.current = performance.now();
      }
      if (cd > 0 && arming.current) {
        const since = (performance.now() - countdownChangedAt.current) / 1000;
        drawCountdown(ctx, cd, rx + rw / 2, ry + rh / 2, Math.min(rw, rh), dpr, since);
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

/**
 * Sleek monochrome countdown: a clean white numeral inside a thin ring that
 * depletes over each second, with a soft dark scrim for legibility. No colour,
 * no heavy outline — it matches the new desktop design language.
 */
function drawPromoBadge(
  ctx: CanvasRenderingContext2D,
  width: number,
  _height: number,
  dpr: number,
  mode: "portrait" | "landscape",
) {
  const label = mode === "portrait" ? "P" : "L";
  const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(performance.now() / 280));
  const padX = 10 * dpr;
  ctx.font = `700 ${15 * dpr}px "IBM Plex Mono", monospace`;
  const tw = ctx.measureText(label).width;
  const chipW = tw + padX * 2;
  const chipH = 24 * dpr;
  const chipX = width - chipW - 14 * dpr;
  const chipY = 14 * dpr;

  ctx.globalAlpha = pulse;
  ctx.fillStyle = "rgba(10,10,16,0.82)";
  roundRect(ctx, chipX, chipY, chipW, chipH, 7 * dpr);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, chipX + padX, chipY + chipH / 2);
  ctx.globalAlpha = 1;
}

function drawCountdown(
  ctx: CanvasRenderingContext2D,
  seconds: number,
  cx: number,
  cy: number,
  frameShortEdge: number,
  dpr: number,
  since: number,
) {
  const text = String(seconds);
  const fontSize = Math.max(26 * dpr, frameShortEdge * 0.16);
  const ringR = fontSize * 1.25;
  const ringW = Math.max(2 * dpr, fontSize * 0.045);

  // Fraction of the current second already elapsed (drives the ring + entrance).
  const p = Math.min(Math.max(since, 0), 1);
  const enter = easeOutCubic(Math.min(since / 0.18, 1));

  ctx.save();

  // Soft dark scrim behind the glyph so it reads on any desktop content.
  const scrimR = ringR * 1.5;
  const scrim = ctx.createRadialGradient(cx, cy, 0, cx, cy, scrimR);
  scrim.addColorStop(0, "rgba(10, 10, 12, 0.42)");
  scrim.addColorStop(1, "rgba(10, 10, 12, 0)");
  ctx.fillStyle = scrim;
  ctx.beginPath();
  ctx.arc(cx, cy, scrimR, 0, Math.PI * 2);
  ctx.fill();

  // Base track ring.
  ctx.lineWidth = ringW;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.stroke();

  // Depleting progress arc (starts full at the top, empties over the second).
  const start = -Math.PI / 2;
  const end = start + (1 - p) * Math.PI * 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, start, end);
  ctx.stroke();

  // The numeral, with a subtle scale + fade entrance each second.
  ctx.translate(cx, cy);
  ctx.scale(0.9 + 0.1 * enter, 0.9 + 0.1 * enter);
  ctx.globalAlpha = enter;
  ctx.font = `600 ${fontSize}px "Inter", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 0, fontSize * 0.04);

  ctx.restore();
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
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
