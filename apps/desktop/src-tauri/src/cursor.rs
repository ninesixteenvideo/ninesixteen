//! Cinematic cursor — track pointer samples and stamp a sprite per CFR slot.

#[cfg(windows)]
mod imp {
    use crate::geometry::{frame_layout, FrameLayout};
    use crate::state::{AppState, SharedState, Viewport};
    use image::imageops::FilterType;
    use image::RgbaImage;
    use parking_lot::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, OnceLock};
    use std::time::Instant;

    /// Follow-thread gate — avoids locking `state` while `viewport` is held (AB-BA deadlock).
    static FOLLOW_CAPTURE: AtomicBool = AtomicBool::new(false);
    static SESSION_START: Mutex<Option<Instant>> = Mutex::new(None);

    const RING_CAP: usize = 512;
    const CURSOR_PNG: &[u8] = include_bytes!("../resources/cursor/default.png");

    struct CursorSprite {
        rgba: RgbaImage,
        hotspot_x: u32,
        hotspot_y: u32,
    }

    struct ScaledCache {
        w: u32,
        h: u32,
        rgba: Arc<RgbaImage>,
    }

    static SPRITE: OnceLock<CursorSprite> = OnceLock::new();
    static SCALE_CACHE: Mutex<Option<ScaledCache>> = Mutex::new(None);

    fn strip_matte(rgba: &mut RgbaImage) {
        for p in rgba.pixels_mut() {
            let [r, g, b, a] = p.0;
            if a < 8 || (r < 24 && g < 24 && b < 24) {
                p.0 = [0, 0, 0, 0];
            }
        }
    }

    fn prepare_sprite_rgba(mut rgba: RgbaImage) -> RgbaImage {
        strip_matte(&mut rgba);
        rgba
    }

    /// Hotspot at the top-left tip of the arrow (min x+y among opaque pixels).
    fn hotspot_for(rgba: &RgbaImage) -> (u32, u32) {
        let mut best = u32::MAX;
        let mut hx = 0u32;
        let mut hy = 0u32;
        for y in 0..rgba.height() {
            for x in 0..rgba.width() {
                if rgba.get_pixel(x, y)[3] > 128 {
                    let score = x + y;
                    if score < best {
                        best = score;
                        hx = x;
                        hy = y;
                    }
                }
            }
        }
        (hx, hy)
    }

    fn sprite() -> &'static CursorSprite {
        SPRITE.get_or_init(|| {
            let raw = image::load_from_memory(CURSOR_PNG)
                .map(|img| img.to_rgba8())
                .unwrap_or_else(|_| RgbaImage::new(1, 1));
            let rgba = prepare_sprite_rgba(raw);
            let (hotspot_x, hotspot_y) = hotspot_for(&rgba);
            CursorSprite {
                rgba,
                hotspot_x,
                hotspot_y,
            }
        })
    }

    #[derive(Clone, Copy, Debug)]
    struct Sample {
        t_secs: f64,
        x: f64,
        y: f64,
        buttons: u8,
    }

    struct Ring {
        slots: [Option<Sample>; RING_CAP],
        head: usize,
        len: usize,
        latest: Option<(f64, f64, u8)>,
    }

    impl Ring {
        fn new() -> Self {
            Self {
                slots: [None; RING_CAP],
                head: 0,
                len: 0,
                latest: None,
            }
        }

        fn push(&mut self, t_secs: f64, x: f64, y: f64, buttons: u8) {
            self.slots[self.head] = Some(Sample {
                t_secs,
                x,
                y,
                buttons,
            });
            self.head = (self.head + 1) % RING_CAP;
            self.len = (self.len + 1).min(RING_CAP);
            self.latest = Some((x, y, buttons));
        }

        fn sample_at(&self, t_secs: f64) -> Option<(f64, f64, u8)> {
            if self.len == 0 {
                return self.latest.map(|(x, y, b)| (x, y, b));
            }
            let mut best_before: Option<Sample> = None;
            let mut best_after: Option<Sample> = None;
            for slot in self.slots.iter().flatten() {
                if slot.t_secs <= t_secs {
                    if best_before.map(|b| slot.t_secs > b.t_secs).unwrap_or(true) {
                        best_before = Some(*slot);
                    }
                } else if best_after.map(|a| slot.t_secs < a.t_secs).unwrap_or(true) {
                    best_after = Some(*slot);
                }
            }
            match (best_before, best_after) {
                (Some(a), Some(b)) if b.t_secs > a.t_secs => {
                    let span = b.t_secs - a.t_secs;
                    let f = if span > f64::EPSILON {
                        ((t_secs - a.t_secs) / span).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    Some((
                        a.x + (b.x - a.x) * f,
                        a.y + (b.y - a.y) * f,
                        if f > 0.5 { b.buttons } else { a.buttons },
                    ))
                }
                (Some(a), _) => Some((a.x, a.y, a.buttons)),
                (_, Some(b)) => Some((b.x, b.y, b.buttons)),
                _ => self.latest.map(|(x, y, b)| (x, y, b)),
            }
        }
    }

    static RING: OnceLock<Mutex<Ring>> = OnceLock::new();

    fn ring() -> &'static Mutex<Ring> {
        RING.get_or_init(|| Mutex::new(Ring::new()))
    }

    pub fn cinematic_enabled(state: &SharedState) -> bool {
        let st = state.lock();
        st.recording_settings.capture_cursor && st.recording_settings.cinematic_cursor
    }

    pub fn reset_session() {
        let mut r = ring().lock();
        r.slots = [None; RING_CAP];
        r.head = 0;
        r.len = 0;
    }

    /// Call whenever recording/arming/cinematic settings change (never from follow thread).
    pub fn sync_follow_gate_from_state(st: &AppState) {
        let on = st.recording_settings.capture_cursor
            && st.recording_settings.cinematic_cursor
            && (st.recording || st.recording_armed);
        FOLLOW_CAPTURE.store(on, Ordering::Release);
        let session = if st.recording {
            st.session_start.or(st.current_start)
        } else {
            None
        };
        *SESSION_START.lock() = session;
    }

    /// Hot-path sample from cursor-follow thread — no `state` lock.
    pub fn record_follow_sample(x: f64, y: f64, buttons: u8) {
        if !FOLLOW_CAPTURE.load(Ordering::Acquire) {
            return;
        }
        let session = *SESSION_START.lock();
        record_sample(session, x, y, buttons);
    }

    pub fn record_sample(session_start: Option<Instant>, x: f64, y: f64, buttons: u8) {
        let t_secs = session_start
            .map(|s| s.elapsed().as_secs_f64())
            .unwrap_or(0.0);
        ring().lock().push(t_secs, x, y, buttons);
    }

    pub fn latest_monitor_pos() -> Option<(f64, f64)> {
        ring().lock().latest.map(|(x, y, _)| (x, y))
    }

    fn sample_at(t_secs: f64) -> Option<(f64, f64, u8)> {
        ring().lock().sample_at(t_secs)
    }

    fn monitor_to_output(mx: f64, my: f64, layout: &FrameLayout) -> Option<(f64, f64)> {
        let crop = layout.crop;
        if crop.w <= f64::EPSILON || crop.h <= f64::EPSILON {
            return None;
        }
        let rel_x = (mx - crop.x) / crop.w;
        let rel_y = (my - crop.y) / crop.h;
        if !(0.0..=1.0).contains(&rel_x) || !(0.0..=1.0).contains(&rel_y) {
            return None;
        }
        let dest = layout.dest;
        Some((
            dest.x + rel_x * dest.w,
            dest.y + rel_y * dest.h,
        ))
    }

    fn scaled_sprite(spr: &CursorSprite, sw: u32, sh: u32) -> Arc<RgbaImage> {
        if sw == spr.rgba.width() && sh == spr.rgba.height() {
            return Arc::new(spr.rgba.clone());
        }
        let mut cache = SCALE_CACHE.lock();
        if let Some(cached) = cache.as_ref() {
            if cached.w == sw && cached.h == sh {
                return Arc::clone(&cached.rgba);
            }
        }
        let resized = Arc::new(image::imageops::resize(&spr.rgba, sw, sh, FilterType::Lanczos3));
        *cache = Some(ScaledCache {
            w: sw,
            h: sh,
            rgba: Arc::clone(&resized),
        });
        resized
    }

    fn stamp_sprite(
        out: &mut [u8],
        out_w: u32,
        out_h: u32,
        spr: &CursorSprite,
        cx: f64,
        cy: f64,
        click: bool,
    ) {
        let short = out_w.min(out_h).max(1) as f64;
        let mut scale = (short * 0.056).clamp(36.0, 112.0) / spr.rgba.height().max(1) as f64;
        if click {
            scale *= 0.88;
        }
        let sw = (spr.rgba.width() as f64 * scale).round().max(1.0) as u32;
        let sh = (spr.rgba.height() as f64 * scale).round().max(1.0) as u32;
        let hx = spr.hotspot_x as f64 * scale;
        let hy = spr.hotspot_y as f64 * scale;
        let left = cx - hx;
        let top = cy - hy;
        let row_bytes = out_w as usize * 4;
        let sprite = scaled_sprite(spr, sw, sh);

        // Soft drop shadow (1px down-right) before the sprite.
        for y in 0..sh {
            for x in 0..sw {
                let p = sprite.get_pixel(x, y);
                if p[3] < 8 {
                    continue;
                }
                let dx = left.round() as i32 + x as i32 + 1;
                let dy = top.round() as i32 + y as i32 + 1;
                if dx < 0 || dy < 0 || dx >= out_w as i32 || dy >= out_h as i32 {
                    continue;
                }
                let o = dy as usize * row_bytes + dx as usize * 4;
                if o + 3 >= out.len() {
                    continue;
                }
                let shadow_a = (p[3] as f32 / 255.0) * 0.35;
                out[o] = ((out[o] as f32 * (1.0 - shadow_a)) as u32).min(255) as u8;
                out[o + 1] = ((out[o + 1] as f32 * (1.0 - shadow_a)) as u32).min(255) as u8;
                out[o + 2] = ((out[o + 2] as f32 * (1.0 - shadow_a)) as u32).min(255) as u8;
            }
        }

        for y in 0..sh {
            for x in 0..sw {
                let p = sprite.get_pixel(x, y);
                let a = p[3] as f32 / 255.0;
                if a <= 0.01 {
                    continue;
                }
                let dx = left.round() as i32 + x as i32;
                let dy = top.round() as i32 + y as i32;
                if dx < 0 || dy < 0 || dx >= out_w as i32 || dy >= out_h as i32 {
                    continue;
                }
                let o = dy as usize * row_bytes + dx as usize * 4;
                if o + 3 >= out.len() {
                    continue;
                }
                let inv = 1.0 - a;
                out[o] = (p[2] as f32 * a + out[o] as f32 * inv) as u8;
                out[o + 1] = (p[1] as f32 * a + out[o + 1] as f32 * inv) as u8;
                out[o + 2] = (p[0] as f32 * a + out[o + 2] as f32 * inv) as u8;
            }
        }
    }

    /// Reuse `out` as the stamped frame buffer (resizes + copies desktop, then draws cursor).
    pub fn stamp_into_buffer(
        out: &mut Vec<u8>,
        desktop: &[u8],
        out_w: u32,
        out_h: u32,
        vp: &Viewport,
        src_w: u32,
        src_h: u32,
        slot_t_secs: f64,
    ) {
        let expected = (out_w as usize)
            .saturating_mul(out_h as usize)
            .saturating_mul(4);
        if desktop.len() != expected {
            out.resize(expected, 0);
            return;
        }
        if out.len() != expected {
            out.resize(expected, 0);
        }
        out.copy_from_slice(desktop);

        let Some((mx, my, buttons)) = sample_at(slot_t_secs) else {
            return;
        };
        let layout = frame_layout(vp, src_w, src_h, out_w, out_h);
        let Some((ox, oy)) = monitor_to_output(mx, my, &layout) else {
            return;
        };
        let click = buttons & 0x1 != 0;
        stamp_sprite(out, out_w, out_h, sprite(), ox, oy, click);
    }
}

#[cfg(windows)]
pub use imp::{
    cinematic_enabled, latest_monitor_pos, record_follow_sample, record_sample, reset_session,
    stamp_into_buffer, sync_follow_gate_from_state,
};

#[cfg(not(windows))]
use crate::state::{SharedState, Viewport};
#[cfg(not(windows))]
use std::time::Instant;

#[cfg(not(windows))]
pub fn cinematic_enabled(_state: &SharedState) -> bool {
    false
}

#[cfg(not(windows))]
use crate::state::AppState;

#[cfg(not(windows))]
pub fn reset_session() {}

#[cfg(not(windows))]
pub fn sync_follow_gate_from_state(_st: &AppState) {}

#[cfg(not(windows))]
pub fn record_follow_sample(_x: f64, _y: f64, _buttons: u8) {}

#[cfg(not(windows))]
pub fn record_sample(_session_start: Option<Instant>, _x: f64, _y: f64, _buttons: u8) {}

#[cfg(not(windows))]
pub fn latest_monitor_pos() -> Option<(f64, f64)> {
    None
}

#[cfg(not(windows))]
pub fn stamp_into_buffer(
    out: &mut Vec<u8>,
    desktop: &[u8],
    _out_w: u32,
    _out_h: u32,
    _vp: &Viewport,
    _src_w: u32,
    _src_h: u32,
    _slot_t_secs: f64,
) {
    out.clear();
    out.extend_from_slice(desktop);
}
