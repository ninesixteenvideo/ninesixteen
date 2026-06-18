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

/// Minimum zoom — entire desktop letterboxed in portrait output.
pub const ZOOM_MIN: f64 = 0.45;
pub const ZOOM_MIN_LANDSCAPE: f64 = 1.0;
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

pub fn zoom_min_for(orientation: crate::state::Orientation) -> f64 {
    match orientation {
        crate::state::Orientation::Landscape => ZOOM_MIN_LANDSCAPE,
        crate::state::Orientation::Portrait => ZOOM_MIN,
    }
}

pub fn normalize_zoom(z: f64, orientation: crate::state::Orientation) -> f64 {
    let z = clamp_zoom(z, orientation);
    if (z - 1.0).abs() <= ZOOM_SNAP_EPS {
        1.0
    } else {
        z
    }
}

pub fn clamp_zoom(z: f64, orientation: crate::state::Orientation) -> f64 {
    clamp(z, zoom_min_for(orientation), ZOOM_MAX)
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
    let (min_x, max_x, min_y, max_y) = center_bounds(w, h, sw, sh);
    let cx = clamp(cx, min_x, max_x);
    let cy = clamp(cy, min_y, max_y);
    CropRect {
        x: cx - w / 2.0,
        y: cy - h / 2.0,
        w,
        h,
    }
}

/// Valid viewport-center range so a `w`×`h` crop stays inside the source.
pub fn center_bounds(w: f64, h: f64, sw: f64, sh: f64) -> (f64, f64, f64, f64) {
    (w / 2.0, sw - w / 2.0, h / 2.0, sh - h / 2.0)
}

/// Soft-zone width for edge pan easing — scales with crop size, clamped for tiny/huge frames.
pub const EDGE_PAN_SOFT_FRAC: f64 = 0.15;
pub const EDGE_PAN_SOFT_MIN_PX: f64 = 60.0;
pub const EDGE_PAN_SOFT_MAX_PX: f64 = 220.0;

pub fn edge_soft_zone_px(crop_w: f64, crop_h: f64) -> f64 {
    (crop_w.min(crop_h) * EDGE_PAN_SOFT_FRAC).clamp(EDGE_PAN_SOFT_MIN_PX, EDGE_PAN_SOFT_MAX_PX)
}

/// Viewport center limits for the current zoom/orientation on a monitor.
pub fn viewport_center_bounds(vp: &Viewport, src_w: u32, src_h: u32) -> (f64, f64, f64, f64) {
    let (out_w, out_h) = output_dims(vp.orientation, 1080);
    let layout = frame_layout(vp, src_w, src_h, out_w, out_h);
    center_bounds(
        layout.crop.w,
        layout.crop.h,
        src_w as f64,
        src_h as f64,
    )
}

/// Per-axis scale for movement toward that axis's boundary only.
fn edge_pan_axis_scale(pos: f64, delta: f64, min: f64, max: f64, soft_px: f64) -> f64 {
    if delta < -f64::EPSILON {
        edge_pan_speed_scale(pos - min, soft_px)
    } else if delta > f64::EPSILON {
        edge_pan_speed_scale(max - pos, soft_px)
    } else {
        1.0
    }
}

fn edge_pan_speed_scale(margin_px: f64, soft_px: f64) -> f64 {
    if margin_px >= soft_px {
        1.0
    } else if margin_px <= 0.0 {
        0.0
    } else {
        smoothstep(0.0, soft_px, margin_px)
    }
}

/// Apply edge softening to a proposed pan step; each axis slows independently so the
/// frame can glide along an edge while only the into-edge component eases off.
pub fn apply_edge_soft_pan(
    cx: f64,
    cy: f64,
    nx: f64,
    ny: f64,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    soft_px: f64,
) -> (f64, f64) {
    let dx = nx - cx;
    let dy = ny - cy;
    if dx.abs() <= f64::EPSILON && dy.abs() <= f64::EPSILON {
        return (clamp(cx, min_x, max_x), clamp(cy, min_y, max_y));
    }
    let scale_x = edge_pan_axis_scale(cx, dx, min_x, max_x, soft_px);
    let scale_y = edge_pan_axis_scale(cy, dy, min_y, max_y, soft_px);
    (
        clamp(cx + dx * scale_x, min_x, max_x),
        clamp(cy + dy * scale_y, min_y, max_y),
    )
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

/// Like `smooth_toward`, but caps how fast `current` may change (units per second).
pub fn smooth_toward_capped(
    current: f64,
    target: f64,
    rate_hz: f64,
    dt_secs: f64,
    max_rate_per_sec: f64,
) -> f64 {
    if dt_secs <= 0.0 {
        return current;
    }
    let next = smooth_toward(current, target, rate_hz, dt_secs);
    let max_step = max_rate_per_sec * dt_secs;
    let step = next - current;
    if step.abs() <= max_step {
        next
    } else {
        current + step.signum() * max_step
    }
}

/// Soft-zone follow speed: crawl near the cursor, ramp to full speed farther out.
pub fn pan_follow_speed_scale(dist_px: f64, inner_px: f64, outer_px: f64, inner_scale: f64) -> f64 {
    if dist_px <= inner_px {
        inner_scale
    } else if dist_px >= outer_px {
        1.0
    } else {
        let t = smoothstep(inner_px, outer_px, dist_px);
        lerp(inner_scale, 1.0, t)
    }
}

/// Max pan speed (monitor px/s) scaled by zoom — tighter crop allows a higher cap.
pub fn pan_max_speed_for_zoom(zoom: f64, base_at_zoom_1: f64, wide_scale: f64, tight_scale: f64) -> f64 {
    let z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    let t = smoothstep(ZOOM_MIN, ZOOM_MAX, z);
    base_at_zoom_1 * lerp(wide_scale, tight_scale, t)
}

/// Max zoom velocity (units/s) scaled by zoom level — slower when wide, faster when tight.
pub fn zoom_max_vel_for_level(zoom: f64, base_at_zoom_1: f64, min_scale: f64, max_scale: f64) -> f64 {
    let z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    if z <= 1.0 {
        let t = smoothstep(ZOOM_MIN, 1.0, z);
        base_at_zoom_1 * lerp(min_scale, 1.0, t)
    } else {
        let t = smoothstep(1.0, ZOOM_MAX, z);
        base_at_zoom_1 * lerp(1.0, max_scale, t)
    }
}

/// Pan the viewport center toward the cursor with soft-zone easing and a velocity cap.
pub fn advance_pan_follow(
    cx: f64,
    cy: f64,
    tx: f64,
    ty: f64,
    rate_hz: f64,
    dt_secs: f64,
    soft_inner_px: f64,
    soft_outer_px: f64,
    inner_speed_scale: f64,
    max_speed_px_per_sec: f64,
) -> (f64, f64) {
    if dt_secs <= 0.0 {
        return (cx, cy);
    }

    let dx = tx - cx;
    let dy = ty - cy;
    let dist = (dx * dx + dy * dy).sqrt();
    if dist <= f64::EPSILON {
        return (cx, cy);
    }

    let speed_scale = pan_follow_speed_scale(dist, soft_inner_px, soft_outer_px, inner_speed_scale);
    let eff_rate = rate_hz * speed_scale;
    let eff_max = max_speed_px_per_sec * speed_scale;

    let mut nx = smooth_toward(cx, tx, eff_rate, dt_secs);
    let mut ny = smooth_toward(cy, ty, eff_rate, dt_secs);

    let step_x = nx - cx;
    let step_y = ny - cy;
    let step_len = (step_x * step_x + step_y * step_y).sqrt();
    let max_step = eff_max * dt_secs;
    if step_len > max_step && step_len > f64::EPSILON {
        let s = max_step / step_len;
        nx = cx + step_x * s;
        ny = cy + step_y * s;
    }

    (nx, ny)
}

/// Crop + output placement for the current viewport zoom level.
pub fn frame_layout(vp: &Viewport, src_w: u32, src_h: u32, out_w: u32, out_h: u32) -> FrameLayout {
    let sw = src_w as f64;
    let sh = src_h as f64;
    let ow = out_w as f64;
    let oh = out_h as f64;
    let aspect = vp.orientation.aspect();
    let zoom = clamp_zoom(vp.zoom, vp.orientation);

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edge_pan_glides_along_left_boundary() {
        let (nx, ny) = apply_edge_soft_pan(100.0, 400.0, 80.0, 520.0, 100.0, 900.0, 100.0, 800.0, 80.0);
        assert_eq!(nx, 100.0);
        assert!((ny - 520.0).abs() < f64::EPSILON);
    }

    #[test]
    fn edge_pan_resumes_when_cursor_moves_away_from_edge() {
        let (nx, ny) = apply_edge_soft_pan(100.0, 400.0, 180.0, 400.0, 100.0, 900.0, 100.0, 800.0, 80.0);
        assert!((nx - 180.0).abs() < f64::EPSILON);
        assert_eq!(ny, 400.0);
    }

    #[test]
    fn edge_pan_slows_near_left_boundary() {
        let (nx, ny) = apply_edge_soft_pan(120.0, 400.0, 20.0, 400.0, 100.0, 900.0, 100.0, 800.0, 80.0);
        assert!(nx > 100.0);
        assert!(nx < 120.0);
        assert_eq!(ny, 400.0);
    }

    #[test]
    fn edge_pan_full_speed_away_from_boundary() {
        let (nx, ny) = apply_edge_soft_pan(300.0, 400.0, 360.0, 400.0, 100.0, 900.0, 100.0, 800.0, 80.0);
        assert!((nx - 360.0).abs() < f64::EPSILON);
        assert_eq!(ny, 400.0);
    }

    #[test]
    fn pan_follow_speed_scale_ramps_in_soft_zone() {
        assert_eq!(pan_follow_speed_scale(20.0, 40.0, 160.0, 0.15), 0.15);
        assert_eq!(pan_follow_speed_scale(200.0, 40.0, 160.0, 0.15), 1.0);
        let mid = pan_follow_speed_scale(100.0, 40.0, 160.0, 0.15);
        assert!(mid > 0.15 && mid < 1.0);
    }

    #[test]
    fn pan_follow_caps_velocity_on_large_jump() {
        let (nx, _ny) = advance_pan_follow(0.0, 0.0, 2000.0, 0.0, 11.0, 1.0 / 60.0, 40.0, 160.0, 0.15, 300.0);
        assert!(nx <= 300.0 / 60.0 + 1.0);
    }

    #[test]
    fn zoom_max_vel_scales_with_zoom_level() {
        let wide = zoom_max_vel_for_level(ZOOM_MIN, 0.55, 0.82, 2.6);
        let mid = zoom_max_vel_for_level(1.0, 0.55, 0.82, 2.6);
        let tight = zoom_max_vel_for_level(ZOOM_MAX, 0.55, 0.82, 2.6);
        assert!(wide < mid);
        assert!(tight > mid);
        assert!((mid - 0.55).abs() < f64::EPSILON);
    }

    #[test]
    fn pan_follow_barely_moves_inside_soft_inner() {
        let (nx, ny) = advance_pan_follow(100.0, 100.0, 120.0, 110.0, 11.0, 1.0 / 60.0, 40.0, 160.0, 0.15, 380.0);
        let moved = (nx - 100.0).hypot(ny - 100.0);
        assert!(moved < 2.0);
    }

    #[test]
    fn smooth_toward_capped_limits_zoom_step() {
        let next = smooth_toward_capped(1.0, 3.0, 3.0, 1.0 / 60.0, 0.5);
        assert!((next - 1.0).abs() <= 0.5 / 60.0 + 1e-9);
    }
}
