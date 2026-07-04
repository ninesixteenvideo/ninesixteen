import { useEffect, useRef } from "react";
import { invoke, listen } from "../lib/bridge";
import { cropRect, qualityFromOutputDims } from "../lib/geometry";
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
  const captureCursor = useRef(true);
  const cinematicCursor = useRef(true);
  const cursorImg = useRef<HTMLImageElement | null>(null);
  const cursorMeta = useRef({ width: 256, height: 256, hotspotX: 0, hotspotY: 0 });
  const frameFrozen = useRef(false);
  const prevCountdown = useRef(0);
  const countdownChangedAt = useRef(0);
  const promoMode = useRef<"portrait" | "landscape" | null>(null);
  const promoInnerActive = useRef(false);
  const gameMode = useRef(false);
  const gamePanMode = useRef<"crosshair" | "cursor">("crosshair");
  const gamePulse = useRef<{ phase: "start" | "end"; startedAt: number } | null>(null);

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
        gameMode.current = st.gameMode ?? false;
        gamePanMode.current = st.gamePanMode ?? "crosshair";
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
        await listen("overlay:cursor-capture", (p: {
          captureCursor?: boolean;
          cinematicCursor?: boolean;
          gameMode?: boolean;
          gamePanMode?: "crosshair" | "cursor";
        } | boolean) => {
          if (typeof p === "boolean") {
            captureCursor.current = p;
            return;
          }
          if (p.captureCursor !== undefined) captureCursor.current = p.captureCursor;
          if (p.cinematicCursor !== undefined) cinematicCursor.current = p.cinematicCursor;
          if (p.gameMode !== undefined) gameMode.current = p.gameMode;
          if (p.gamePanMode !== undefined) gamePanMode.current = p.gamePanMode;
        }),
      );
      unsubs.push(
        await listen("recording:game-pulse", (p: { phase: "start" | "end" }) => {
          if (p.phase === "start" || p.phase === "end") {
            gamePulse.current = { phase: p.phase, startedAt: performance.now() };
          }
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
          if (p.recording && !p.arming) {
            countdown.current = 0;
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

      drawMinimalViewport(ctx, rx, ry, rw, rh, dpr, recording.current);

      const pulse = gamePulse.current;
      if (pulse) {
        const elapsed = (performance.now() - pulse.startedAt) / 1000;
        if (elapsed >= 1) {
          gamePulse.current = null;
        } else {
          drawGamePulse(ctx, pulse.phase, rx + rw / 2, ry + rh / 2, dpr, elapsed);
        }
      }

      drawCinematicCursor(
        ctx,
        f,
        scale,
        dpr,
        monitor.current,
        captureCursor.current,
        cinematicCursor.current,
        cursorImg.current,
        cursorMeta.current,
      );

      const promoCountdown = promoMode.current && arming.current;
      const cd = countdown.current;
      if (promoCountdown && cd > 0) {
        if (cd !== prevCountdown.current) {
          prevCountdown.current = cd;
          countdownChangedAt.current = performance.now();
        }
        const since = (performance.now() - countdownChangedAt.current) / 1000;
        drawCountdown(ctx, cd, rx + rw / 2, ry + rh / 2, Math.min(rw, rh), dpr, since);
      } else if (cd === 0) {
        prevCountdown.current = 0;
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
function drawCinematicCursor(
  ctx: CanvasRenderingContext2D,
  frame: OverlayFrame,
  scale: number,
  dpr: number,
  monitor: { w: number; h: number },
  captureCursor: boolean,
  cinematicCursor: boolean,
  cursorImg: HTMLImageElement | null,
  cursorMeta: { width: number; height: number; hotspotX: number; hotspotY: number },
) {
  if (
    !captureCursor ||
    !cinematicCursor ||
    !cursorImg ||
    typeof frame.cursorX !== "number" ||
    typeof frame.cursorY !== "number"
  ) {
    return;
  }

  const short = Math.min(monitor.w, monitor.h);
  const cursorH = Math.max(40 * dpr, Math.min(124 * dpr, short * 0.062 * dpr));
  const cursorScale = cursorH / cursorMeta.height;
  const cursorW = (cursorMeta.width / cursorMeta.height) * cursorH;
  const hx = cursorMeta.hotspotX * cursorScale;
  const hy = cursorMeta.hotspotY * cursorScale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    cursorImg,
    frame.cursorX * scale - hx,
    frame.cursorY * scale - hy,
    cursorW,
    cursorH,
  );
}

function drawGamePulse(
  ctx: CanvasRenderingContext2D,
  phase: "start" | "end",
  cx: number,
  cy: number,
  dpr: number,
  elapsed: number,
) {
  const t = Math.min(Math.max(elapsed, 0), 1);
  const alpha =
    t < 0.5 ? easeOutCubic(t / 0.5) : easeOutCubic((1 - t) / 0.5);
  if (alpha <= 0.01) return;

  const action = phase === "start" ? "start" : "end";
  const fontSize = Math.max(20 * dpr, 24 * dpr);
  const dotR = 6 * dpr;
  const gap = 10 * dpr;
  const mint = "#78ffd4";
  const coral = "#ff6b58";

  ctx.save();
  ctx.globalAlpha = alpha * 0.92;
  ctx.font = `500 ${fontSize}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "middle";
  const recW = ctx.measureText("rec").width;
  const spaceW = ctx.measureText(" ").width;
  const actionW = ctx.measureText(action).width;
  const textW = recW + spaceW + actionW;
  const totalW = dotR * 2 + gap + textW;
  const x0 = cx - totalW / 2;

  ctx.fillStyle = coral;
  ctx.beginPath();
  ctx.arc(x0 + dotR, cy, dotR, 0, Math.PI * 2);
  ctx.fill();

  const textX = x0 + dotR * 2 + gap;
  ctx.fillStyle = mint;
  ctx.fillText("rec", textX, cy);
  ctx.fillStyle = coral;
  ctx.fillText(action, textX + recW + spaceW, cy);
  ctx.restore();
}

function drawMinimalViewport(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dpr: number,
  recording: boolean,
) {
  drawCornerBrackets(ctx, x, y, w, h, dpr);

  if (!recording) return;

  const blinkOn = Math.floor(performance.now() / 530) % 2 === 0;
  if (!blinkOn) return;

  const dotX = x + 14 * dpr;
  const dotY = y + 14 * dpr;
  ctx.fillStyle = "#ff6b58";
  ctx.beginPath();
  ctx.arc(dotX, dotY, 5 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dpr: number,
) {
  const L = 26 * dpr;
  const lw = 2.75 * dpr;
  const pairGap = 1 * dpr;

  ctx.save();
  ctx.lineCap = "square";
  ctx.lineWidth = lw;
  ctx.shadowBlur = 0;

  const corners: Array<[number, number, number, number]> = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];

  for (const [cx, cy, sx, sy] of corners) {
    const px = -sy * pairGap;
    const py = sx * pairGap;
    ctx.strokeStyle = "#1b1a18";
    tick(ctx, cx + px, cy + py, L, sx, sy);
    ctx.strokeStyle = "#ffffff";
    tick(ctx, cx - px, cy - py, L, sx, sy);
  }

  ctx.restore();
}

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

