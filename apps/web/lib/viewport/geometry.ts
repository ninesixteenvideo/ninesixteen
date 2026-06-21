import type { Orientation, Viewport } from "./types";

export function aspectOf(o: Orientation): number {
  return o === "landscape" ? 16 / 9 : 9 / 16;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ZOOM_MIN = 0.45;
export const ZOOM_MIN_LANDSCAPE = 1;
export const ZOOM_MAX = 4;
export const ZOOM_SNAP_EPS = 0.035;
export const ZOOM_TICKS_PER_NOTCH = 13;
const ZOOM_NOTCH_FACTOR_AT_1 = 1.16;

export function zoomMinFor(orientation: Orientation): number {
  return orientation === "landscape" ? ZOOM_MIN_LANDSCAPE : ZOOM_MIN;
}

export function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, v));
}

export function clampZoom(z: number, orientation: Orientation = "portrait"): number {
  return clamp(z, zoomMinFor(orientation), ZOOM_MAX);
}

export function normalizeZoom(z: number, orientation: Orientation = "portrait"): number {
  const clamped = clampZoom(z, orientation);
  return Math.abs(clamped - 1) <= ZOOM_SNAP_EPS ? 1 : clamped;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 >= edge1) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function baseCrop(srcW: number, srcH: number, aspect: number) {
  if (srcW / srcH > aspect) {
    return { w: srcH * aspect, h: srcH };
  }
  return { w: srcW, h: srcW / aspect };
}

function centeredCrop(cx: number, cy: number, w: number, h: number, srcW: number, srcH: number): Rect {
  const cxClamped = clamp(cx, w / 2, srcW - w / 2);
  const cyClamped = clamp(cy, h / 2, srcH - h / 2);
  return { x: cxClamped - w / 2, y: cyClamped - h / 2, w, h };
}

function letterboxDest(sw: number, sh: number, outW: number, outH: number): Rect {
  const scale = Math.min(outW / sw, outH / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (outW - w) / 2, y: (outH - h) / 2, w, h };
}

export function cropRect(vp: Viewport, srcW: number, srcH: number, outShortEdge = 1080): Rect {
  const aspect = aspectOf(vp.orientation);
  const sw = srcW;
  const sh = srcH;
  const zoom = clampZoom(vp.zoom, vp.orientation);
  const { w: baseW, h: baseH } = baseCrop(sw, sh, aspect);

  if (zoom >= 1) {
    const w = baseW / zoom;
    const h = baseH / zoom;
    return centeredCrop(vp.x, vp.y, w, h, sw, sh);
  }

  const t = smoothstep(zoomMinFor(vp.orientation), 1, zoom);
  const { w: outW, h: outH } = outputDims(vp.orientation, outShortEdge);
  const destFill = { x: 0, y: 0, w: outW, h: outH };
  const destLb = letterboxDest(sw, sh, outW, outH);
  const dest = {
    x: lerp(destLb.x, destFill.x, t),
    y: lerp(destLb.y, destFill.y, t),
    w: lerp(destLb.w, destFill.w, t),
    h: lerp(destLb.h, destFill.h, t),
  };

  const destAspect = dest.w / Math.max(dest.h, 1);
  let cropH = lerp(sh, baseH, t);
  let cropW = cropH * destAspect;
  if (cropW > sw) {
    cropW = sw;
    cropH = cropW / destAspect;
  }
  if (cropH > sh) {
    cropH = sh;
    cropW = cropH * destAspect;
  }
  return centeredCrop(vp.x, vp.y, cropW, cropH, sw, sh);
}

export function outputDims(o: Orientation, shortEdge: number): { w: number; h: number } {
  const short = shortEdge > 900 ? 1080 : 720;
  const long = Math.round((short * 16) / 9) & ~1;
  const s = short & ~1;
  return o === "landscape" ? { w: long, h: s } : { w: s, h: long };
}

export function zoomLabel(zoom: number, orientation: Orientation = "portrait"): string {
  const z = normalizeZoom(zoom, orientation);
  const min = zoomMinFor(orientation);
  if (z <= min + 0.001) {
    return orientation === "landscape" ? "Full 16×9" : "Full desktop";
  }
  if (z === 1) return orientation === "landscape" ? "Full 16×9" : "Full 9×16";
  return `${Math.round(z * 100)}%`;
}

export function formatLabel(orientation: Orientation): string {
  return orientation === "landscape" ? "16×9" : "9×16";
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  if (x < 0.5) return 4 * x * x * x;
  return 1 - (-2 * x + 2) ** 3 / 2;
}

export function zoomPerTickFactor(sensitivity: number): number {
  const sens = clamp(sensitivity, 0.2, 3);
  const notch = 1 + (ZOOM_NOTCH_FACTOR_AT_1 - 1) * sens;
  return notch ** (1 / ZOOM_TICKS_PER_NOTCH);
}

export function zoomFromGestureTicks(
  anchor: number,
  ticks: number,
  sensitivity: number,
  orientation: Orientation,
): number {
  if (Math.abs(ticks) < Number.EPSILON) return clampZoom(anchor, orientation);
  const raw = anchor * zoomPerTickFactor(sensitivity) ** ticks;
  return clampZoom(raw, orientation);
}

export function magnetZoomTarget(z: number, orientation: Orientation): number {
  const clamped = clampZoom(z, orientation);
  const min = zoomMinFor(orientation);
  if (Math.abs(clamped - min) <= ZOOM_SNAP_EPS) return min;
  if (Math.abs(clamped - 1) <= ZOOM_SNAP_EPS) return 1;
  if (Math.abs(clamped - ZOOM_MAX) <= ZOOM_SNAP_EPS) return ZOOM_MAX;
  return clamped;
}

export function zoomCanonicalLevels(orientation: Orientation): number[] {
  return orientation === "landscape"
    ? [zoomMinFor(orientation), ZOOM_MAX]
    : [ZOOM_MIN, 1, ZOOM_MAX];
}

/** True when a gesture target crosses or lands on a canonical zoom stop. */
export function crossesCanonicalZoom(
  prev: number,
  next: number,
  orientation: Orientation,
): number | null {
  for (const level of zoomCanonicalLevels(orientation)) {
    if ((prev - level) * (next - level) < 0) return level;
    if (Math.abs(next - level) <= ZOOM_SNAP_EPS) return level;
  }
  return null;
}

export function zoomGestureDurationSecs(from: number, to: number, totalTicks: number): number {
  const tickSecs = 0.034;
  const base = 0.38;
  const tickPart = Math.abs(totalTicks) * tickSecs;
  const distPart = 0.28 + Math.abs(to - from) * 1.05;
  return Math.min(3.4, Math.max(0.52, base + tickPart, distPart));
}

export const CANONICAL_ZOOM_EASE_SECS = 1.05;

export function viewportCenterBounds(vp: Viewport, srcW: number, srcH: number) {
  const crop = cropRect(vp, srcW, srcH);
  return {
    minX: crop.w / 2,
    maxX: srcW - crop.w / 2,
    minY: crop.h / 2,
    maxY: srcH - crop.h / 2,
  };
}

export const EDGE_PAN_SOFT_FRAC = 0.15;
export const EDGE_PAN_SOFT_MIN_PX = 60;
export const EDGE_PAN_SOFT_MAX_PX = 220;
export const SOFT_APPROACH_FLOOR = 0.11;

export function edgeSoftZonePx(cropW: number, cropH: number): number {
  return clamp(
    Math.min(cropW, cropH) * EDGE_PAN_SOFT_FRAC,
    EDGE_PAN_SOFT_MIN_PX,
    EDGE_PAN_SOFT_MAX_PX,
  );
}

export function smoothToward(current: number, target: number, rateHz: number, dtSecs: number): number {
  if (dtSecs <= 0) return current;
  const k = 1 - Math.exp(-rateHz * dtSecs);
  return current + (target - current) * k;
}

export function panFollowSpeedScale(
  distPx: number,
  innerPx: number,
  outerPx: number,
  innerScale: number,
): number {
  if (distPx <= innerPx) return innerScale;
  if (distPx >= outerPx) return 1;
  const t = smoothstep(innerPx, outerPx, distPx);
  return lerp(innerScale, 1, t);
}

export function panMaxSpeedForZoom(
  zoom: number,
  baseAtZoom1: number,
  wideScale: number,
  tightScale: number,
): number {
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const t = smoothstep(ZOOM_MIN, ZOOM_MAX, z);
  return baseAtZoom1 * lerp(wideScale, tightScale, t);
}

export function advancePanFollow(
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  rateHz: number,
  dtSecs: number,
  softInnerPx: number,
  softOuterPx: number,
  innerSpeedScale: number,
  maxSpeedPxPerSec: number,
): [number, number] {
  if (dtSecs <= 0) return [cx, cy];

  const dx = tx - cx;
  const dy = ty - cy;
  const dist = Math.hypot(dx, dy);
  if (dist <= Number.EPSILON) return [cx, cy];

  const speedScale = panFollowSpeedScale(dist, softInnerPx, softOuterPx, innerSpeedScale);
  const effRate = rateHz * speedScale;
  const effMax = maxSpeedPxPerSec * speedScale;

  let nx = smoothToward(cx, tx, effRate, dtSecs);
  let ny = smoothToward(cy, ty, effRate, dtSecs);

  const stepX = nx - cx;
  const stepY = ny - cy;
  const stepLen = Math.hypot(stepX, stepY);
  const maxStep = effMax * dtSecs;
  if (stepLen > maxStep && stepLen > Number.EPSILON) {
    const s = maxStep / stepLen;
    nx = cx + stepX * s;
    ny = cy + stepY * s;
  }

  return [nx, ny];
}

function softApproachSpeedScale(margin: number, soft: number): number {
  if (soft <= 0) return 1;
  if (margin >= soft) return 1;
  if (margin <= 0) return SOFT_APPROACH_FLOOR;
  const t = smoothstep(0, soft, margin);
  return SOFT_APPROACH_FLOOR + (1 - SOFT_APPROACH_FLOOR) * t;
}

function capIntoMarginStep(step: number, margin: number, softPx: number): number {
  if (margin >= softPx || Math.abs(step) <= Number.EPSILON) return step;
  const t = 1 - clamp(margin / softPx, 0, 1);
  const maxFrac = 0.52 + 0.43 * smoothstep(0, 1, t);
  const maxStep = margin * maxFrac;
  return Math.abs(step) <= maxStep ? step : Math.sign(step) * maxStep;
}

function applyAxisEdgeStep(
  pos: number,
  delta: number,
  min: number,
  max: number,
  scale: number,
  softPx: number,
): number {
  if (Math.abs(delta) <= Number.EPSILON) return clamp(pos, min, max);
  const margin = delta > 0 ? max - pos : pos - min;
  if (margin <= 0) return delta > 0 ? max : min;
  const step = capIntoMarginStep(delta * scale, margin, softPx);
  return clamp(pos + step, min, max);
}

export function applyEdgeSoftPan(
  cx: number,
  cy: number,
  nx: number,
  ny: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  softPx: number,
): [number, number] {
  const dx = nx - cx;
  const dy = ny - cy;
  if (Math.abs(dx) <= Number.EPSILON && Math.abs(dy) <= Number.EPSILON) {
    return [clamp(cx, minX, maxX), clamp(cy, minY, maxY)];
  }

  const mx = dx > 0 ? maxX - cx : dx < 0 ? cx - minX : null;
  const my = dy > 0 ? maxY - cy : dy < 0 ? cy - minY : null;
  let scaleX = mx !== null ? softApproachSpeedScale(mx, softPx) : 1;
  let scaleY = my !== null ? softApproachSpeedScale(my, softPx) : 1;

  if (mx !== null && my !== null && mx < softPx && my < softPx) {
    const coupled = softApproachSpeedScale(Math.max(mx, my), softPx);
    scaleX = coupled;
    scaleY = coupled;
  }

  const outX = applyAxisEdgeStep(cx, dx, minX, maxX, scaleX, softPx);
  const outY = applyAxisEdgeStep(cy, dy, minY, maxY, scaleY, softPx);
  return [outX, outY];
}

export function convergeCenterToBounds(
  cx: number,
  cy: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  rateHz: number,
  dtSecs: number,
): [number, number] {
  if (dtSecs <= 0) return [cx, cy];
  const tx = clamp(cx, minX, maxX);
  const ty = clamp(cy, minY, maxY);
  if (Math.abs(tx - cx) <= Number.EPSILON && Math.abs(ty - cy) <= Number.EPSILON) {
    return [cx, cy];
  }
  return [smoothToward(cx, tx, rateHz, dtSecs), smoothToward(cy, ty, rateHz, dtSecs)];
}

export const PAN_FOLLOW_PROFILE = {
  smoothHz: 5.2,
  smoothHzAlt: 5.8,
  softInnerPx: 55,
  softOuterPx: 340,
  softInnerScale: 0.32,
  maxSpeedMult: 1,
  boundsConvergeHz: 17,
};

export const PAN_MAX_SPEED_BASE = 760;
export const PAN_MAX_SPEED_WIDE_SCALE = 0.72;
export const PAN_MAX_SPEED_TIGHT_SCALE = 1.28;
