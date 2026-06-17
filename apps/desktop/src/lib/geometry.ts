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

function smoothstep(edge0: number, edge1: number, x: number): number {
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

/** The crop rectangle (in source pixels) for a viewport over a source of given size. */
export function cropRect(
  vp: Viewport,
  srcW: number,
  srcH: number,
  outShortEdge = 1080,
): Rect {
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

/**
 * Output dimensions for an orientation + selected quality (the 9-side / short
 * edge: 720 or 1080). The 16-side is derived for an exact standard
 * resolution, e.g. 1080 → 1920×1080 (landscape) / 1080×1920 (portrait).
 */
export function outputDims(o: Orientation, shortEdge: number): { w: number; h: number } {
  const capped = Math.min(Math.max(shortEdge, 720), 1080);
  const long = Math.round((capped * 16) / 9) & ~1;
  const short = capped & ~1;
  return o === "landscape" ? { w: long, h: short } : { w: short, h: long };
}

/** Human-readable zoom label for the overlay chip. */
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
