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

/// 1D One Euro filter (Casiez et al.) — adaptive low-pass keyed on signal speed.
pub struct OneEuro1d {
    min_cutoff: f64,
    beta: f64,
    d_cutoff: f64,
    x_prev: Option<f64>,
    dx_prev: f64,
    t_prev: Option<f64>,
}

impl OneEuro1d {
    pub fn new(min_cutoff: f64, beta: f64) -> Self {
        Self {
            min_cutoff,
            beta,
            d_cutoff: 1.0,
            x_prev: None,
            dx_prev: 0.0,
            t_prev: None,
        }
    }

    fn alpha(dt: f64, cutoff: f64) -> f64 {
        let tau = 1.0 / (2.0 * std::f64::consts::PI * cutoff);
        1.0 / (1.0 + tau / dt.max(1.0 / 2000.0))
    }

    pub fn filter(&mut self, x: f64, t: f64) -> f64 {
        match (self.x_prev, self.t_prev) {
            (Some(x_prev), Some(t_prev)) => {
                let dt = (t - t_prev).max(1.0 / 2000.0);
                let dx = (x - x_prev) / dt;
                let a_d = Self::alpha(dt, self.d_cutoff);
                let dx_hat = a_d * dx + (1.0 - a_d) * self.dx_prev;
                let cutoff = self.min_cutoff + self.beta * dx_hat.abs();
                let a = Self::alpha(dt, cutoff);
                let x_hat = a * x + (1.0 - a) * x_prev;
                self.dx_prev = dx_hat;
                self.x_prev = Some(x_hat);
                self.t_prev = Some(t);
                x_hat
            }
            _ => {
                self.x_prev = Some(x);
                self.t_prev = Some(t);
                x
            }
        }
    }

    pub fn reset(&mut self) {
        self.x_prev = None;
        self.dx_prev = 0.0;
        self.t_prev = None;
    }
}

/// Pair of One Euro filters for 2D pointer paths.
pub struct OneEuro2d {
    x: OneEuro1d,
    y: OneEuro1d,
}

impl OneEuro2d {
    pub fn new(min_cutoff: f64, beta: f64) -> Self {
        Self {
            x: OneEuro1d::new(min_cutoff, beta),
            y: OneEuro1d::new(min_cutoff, beta),
        }
    }

    pub fn filter(&mut self, px: f64, py: f64, t: f64) -> (f64, f64) {
        (self.x.filter(px, t), self.y.filter(py, t))
    }

    pub fn reset(&mut self) {
        self.x.reset();
        self.y.reset();
    }
}

/// Minimum zoom — entire desktop letterboxed in portrait output.
pub const ZOOM_MIN: f64 = 0.45;
pub const ZOOM_MIN_LANDSCAPE: f64 = 1.0;
pub const ZOOM_MAX: f64 = 4.0;
/// Snap to exactly full 9:16 when within this band of 1.0.
pub const ZOOM_SNAP_EPS: f64 = 0.035;
/// Virtual micro-steps per physical wheel notch — one notch = one buttery ease.
pub const ZOOM_TICKS_PER_NOTCH: f64 = 13.0;
/// Total multiplicative zoom per notch at sensitivity 1.0 (~16%).
const ZOOM_NOTCH_FACTOR_AT_1: f64 = 1.16;

pub fn ease_in_out_cubic(t: f64) -> f64 {
    let t = clamp(t, 0.0, 1.0);
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}

/// Per-tick multiplicative factor — 13 ticks compose one wheel notch.
pub fn zoom_per_tick_factor(sensitivity: f64) -> f64 {
    let sens = clamp(sensitivity, 0.2, 3.0);
    let notch = 1.0 + (ZOOM_NOTCH_FACTOR_AT_1 - 1.0) * sens;
    notch.powf(1.0 / ZOOM_TICKS_PER_NOTCH)
}

/// Zoom level after `ticks` virtual steps from `anchor` (signed ticks = in/out).
pub fn zoom_from_gesture_ticks(
    anchor: f64,
    ticks: f64,
    sensitivity: f64,
    orientation: crate::state::Orientation,
) -> f64 {
    if ticks.abs() < f64::EPSILON {
        return clamp_zoom(anchor, orientation);
    }
    let raw = anchor * zoom_per_tick_factor(sensitivity).powf(ticks);
    clamp_zoom(raw, orientation)
}

pub fn promo_inner_start_zoom(orientation: crate::state::Orientation) -> f64 {
    match orientation {
        crate::state::Orientation::Portrait => 1.16,
        crate::state::Orientation::Landscape => 1.0 + 0.75 * (ZOOM_MAX - 1.0),
    }
}

/// Pull zoom toward canonical full-frame levels (desktop letterbox, 9:16, max).
pub fn magnet_zoom_target(z: f64, orientation: crate::state::Orientation) -> f64 {
    let z = clamp_zoom(z, orientation);
    let min = zoom_min_for(orientation);
    if (z - min).abs() <= ZOOM_SNAP_EPS {
        return min;
    }
    if (z - 1.0).abs() <= ZOOM_SNAP_EPS {
        return 1.0;
    }
    if (z - ZOOM_MAX).abs() <= ZOOM_SNAP_EPS {
        return ZOOM_MAX;
    }
    z
}

/// Ease duration (seconds) — scales with gesture length for multi-notch bursts.
pub fn zoom_gesture_duration_secs(from: f64, to: f64, total_ticks: f64) -> f64 {
    let tick_secs = 0.034;
    let base = 0.38;
    let tick_part = total_ticks.abs() * tick_secs;
    let dist_part = 0.28 + (to - from).abs() * 1.05;
    (base + tick_part).max(dist_part).clamp(0.52, 3.4)
}

/// Slower ease when gliding into a canonical full-frame zoom (9:16 / desktop / landscape).
pub const CANONICAL_ZOOM_EASE_SECS: f64 = 1.05;

/// Fraction of an ease segment used as the canonical soft ramp (like edge pan crop fraction).
pub const ZOOM_CANONICAL_SOFT_FRAC: f64 = 0.68;
pub const ZOOM_CANONICAL_SOFT_MIN: f64 = 0.16;
pub const ZOOM_CANONICAL_SOFT_MAX: f64 = 0.44;

/// Canonical zoom stops for the current orientation.
pub fn zoom_canonical_levels(orientation: crate::state::Orientation) -> &'static [f64] {
    match orientation {
        crate::state::Orientation::Portrait => &[ZOOM_MIN, 1.0, ZOOM_MAX][..],
        crate::state::Orientation::Landscape => &[ZOOM_MIN_LANDSCAPE, ZOOM_MAX][..],
    }
}

/// Soft-zone width for canonical zoom decel — scales with the active ease span.
pub fn zoom_canonical_soft_zone_width(segment_span: f64) -> f64 {
    (segment_span * ZOOM_CANONICAL_SOFT_FRAC).clamp(ZOOM_CANONICAL_SOFT_MIN, ZOOM_CANONICAL_SOFT_MAX)
}

/// True when a gesture target crosses or lands on a canonical zoom stop.
pub fn crosses_canonical_zoom(prev: f64, next: f64, orientation: crate::state::Orientation) -> Option<f64> {
    for &level in zoom_canonical_levels(orientation) {
        if (prev - level) * (next - level) < 0.0 {
            return Some(level);
        }
        if (next - level).abs() <= ZOOM_SNAP_EPS {
            return Some(level);
        }
    }
    None
}

/// Per-step scale when moving toward a canonical level — same curve as edge pan.
pub fn zoom_canonical_step_scale(
    current: f64,
    step: f64,
    toward: f64,
    orientation: crate::state::Orientation,
    segment_span: f64,
) -> f64 {
    if step.abs() <= f64::EPSILON {
        return 1.0;
    }
    let soft = zoom_canonical_soft_zone_width(segment_span);
    let mut scale = 1.0f64;
    for &level in zoom_canonical_levels(orientation) {
        let offset = level - current;
        let easing_to_level = (toward - level).abs() <= ZOOM_SNAP_EPS;
        if easing_to_level && offset.abs() <= f64::EPSILON {
            scale = scale.min(SOFT_APPROACH_FLOOR);
            continue;
        }
        if step * offset <= f64::EPSILON {
            continue;
        }
        let level_on_path = (level - current) * (toward - current) > f64::EPSILON;
        if !easing_to_level && !level_on_path {
            continue;
        }
        let margin = offset.abs();
        scale = scale.min(soft_approach_speed_scale(margin, soft));
    }
    scale
}

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

/// Minimum retained speed at a boundary — shared by edge pan and canonical zoom.
pub const SOFT_APPROACH_FLOOR: f64 = 0.11;

/// Used by seat-creep convergence test — margin band where per-tick cap tightens.
const EDGE_SEAT_CREEP_PX: f64 = 28.0;

/// Ramp from a crawl floor at a boundary to full speed outside the soft zone.
pub fn soft_approach_speed_scale(margin: f64, soft: f64) -> f64 {
    if soft <= 0.0 {
        return 1.0;
    }
    if margin >= soft {
        1.0
    } else if margin <= 0.0 {
        SOFT_APPROACH_FLOOR
    } else {
        let t = smoothstep(0.0, soft, margin);
        SOFT_APPROACH_FLOOR + (1.0 - SOFT_APPROACH_FLOOR) * t
    }
}

fn edge_into_margin(pos: f64, delta: f64, min: f64, max: f64) -> Option<f64> {
    if delta > f64::EPSILON {
        Some(max - pos)
    } else if delta < -f64::EPSILON {
        Some(pos - min)
    } else {
        None
    }
}

/// Coupled 2D step scales — diagonal corner approach shares one scale from the tighter margin
/// so independent per-axis slowdown does not compound into a crawl.
fn edge_coupled_step_scales(
    cx: f64,
    cy: f64,
    dx: f64,
    dy: f64,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    soft_px: f64,
) -> (f64, f64) {
    let mx = edge_into_margin(cx, dx, min_x, max_x);
    let my = edge_into_margin(cy, dy, min_y, max_y);
    let scale_x = mx
        .map(|m| soft_approach_speed_scale(m, soft_px))
        .unwrap_or(1.0);
    let scale_y = my
        .map(|m| soft_approach_speed_scale(m, soft_px))
        .unwrap_or(1.0);

    if let (Some(mx), Some(my)) = (mx, my) {
        if mx < soft_px && my < soft_px {
            // Pace the diagonal by the looser axis — avoids compounding two independent crawls.
            let coupled = soft_approach_speed_scale(mx.max(my), soft_px);
            return (coupled, coupled);
        }
    }
    (scale_x, scale_y)
}

/// Limit how much of the remaining margin one tick may consume inside the soft zone.
fn cap_into_margin_step(step: f64, margin: f64, soft_px: f64) -> f64 {
    if margin >= soft_px || step.abs() <= f64::EPSILON {
        return step;
    }
    let t = 1.0 - (margin / soft_px).clamp(0.0, 1.0);
    let max_frac = 0.52 + 0.43 * smoothstep(0.0, 1.0, t);
    let max_step = margin * max_frac;
    if step.abs() <= max_step {
        step
    } else {
        step.signum() * max_step
    }
}

fn apply_axis_edge_step(
    pos: f64,
    delta: f64,
    min: f64,
    max: f64,
    scale: f64,
    soft_px: f64,
) -> f64 {
    if delta.abs() <= f64::EPSILON {
        return clamp(pos, min, max);
    }
    let margin = if delta > f64::EPSILON {
        max - pos
    } else {
        pos - min
    };
    if margin <= 0.0 {
        return if delta > f64::EPSILON { max } else { min };
    }

    let step = cap_into_margin_step(delta * scale, margin, soft_px);
    clamp(pos + step, min, max)
}

/// Apply edge softening to a proposed pan step. Glide along one edge at full speed;
/// ease into a single bound; couple both axes when gliding diagonally into a corner.
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

    let (sx, sy) = edge_coupled_step_scales(
        cx, cy, dx, dy, min_x, max_x, min_y, max_y, soft_px,
    );

    let out_x = apply_axis_edge_step(cx, dx, min_x, max_x, sx, soft_px);
    let out_y = apply_axis_edge_step(cy, dy, min_y, max_y, sy, soft_px);

    (out_x, out_y)
}

/// Pull the viewport center inside shrinking bounds (e.g. while easing to a canonical zoom).
pub fn converge_center_to_bounds(
    cx: f64,
    cy: f64,
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    rate_hz: f64,
    dt_secs: f64,
) -> (f64, f64) {
    if dt_secs <= 0.0 {
        return (cx, cy);
    }
    let tx = clamp(cx, min_x, max_x);
    let ty = clamp(cy, min_y, max_y);
    if (tx - cx).abs() <= f64::EPSILON && (ty - cy).abs() <= f64::EPSILON {
        return (cx, cy);
    }
    (
        smooth_toward(cx, tx, rate_hz, dt_secs),
        smooth_toward(cy, ty, rate_hz, dt_secs),
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

/// Tunable pan-follow parameters derived from Studio input settings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PanFollowProfile {
    pub smooth_hz: f64,
    pub smooth_hz_alt: f64,
    pub soft_inner_px: f64,
    pub soft_outer_px: f64,
    pub soft_inner_scale: f64,
    pub max_speed_mult: f64,
    pub euro_min_cutoff: f64,
    pub euro_beta: f64,
    pub bounds_converge_hz: f64,
}

/// Default cinematic follow — matches pre-settings baseline.
pub fn pan_follow_profile_default() -> PanFollowProfile {
    PanFollowProfile {
        smooth_hz: 5.2,
        smooth_hz_alt: 5.8,
        soft_inner_px: 55.0,
        soft_outer_px: 340.0,
        soft_inner_scale: 0.32,
        max_speed_mult: 1.0,
        euro_min_cutoff: 0.85,
        euro_beta: 0.035,
        bounds_converge_hz: 17.0,
    }
}

/// Portrait game mode cursor pan — slightly slower than the first game-mode tuning.
pub fn pan_follow_profile_game() -> PanFollowProfile {
    PanFollowProfile {
        smooth_hz: 11.0,
        smooth_hz_alt: 12.5,
        soft_inner_px: 24.0,
        soft_outer_px: 120.0,
        soft_inner_scale: 0.62,
        max_speed_mult: 2.35,
        euro_min_cutoff: 3.0,
        euro_beta: 0.11,
        bounds_converge_hz: 28.0,
    }
}

/// Map Studio follow-speed slider to live pan-follow tuning.
pub fn pan_follow_profile(follow_speed: f64) -> PanFollowProfile {
    let base = pan_follow_profile_default();
    let speed = follow_speed.clamp(0.75, 1.25);
    let t = (speed - 1.0) / 0.25;
    PanFollowProfile {
        smooth_hz: base.smooth_hz * (1.0 + t * 0.11),
        smooth_hz_alt: base.smooth_hz_alt * (1.0 + t * 0.11),
        soft_inner_px: base.soft_inner_px * (1.0 - t * 0.07),
        soft_outer_px: base.soft_outer_px * (1.0 - t * 0.10),
        soft_inner_scale: base.soft_inner_scale * (1.0 + t * 0.10),
        max_speed_mult: 1.0 + t * 0.09,
        euro_min_cutoff: base.euro_min_cutoff * (1.0 + t * 0.08),
        euro_beta: base.euro_beta * (1.0 + t * 0.12),
        bounds_converge_hz: base.bounds_converge_hz * (1.0 + t * 0.08),
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

/// Short-edge quality tiers (the 9-side of the target aspect).
pub const QUALITY_720: u32 = 720;
pub const QUALITY_1080: u32 = 1080;
/// Landscape-only — 2560×1440 (16×9).
pub const QUALITY_1440: u32 = 1440;
/// Landscape-only — 3840×2160 (16×9 UHD).
pub const QUALITY_2160: u32 = 2160;

/// Snap UI/API quality to a supported tier. 1440p/4K are landscape-only.
pub fn normalize_quality(quality: u32, orientation: crate::state::Orientation) -> u32 {
    if quality >= 1900 && orientation == crate::state::Orientation::Landscape {
        QUALITY_2160
    } else if quality >= 1400 && orientation == crate::state::Orientation::Landscape {
        QUALITY_1440
    } else if quality > 900 {
        QUALITY_1080
    } else {
        QUALITY_720
    }
}

/// Pixel load (width × height × fps) for encoder / queue tiering.
pub fn pixel_load(width: u32, height: u32, fps: u32) -> u64 {
    width as u64 * height as u64 * fps.max(1) as u64
}

/// Output dimensions for the recording. `short_edge` is the quality tier (720,
/// 1080, 1440, or 2160 landscape-only). The long (16-) side is derived for an
/// exact standard resolution — e.g. 2160 landscape → 3840×2160.
pub fn output_dims(o: Orientation, short_edge: u32) -> (u32, u32) {
    let short = normalize_quality(short_edge, o);
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
    fn edge_pan_corner_coupled_faster_than_independent() {
        let soft = 80.0;
        let max_y = 800.0;
        let cy = max_y - 18.0;
        let cx = 872.0;
        let max_x = 900.0;
        let dx = 28.0;
        let dy = 15.0;
        let (coupled_x, coupled_y) =
            apply_edge_soft_pan(cx, cy, cx + dx, cy + dy, 100.0, max_x, 100.0, max_y, soft);
        let margin_x = max_x - cx;
        let margin_y = max_y - cy;
        let independent_x = dx * soft_approach_speed_scale(margin_x, soft);
        let independent_y = dy * soft_approach_speed_scale(margin_y, soft);
        let coupled_len = (coupled_x - cx).hypot(coupled_y - cy);
        let independent_len = independent_x.hypot(independent_y);
        assert!(
            coupled_len > independent_len * 1.05,
            "coupled {coupled_len}, independent {independent_len}"
        );
    }

    #[test]
    fn edge_pan_seat_creep_reaches_bound_without_large_jump() {
        let soft = 80.0;
        let min_x = 100.0;
        let mut cx: f64 = 118.0;
        let mut max_step = 0.0f64;
        for _ in 0..96 {
            if (cx - min_x).abs() <= 0.08 {
                break;
            }
            let margin = cx - min_x;
            let proposed = cx - 3.0;
            let (nx, _) =
                apply_edge_soft_pan(cx, 400.0, proposed, 400.0, min_x, 900.0, 100.0, 800.0, soft);
            if margin <= EDGE_SEAT_CREEP_PX {
                max_step = max_step.max((nx - cx).abs());
            }
            cx = nx;
        }
        assert!((cx - min_x).abs() <= 0.08);
        assert!(max_step < 3.5, "max creep step {max_step}");
    }

    #[test]
    fn edge_pan_single_edge_no_hard_snap() {
        let soft = 80.0;
        let min_x = 100.0;
        let cx = 100.35;
        let (nx, _) = apply_edge_soft_pan(cx, 400.0, 20.0, 400.0, min_x, 900.0, 100.0, 800.0, soft);
        assert!(nx > min_x);
        assert!(nx < cx);
    }

    #[test]
    fn pan_follow_profile_marginal_follow_speed() {
        let slow = pan_follow_profile(0.75);
        let def = pan_follow_profile(1.0);
        let fast = pan_follow_profile(1.25);
        assert!(slow.smooth_hz < def.smooth_hz);
        assert!(fast.smooth_hz > def.smooth_hz);
        assert!(slow.max_speed_mult < fast.max_speed_mult);
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
    fn zoom_gesture_thirteen_ticks_approx_one_notch() {
        use crate::state::Orientation;
        let z = zoom_from_gesture_ticks(1.0, ZOOM_TICKS_PER_NOTCH, 1.0, Orientation::Portrait);
        assert!((z - ZOOM_NOTCH_FACTOR_AT_1).abs() < 0.006);
    }

    #[test]
    fn zoom_gesture_reversal_halves_travel() {
        use crate::state::Orientation;
        let z = zoom_from_gesture_ticks(1.0, ZOOM_TICKS_PER_NOTCH * 2.0, 1.0, Orientation::Portrait);
        let corrected = zoom_from_gesture_ticks(1.0, ZOOM_TICKS_PER_NOTCH, 1.0, Orientation::Portrait);
        assert!(z > corrected);
        assert!((z / corrected - ZOOM_NOTCH_FACTOR_AT_1).abs() < 0.01);
    }

    #[test]
    fn magnet_snaps_to_full_nine_sixteen() {
        use crate::state::Orientation;
        assert_eq!(magnet_zoom_target(1.02, Orientation::Portrait), 1.0);
        assert_eq!(magnet_zoom_target(0.47, Orientation::Portrait), ZOOM_MIN);
    }

    #[test]
    fn zoom_canonical_soft_slows_near_full_nine_sixteen() {
        use crate::state::Orientation;
        let span = 0.2;
        let scale = zoom_canonical_step_scale(1.08, -0.02, 1.0, Orientation::Portrait, span);
        assert!(scale < 0.58, "scale was {scale}");
        assert!(scale > 0.08);
        let far = zoom_canonical_step_scale(1.35, -0.02, 1.0, Orientation::Portrait, span);
        assert!((far - 1.0).abs() < 0.01);
        let at_level = zoom_canonical_step_scale(1.0, -0.01, 1.0, Orientation::Portrait, span);
        assert!(
            (at_level - SOFT_APPROACH_FLOOR).abs() < 0.02,
            "scale was {at_level}"
        );
    }

    #[test]
    fn zoom_canonical_soft_slows_near_desktop_min() {
        use crate::state::Orientation;
        let scale = zoom_canonical_step_scale(0.52, -0.02, ZOOM_MIN, Orientation::Portrait, 0.18);
        assert!(scale < 0.55, "scale was {scale}");
    }

    #[test]
    fn crosses_canonical_zoom_detects_full_frame() {
        use crate::state::Orientation;
        assert_eq!(crosses_canonical_zoom(0.96, 1.04, Orientation::Portrait), Some(1.0));
        assert_eq!(crosses_canonical_zoom(1.2, 1.02, Orientation::Portrait), Some(1.0));
        assert_eq!(crosses_canonical_zoom(1.2, 1.15, Orientation::Portrait), None);
    }

    #[test]
    fn smooth_toward_capped_limits_zoom_step() {
        let next = smooth_toward_capped(1.0, 3.0, 3.0, 1.0 / 60.0, 0.5);
        assert!((next - 1.0).abs() <= 0.5 / 60.0 + 1e-9);
    }

    #[test]
    fn output_dims_landscape_1440p() {
        assert_eq!(output_dims(Orientation::Landscape, 1440), (2560, 1440));
    }

    #[test]
    fn normalize_quality_1440_landscape_only() {
        use crate::state::Orientation;
        assert_eq!(normalize_quality(1440, Orientation::Landscape), 1440);
        assert_eq!(normalize_quality(1440, Orientation::Portrait), 1080);
    }

    #[test]
    fn output_dims_landscape_4k() {
        assert_eq!(output_dims(Orientation::Landscape, 2160), (3840, 2160));
    }

    #[test]
    fn normalize_quality_2160_landscape_only() {
        use crate::state::Orientation;
        assert_eq!(normalize_quality(2160, Orientation::Landscape), 2160);
        assert_eq!(normalize_quality(2160, Orientation::Portrait), 1080);
        assert_eq!(normalize_quality(2000, Orientation::Landscape), 2160);
    }
}
