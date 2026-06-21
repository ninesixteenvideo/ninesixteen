"use client";

import { useEffect, useRef } from "react";
import {
  advancePanFollow,
  applyEdgeSoftPan,
  CANONICAL_ZOOM_EASE_SECS,
  convergeCenterToBounds,
  crossesCanonicalZoom,
  cropRect,
  easeInOutCubic,
  edgeSoftZonePx,
  formatLabel,
  magnetZoomTarget,
  PAN_FOLLOW_PROFILE,
  PAN_MAX_SPEED_BASE,
  PAN_MAX_SPEED_TIGHT_SCALE,
  PAN_MAX_SPEED_WIDE_SCALE,
  panMaxSpeedForZoom,
  viewportCenterBounds,
  ZOOM_TICKS_PER_NOTCH,
  zoomFromGestureTicks,
  zoomGestureDurationSecs,
  zoomLabel,
} from "@/lib/viewport/geometry";
import type { OverlayFrame, Viewport } from "@/lib/viewport/types";
import { viewportDemoStore } from "@/lib/viewport/viewportDemoStore";

const ACCENT = "#8f5e55";
const DEMO_START_ZOOM = 1.28;
const FULL_FRAME_LOCK_MS = 300;
const FULL_FRAME_SETTLE = 0.012;
/** Slightly snappier than desktop defaults — web demo only. */
const DEMO_FOLLOW = {
  ...PAN_FOLLOW_PROFILE,
  smoothHz: 6.8,
  softInnerPx: 48,
  maxSpeedMult: 1.12,
};

type HomeViewportOverlayProps = {
  active: boolean;
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function tickCorner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  sx: number,
  sy: number,
) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len * sx, y);
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + len * sy);
  ctx.stroke();
}

/** Live 9×16 framing overlay — matches the desktop app's on-screen crop guide. */
export function HomeViewportOverlay({ active }: HomeViewportOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shellDimRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>({
    x: 0,
    y: 0,
    zoom: DEMO_START_ZOOM,
    rotation: 0,
    orientation: "portrait",
  });
  const cursorRef = useRef({ x: 0, y: 0 });
  const monitorRef = useRef({ w: 1, h: 1 });
  const frameRef = useRef<OverlayFrame>({ x: 0, y: 0, w: 1, h: 1, zoom: DEMO_START_ZOOM });
  const zoomEaseRef = useRef({
    from: DEMO_START_ZOOM,
    to: DEMO_START_ZOOM,
    start: 0,
    dur: 500,
    active: false,
  });
  const gestureRef = useRef({
    anchor: DEMO_START_ZOOM,
    ticks: 0,
    endTimer: 0 as ReturnType<typeof setTimeout> | 0,
  });
  const zoomTargetRef = useRef(DEMO_START_ZOOM);
  const pendingFullLockRef = useRef(false);
  const fullFrameLockUntilRef = useRef(0);
  const lastTickRef = useRef(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!active) return;

    const syncMonitor = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      monitorRef.current = { w, h };
      viewportRef.current.x = w / 2;
      viewportRef.current.y = h / 2;
      viewportRef.current.zoom = DEMO_START_ZOOM;
      zoomTargetRef.current = DEMO_START_ZOOM;
      pendingFullLockRef.current = false;
      fullFrameLockUntilRef.current = 0;
      zoomEaseRef.current.active = false;
      cursorRef.current = { x: w / 2, y: h / 2 };
      const crop = cropRect(viewportRef.current, w, h);
      frameRef.current = { x: crop.x, y: crop.y, w: crop.w, h: crop.h, zoom: DEMO_START_ZOOM };
      viewportDemoStore.setFrame(frameRef.current, { w, h });
    };
    syncMonitor();

    const restartZoomEase = (from: number, to: number, totalTicks: number) => {
      const canonical =
        Math.abs(to - 1) <= 0.035 || Math.abs(to - 0.45) <= 0.035 || Math.abs(to - 4) <= 0.035;
      zoomEaseRef.current = {
        from,
        to,
        start: performance.now(),
        dur:
          (canonical ? CANONICAL_ZOOM_EASE_SECS : zoomGestureDurationSecs(from, to, totalTicks)) *
          1000,
        active: true,
      };
    };

    const onMove = (e: MouseEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
    };

    const fullFrameHoldActive = () => performance.now() < fullFrameLockUntilRef.current;

    const scrollInputBlocked = () => fullFrameHoldActive() || pendingFullLockRef.current;

    const engageFullFrameHold = () => {
      pendingFullLockRef.current = false;
      gestureRef.current.ticks = 0;
      if (gestureRef.current.endTimer) {
        clearTimeout(gestureRef.current.endTimer);
        gestureRef.current.endTimer = 0;
      }
      fullFrameLockUntilRef.current = performance.now() + FULL_FRAME_LOCK_MS;
      zoomEaseRef.current.active = false;
      zoomTargetRef.current = 1;
      viewportRef.current.zoom = 1;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cursorRef.current = { x: e.clientX, y: e.clientY };
      if (scrollInputBlocked()) return;

      let notches = e.deltaY / 120;
      if (Math.abs(notches) < 0.35) notches *= 2.5;
      const ticks = notches * ZOOM_TICKS_PER_NOTCH;

      const gesture = gestureRef.current;
      const vp = viewportRef.current;
      if (!gesture.ticks) {
        gesture.anchor = vp.zoom;
      }
      gesture.ticks += ticks;

      const prevTarget = zoomTargetRef.current;
      const rawTarget = zoomFromGestureTicks(gesture.anchor, gesture.ticks, 1, vp.orientation);
      const crossed = crossesCanonicalZoom(prevTarget, rawTarget, vp.orientation);
      let target: number;
      if (crossed !== null) {
        pendingFullLockRef.current = Math.abs(crossed - 1) <= 0.035;
        target = crossed;
      } else {
        pendingFullLockRef.current = false;
        target = magnetZoomTarget(rawTarget, vp.orientation);
      }
      zoomTargetRef.current = target;
      restartZoomEase(vp.zoom, target, Math.abs(gesture.ticks));

      if (gesture.endTimer) clearTimeout(gesture.endTimer);
      gesture.endTimer = setTimeout(() => {
        gesture.ticks = 0;
        gesture.endTimer = 0;
      }, 180);
    };

    const advance = (dt: number) => {
      const vp = viewportRef.current;
      const monitor = monitorRef.current;
      const profile = DEMO_FOLLOW;
      const cursor = cursorRef.current;
      const reduced = reducedMotionRef.current;

      const panHz = profile.smoothHz;
      const maxPan =
        panMaxSpeedForZoom(
          vp.zoom,
          PAN_MAX_SPEED_BASE,
          PAN_MAX_SPEED_WIDE_SCALE,
          PAN_MAX_SPEED_TIGHT_SCALE,
        ) * profile.maxSpeedMult;

      let [nx, ny] = reduced
        ? [cursor.x, cursor.y]
        : advancePanFollow(
            vp.x,
            vp.y,
            cursor.x,
            cursor.y,
            panHz,
            dt,
            profile.softInnerPx,
            profile.softOuterPx,
            profile.softInnerScale,
            maxPan,
          );

      const crop = cropRect(vp, monitor.w, monitor.h);
      const soft = edgeSoftZonePx(crop.w, crop.h);
      const bounds = viewportCenterBounds(vp, monitor.w, monitor.h);
      [nx, ny] = applyEdgeSoftPan(
        vp.x,
        vp.y,
        nx,
        ny,
        bounds.minX,
        bounds.maxX,
        bounds.minY,
        bounds.maxY,
        soft,
      );

      const ease = zoomEaseRef.current;
      const hold = fullFrameHoldActive();
      const pending = pendingFullLockRef.current;
      if (hold) {
        vp.zoom = 1;
        zoomTargetRef.current = 1;
        ease.active = false;
      } else if (ease.active) {
        const elapsed = (performance.now() - ease.start) / ease.dur;
        const t = easeInOutCubic(Math.min(1, elapsed));
        vp.zoom = ease.from + (ease.to - ease.from) * t;
        const settled = elapsed >= 1;
        if (settled) {
          vp.zoom = magnetZoomTarget(ease.to, vp.orientation);
          ease.active = false;
          if (pending && Math.abs(vp.zoom - 1) <= FULL_FRAME_SETTLE) {
            engageFullFrameHold();
          }
        }
        const b = viewportCenterBounds(vp, monitor.w, monitor.h);
        [nx, ny] = convergeCenterToBounds(
          nx,
          ny,
          b.minX,
          b.maxX,
          b.minY,
          b.maxY,
          profile.boundsConvergeHz,
          dt,
        );
      }

      vp.x = nx;
      vp.y = ny;

      const nextCrop = cropRect(vp, monitor.w, monitor.h);
      frameRef.current = {
        x: nextCrop.x,
        y: nextCrop.y,
        w: nextCrop.w,
        h: nextCrop.h,
        zoom: vp.zoom,
      };
      viewportDemoStore.setFrame(frameRef.current, monitor);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", syncMonitor);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { alpha: true, desynchronized: true });
    if (!canvas || !ctx) {
      return () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("wheel", onWheel);
        window.removeEventListener("resize", syncMonitor);
        if (gestureRef.current.endTimer) clearTimeout(gestureRef.current.endTimer);
      };
    }

    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = window.innerWidth;
      const ch = window.innerHeight;
      const targetW = Math.round(cw * dpr);
      const targetH = Math.round(ch * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const monitor = monitorRef.current;
      const scale = canvas.width / Math.max(monitor.w, 1);
      const f = frameRef.current;
      const rx = f.x * scale;
      const ry = f.y * scale;
      const rw = f.w * scale;
      const rh = f.h * scale;

      const shellHole = shellDimRef.current;
      if (shellHole) {
        shellHole.style.transform = `translate3d(${f.x}px, ${f.y}px, 0)`;
        shellHole.style.width = `${f.w}px`;
        shellHole.style.height = `${f.h}px`;
      }

      ctx.lineWidth = 5 * dpr;
      ctx.strokeStyle = "rgba(143, 94, 85, 0.45)";
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(rx, ry, rw, rh);
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

      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 4 * dpr;
      const L = 22 * dpr;
      tickCorner(ctx, rx, ry, L, 1, 1);
      tickCorner(ctx, rx + rw, ry, L, -1, 1);
      tickCorner(ctx, rx, ry + rh, L, 1, -1);
      tickCorner(ctx, rx + rw, ry + rh, L, -1, -1);

      const vp = viewportRef.current;
      const label = `${formatLabel(vp.orientation)} · ${zoomLabel(f.zoom, vp.orientation)}`;
      ctx.font = `${13 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
      const padX = 8 * dpr;
      const tw = ctx.measureText(label).width;
      const recDotR = 4 * dpr;
      const recGap = 10 * dpr;
      const chipW = tw + padX * 2 + recGap + recDotR * 2;
      const chipH = 22 * dpr;
      const chipX = rx + 6 * dpr;
      const chipY = ry + 6 * dpr;
      ctx.fillStyle = "rgba(10,10,16,0.78)";
      roundRect(ctx, chipX, chipY, chipW, chipH, 6 * dpr);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, chipX + padX, chipY + chipH / 2);

      const recPulse = 0.45 + 0.55 * Math.abs(Math.sin(performance.now() / 420));
      const dotX = chipX + padX + tw + recGap + recDotR;
      const dotY = chipY + chipH / 2;
      ctx.fillStyle = `rgba(255, 77, 77, ${recPulse})`;
      ctx.beginPath();
      ctx.arc(dotX, dotY, recDotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath();
      ctx.arc(dotX, dotY, recDotR * 0.55, 0, Math.PI * 2);
      ctx.fill();

      const demoText = "DEMO";
      ctx.font = `${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
      const demoTw = ctx.measureText(demoText).width;
      const demoPadX = 10 * dpr;
      const demoChipW = demoTw + demoPadX * 2;
      const demoChipH = 20 * dpr;
      const demoChipX = rx + rw - demoChipW - 6 * dpr;
      const demoChipY = ry + 6 * dpr;
      ctx.fillStyle = "rgba(10,10,16,0.78)";
      roundRect(ctx, demoChipX, demoChipY, demoChipW, demoChipH, 6 * dpr);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 107, 88, 0.95)";
      ctx.textBaseline = "middle";
      ctx.fillText(demoText, demoChipX + demoPadX, demoChipY + demoChipH / 2);

      const hint = "Scroll · zoom frame";
      ctx.font = `${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
      const hw = ctx.measureText(hint).width;
      ctx.fillStyle = "rgba(244,243,240,0.38)";
      ctx.fillText(hint, (canvas.width - hw) / 2, canvas.height - 28 * dpr);
    };

    let raf = 0;
    const loop = (now: number) => {
      if (!lastTickRef.current) lastTickRef.current = now;
      const dt = Math.min(0.05, Math.max(1 / 240, (now - lastTickRef.current) / 1000));
      lastTickRef.current = now;
      advance(dt);
      paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", syncMonitor);
      if (gestureRef.current.endTimer) clearTimeout(gestureRef.current.endTimer);
    };
  }, [active]);

  if (!active) return null;

  return (
    <>
      <div className="home-viewport-shell-dim" aria-hidden>
        <div ref={shellDimRef} className="home-viewport-shell-dim__hole" />
      </div>
      <canvas ref={canvasRef} className="home-viewport" aria-hidden />
    </>
  );
}
