use crate::state::{Orientation, Viewport};

#[derive(Clone, Copy, Debug)]
pub struct CropRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Destination rectangle inside the 9:16 output (pixels).
#[derive(Clone, Copy, Debug)]
pub struct DestRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct FrameLayout {
    pub crop: CropRect,
    pub dest: DestRect,
}

/// Minimum zoom — entire desktop letterboxed in the 9:16 output.
pub const ZOOM_MIN: f64 = 0.45;
pub const ZOOM_MAX: f64 = 4.0;
/// Snap to exactly full 9:16 when within this band of 1.0.
pub const ZOOM_SNAP_EPS: f64 = 0.035;

pub fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if hi < lo {
        (lo + hi) / 2.0
    } else {
        v.max(lo).min(hi)
    }
}

pub fn normalize_zoom(z: f64) -> f64 {
    let z = clamp_zoom(z);
    if (z - 1.0).abs() <= ZOOM_SNAP_EPS {
        1.0
    } else {
        z
    }
}

pub fn clamp_zoom(z: f64) -> f64 {
    clamp(z, ZOOM_MIN, ZOOM_MAX)
}

fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    if edge0 >= edge1 {
        return if x >= edge1 { 1.0 } else { 0.0 };
    }
    let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Largest 9:16 rect that fits inside the source monitor.
fn base_crop(sw: f64, sh: f64, aspect: f64) -> (f64, f64) {
    if sw / sh > aspect {
        (sh * aspect, sh)
    } else {
        (sw, sw / aspect)
    }
}

fn centered_crop(cx: f64, cy: f64, w: f64, h: f64, sw: f64, sh: f64) -> CropRect {
    let cx = clamp(cx, w / 2.0, sw - w / 2.0);
    let cy = clamp(cy, h / 2.0, sh - h / 2.0);
    CropRect {
        x: cx - w / 2.0,
        y: cy - h / 2.0,
        w,
        h,
    }
}

/// Letterbox the full monitor into a 9:16 output frame.
fn letterbox_dest(sw: f64, sh: f64, out_w: f64, out_h: f64) -> DestRect {
    let scale = (out_w / sw).min(out_h / sh);
    let w = sw * scale;
    let h = sh * scale;
    DestRect {
        x: (out_w - w) / 2.0,
        y: (out_h - h) / 2.0,
        w,
        h,
    }
}

/// Frame-rate independent exponential smoothing toward a target.
pub fn smooth_toward(current: f64, target: f64, rate_hz: f64, dt_secs: f64) -> f64 {
    if dt_secs <= 0.0 {
        return current;
    }
    let k = 1.0 - (-rate_hz * dt_secs).exp();
    current + (target - current) * k
}

/// Crop + output placement for the current viewport zoom level.
pub fn frame_layout(vp: &Viewport, src_w: u32, src_h: u32, out_w: u32, out_h: u32) -> FrameLayout {
    let sw = src_w as f64;
    let sh = src_h as f64;
    let ow = out_w as f64;
    let oh = out_h as f64;
    let aspect = vp.orientation.aspect();
    let zoom = clamp_zoom(vp.zoom);

    let (base_w, base_h) = base_crop(sw, sh, aspect);
    let dest_fill = DestRect {
        x: 0.0,
        y: 0.0,
        w: ow,
        h: oh,
    };

    if zoom >= 1.0 {
        let w = base_w / zoom;
        let h = base_h / zoom;
        return FrameLayout {
            crop: centered_crop(vp.x, vp.y, w, h, sw, sh),
            dest: dest_fill,
        };
    }

    // zoom < 1: blend from full-desktop letterbox → full 9:16 fill at zoom = 1.
    let t = smoothstep(ZOOM_MIN, 1.0, zoom);
    let dest_lb = letterbox_dest(sw, sh, ow, oh);
    let dest = DestRect {
        x: lerp(dest_lb.x, dest_fill.x, t),
        y: lerp(dest_lb.y, dest_fill.y, t),
        w: lerp(dest_lb.w, dest_fill.w, t),
        h: lerp(dest_lb.h, dest_fill.h, t),
    };

    // Crop aspect must match dest aspect so the GPU maps pixels uniformly (no stretch).
    let dest_aspect = dest.w / dest.h.max(1.0);
    let mut crop_h = lerp(sh, base_h, t);
    let mut crop_w = crop_h * dest_aspect;
    if crop_w > sw {
        crop_w = sw;
        crop_h = crop_w / dest_aspect;
    }
    if crop_h > sh {
        crop_h = sh;
        crop_w = crop_h * dest_aspect;
    }
    let crop = centered_crop(vp.x, vp.y, crop_w, crop_h, sw, sh);
    FrameLayout { crop, dest }
}

/// Largest rect of the viewport's aspect that fits in the source, divided by zoom,
/// centered on the viewport and clamped to stay inside the source.
pub fn crop_rect(vp: &Viewport, src_w: u32, src_h: u32) -> CropRect {
    frame_layout(vp, src_w, src_h, 1080, 1920).crop
}

/// Output dimensions for the recording. `short_edge` is the quality the user
/// picks (720 or 1080) — i.e. the 9-side — and the long (16-) side is
/// derived so the file is an exact standard resolution.
pub fn output_dims(o: Orientation, short_edge: u32) -> (u32, u32) {
    let short = if short_edge <= 720 { 720 } else { 1080 };
    let long = (((short as f64) * 16.0 / 9.0).round() as u32).max(2);
    let (w, h) = match o {
        Orientation::Landscape => (long, short),
        Orientation::Portrait => (short, long),
    };
    (w & !1, h & !1)
}
