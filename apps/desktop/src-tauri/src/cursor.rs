//! Cinematic cursor — track pointer samples and stamp a sprite per CFR slot.

#[cfg(windows)]
mod imp {
    use crate::geometry::{clamp, frame_layout, FrameLayout, OneEuro1d};
    use crate::state::{AppState, SharedState, Viewport};
    use image::imageops::FilterType;
    use image::RgbaImage;
    use parking_lot::Mutex;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, OnceLock};
    use std::time::{Duration, Instant};

    /// Follow-thread gate — avoids locking `state` while `viewport` is held (AB-BA deadlock).
    static FOLLOW_CAPTURE: AtomicBool = AtomicBool::new(false);
    static SESSION_START: Mutex<Option<Instant>> = Mutex::new(None);
    static LAST_HOOK_AT: Mutex<Option<Instant>> = Mutex::new(None);

    const RING_CAP: usize = 2048;
    const CURSOR_PNG: &[u8] = include_bytes!("../resources/cursor/default.png");

    /// One Euro filter — smooth takeoff/landing, responsive mid-flight (Screen Studio class).
    const EURO_MIN_CUTOFF: f64 = 0.72;
    const EURO_BETA: f64 = 0.022;

    /// Motion-state thresholds (px/s) with hysteresis.
    const MOVE_ON_SPEED: f64 = 88.0;
    const MOVE_OFF_SPEED: f64 = 32.0;

    /// Jerk/accel limits during travel — caps speed wobble on straight drags.
    const MAX_ACCEL: f64 = 9_000.0;
    const MAX_JERK: f64 = 85_000.0;
    const EURO_TRACK_BLEND: f64 = 0.32;

    /// Output-space smoothing when zoom/pan changes remap monitor coords frame-to-frame.
    const OUTPUT_EURO_MIN: f64 = 1.4;
    const OUTPUT_EURO_BETA: f64 = 0.012;
    const HOOK_SAMPLE_PRIORITY_MS: u64 = 40;

    #[derive(Clone, Copy)]
    struct CaptureSpace {
        origin_x: i32,
        origin_y: i32,
        width: f64,
        height: f64,
    }

    static CAPTURE_SPACE: Mutex<Option<CaptureSpace>> = Mutex::new(None);

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
            let (hotspot_x, hotspot_y) = hotspot_for(&raw);
            CursorSprite {
                rgba: raw,
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

        fn last_slot(&self) -> Option<Sample> {
            if self.len == 0 {
                return None;
            }
            let idx = if self.head == 0 {
                RING_CAP - 1
            } else {
                self.head - 1
            };
            self.slots[idx]
        }

        fn push(&mut self, t_secs: f64, x: f64, y: f64, buttons: u8) {
            if let Some(s) = self.last_slot() {
                let dt = t_secs - s.t_secs;
                if dt >= 0.0
                    && dt < 0.0004
                    && (x - s.x).hypot(y - s.y) < 0.25
                    && buttons == s.buttons
                {
                    self.latest = Some((x, y, buttons));
                    return;
                }
            }
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

        fn chronological(&self) -> Vec<Sample> {
            if self.len == 0 {
                return Vec::new();
            }
            let start = (self.head + RING_CAP - self.len) % RING_CAP;
            let mut out = Vec::with_capacity(self.len);
            for i in 0..self.len {
                if let Some(s) = self.slots[(start + i) % RING_CAP] {
                    out.push(s);
                }
            }
            out
        }

        fn raw_linear_at(samples: &[Sample], t_secs: f64) -> Option<(f64, f64, u8)> {
            if samples.is_empty() {
                return None;
            }
            let mut best_before: Option<Sample> = None;
            let mut best_after: Option<Sample> = None;
            for s in samples {
                if s.t_secs <= t_secs {
                    if best_before.map(|b| s.t_secs > b.t_secs).unwrap_or(true) {
                        best_before = Some(*s);
                    }
                } else if best_after.map(|a| s.t_secs < a.t_secs).unwrap_or(true) {
                    best_after = Some(*s);
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
                _ => None,
            }
        }

        fn sample_at(&self, t_secs: f64) -> Option<(f64, f64, u8)> {
            let samples = self.chronological();
            if samples.is_empty() {
                return self.latest.map(|(x, y, b)| (x, y, b));
            }
            filtered_at(&samples, t_secs).or_else(|| self.latest.map(|(x, y, b)| (x, y, b)))
        }
    }

    #[derive(Clone, Copy)]
    struct EuroKeyframe {
        t_secs: f64,
        x: f64,
        y: f64,
        buttons: u8,
    }

    fn euro_keyframes(samples: &[Sample], t_secs: f64) -> Option<Vec<EuroKeyframe>> {
        if samples.is_empty() {
            return None;
        }
        if samples[0].t_secs > t_secs {
            return Some(vec![EuroKeyframe {
                t_secs,
                x: samples[0].x,
                y: samples[0].y,
                buttons: samples[0].buttons,
            }]);
        }

        let mut fx = OneEuro1d::new(EURO_MIN_CUTOFF, EURO_BETA);
        let mut fy = OneEuro1d::new(EURO_MIN_CUTOFF, EURO_BETA);
        let mut frames = Vec::new();

        for s in samples {
            if s.t_secs > t_secs {
                break;
            }
            frames.push(EuroKeyframe {
                t_secs: s.t_secs,
                x: fx.filter(s.x, s.t_secs),
                y: fy.filter(s.y, s.t_secs),
                buttons: s.buttons,
            });
        }

        if frames.is_empty() {
            return None;
        }

        let last_t = frames.last().unwrap().t_secs;
        if last_t < t_secs {
            if let Some((rx, ry, buttons)) = Ring::raw_linear_at(samples, t_secs) {
                frames.push(EuroKeyframe {
                    t_secs,
                    x: fx.filter(rx, t_secs),
                    y: fy.filter(ry, t_secs),
                    buttons,
                });
            }
        }

        Some(frames)
    }

    struct MotionSmoother {
        x: f64,
        y: f64,
        vx: f64,
        vy: f64,
        ax: f64,
        ay: f64,
        moving: bool,
    }

    impl MotionSmoother {
        fn new(x: f64, y: f64) -> Self {
            Self {
                x,
                y,
                vx: 0.0,
                vy: 0.0,
                ax: 0.0,
                ay: 0.0,
                moving: false,
            }
        }

        fn step(&mut self, prev: &EuroKeyframe, next: &EuroKeyframe) {
            let dt = (next.t_secs - prev.t_secs).max(1.0 / 2000.0);
            let euro_vx = (next.x - prev.x) / dt;
            let euro_vy = (next.y - prev.y) / dt;
            let euro_speed = (euro_vx * euro_vx + euro_vy * euro_vy).sqrt();

            if !self.moving && euro_speed > MOVE_ON_SPEED {
                self.moving = true;
            } else if self.moving && euro_speed < MOVE_OFF_SPEED {
                self.moving = false;
            }

            if !self.moving {
                let lock = (1.0 - (-10.0 * dt).exp()) * 0.42;
                self.x += (next.x - self.x) * lock;
                self.y += (next.y - self.y) * lock;
                self.vx = 0.0;
                self.vy = 0.0;
                self.ax = 0.0;
                self.ay = 0.0;
                return;
            }

            let target_ax = (euro_vx - self.vx) / dt;
            let target_ay = (euro_vy - self.vy) / dt;
            let mut ax = target_ax;
            let mut ay = target_ay;

            let dax = ax - self.ax;
            let day = ay - self.ay;
            let da_len = (dax * dax + day * day).sqrt();
            let max_da = MAX_JERK * dt;
            if da_len > max_da && da_len > f64::EPSILON {
                let s = max_da / da_len;
                ax = self.ax + dax * s;
                ay = self.ay + day * s;
            }
            self.ax = ax;
            self.ay = ay;

            self.vx += self.ax * dt;
            self.vy += self.ay * dt;

            let dvx = euro_vx - self.vx;
            let dvy = euro_vy - self.vy;
            let dv_len = (dvx * dvx + dvy * dvy).sqrt();
            let max_dv = MAX_ACCEL * dt;
            if dv_len > max_dv && dv_len > f64::EPSILON {
                let s = max_dv / dv_len;
                self.vx += dvx * s;
                self.vy += dvy * s;
            }

            self.x += self.vx * dt;
            self.y += self.vy * dt;

            let lock = (1.0 - (-8.0 * dt).exp()) * EURO_TRACK_BLEND;
            self.x += (next.x - self.x) * lock;
            self.y += (next.y - self.y) * lock;
        }
    }

    fn motion_smoothed_at(frames: &[EuroKeyframe]) -> Option<(f64, f64, u8)> {
        if frames.is_empty() {
            return None;
        }
        if frames.len() == 1 {
            let f = &frames[0];
            return Some((f.x, f.y, f.buttons));
        }

        let mut smooth = MotionSmoother::new(frames[0].x, frames[0].y);
        for pair in frames.windows(2) {
            smooth.step(&pair[0], &pair[1]);
        }
        let last = frames.last().unwrap();
        Some((smooth.x, smooth.y, last.buttons))
    }

    fn filtered_at(samples: &[Sample], t_secs: f64) -> Option<(f64, f64, u8)> {
        let frames = euro_keyframes(samples, t_secs)?;
        motion_smoothed_at(&frames)
    }

    struct CfrPlayback {
        last_slot_t: Option<f64>,
        fx: OneEuro1d,
        fy: OneEuro1d,
        motion: MotionSmoother,
        last_kf: Option<EuroKeyframe>,
        x: f64,
        y: f64,
        buttons: u8,
    }

    impl CfrPlayback {
        fn new() -> Self {
            Self {
                last_slot_t: None,
                fx: OneEuro1d::new(EURO_MIN_CUTOFF, EURO_BETA),
                fy: OneEuro1d::new(EURO_MIN_CUTOFF, EURO_BETA),
                motion: MotionSmoother::new(0.0, 0.0),
                last_kf: None,
                x: 0.0,
                y: 0.0,
                buttons: 0,
            }
        }

        fn sample(&mut self, samples: &[Sample], slot_t_secs: f64) -> Option<(f64, f64, u8)> {
            let (rx, ry, buttons) = Ring::raw_linear_at(samples, slot_t_secs)?;
            if self
                .last_slot_t
                .is_some_and(|prev| slot_t_secs + 1.0e-6 < prev)
            {
                return filtered_at(samples, slot_t_secs).map(|(x, y, b)| {
                    self.reset_from(x, y, b, slot_t_secs);
                    (x, y, b)
                });
            }

            let ex = self.fx.filter(rx, slot_t_secs);
            let ey = self.fy.filter(ry, slot_t_secs);
            let kf = EuroKeyframe {
                t_secs: slot_t_secs,
                x: ex,
                y: ey,
                buttons,
            };
            if let Some(prev) = self.last_kf {
                self.motion.step(&prev, &kf);
                self.x = self.motion.x;
                self.y = self.motion.y;
            } else {
                self.motion = MotionSmoother::new(ex, ey);
                self.x = ex;
                self.y = ey;
            }
            self.last_kf = Some(kf);
            self.last_slot_t = Some(slot_t_secs);
            self.buttons = buttons;
            Some((self.x, self.y, buttons))
        }

        fn reset_from(&mut self, x: f64, y: f64, buttons: u8, slot_t_secs: f64) {
            self.fx = OneEuro1d::new(EURO_MIN_CUTOFF, EURO_BETA);
            self.fy = OneEuro1d::new(EURO_MIN_CUTOFF, EURO_BETA);
            self.motion = MotionSmoother::new(x, y);
            self.last_kf = Some(EuroKeyframe {
                t_secs: slot_t_secs,
                x,
                y,
                buttons,
            });
            self.x = x;
            self.y = y;
            self.buttons = buttons;
            self.last_slot_t = Some(slot_t_secs);
        }
    }

    struct OutputSmooth {
        ox: OneEuro1d,
        oy: OneEuro1d,
    }

    impl OutputSmooth {
        fn new() -> Self {
            Self {
                ox: OneEuro1d::new(OUTPUT_EURO_MIN, OUTPUT_EURO_BETA),
                oy: OneEuro1d::new(OUTPUT_EURO_MIN, OUTPUT_EURO_BETA),
            }
        }

        fn filter(&mut self, ox: f64, oy: f64, slot_t_secs: f64) -> (f64, f64) {
            (
                self.ox.filter(ox, slot_t_secs),
                self.oy.filter(oy, slot_t_secs),
            )
        }
    }

    static CFR_PLAYBACK: Mutex<Option<CfrPlayback>> = Mutex::new(None);
    static OUTPUT_SMOOTH: Mutex<Option<OutputSmooth>> = Mutex::new(None);

    fn cfr_sample_at(slot_t_secs: f64) -> Option<(f64, f64, u8)> {
        let ring = ring().lock();
        let samples = ring.chronological();
        if samples.is_empty() {
            return ring.latest.map(|(x, y, b)| (x, y, b));
        }
        let mut playback = CFR_PLAYBACK.lock();
        let state = playback.get_or_insert_with(CfrPlayback::new);
        state.sample(&samples, slot_t_secs)
    }

    fn smooth_output_xy(ox: f64, oy: f64, slot_t_secs: f64) -> (f64, f64) {
        let mut smooth = OUTPUT_SMOOTH.lock();
        let state = smooth.get_or_insert_with(OutputSmooth::new);
        state.filter(ox, oy, slot_t_secs)
    }

    static RING: OnceLock<Mutex<Ring>> = OnceLock::new();

    fn ring() -> &'static Mutex<Ring> {
        RING.get_or_init(|| Mutex::new(Ring::new()))
    }

    fn pointer_button_state() -> u8 {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
        let mut b = 0u8;
        unsafe {
            if GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 {
                b |= 0x1;
            }
            if GetAsyncKeyState(VK_RBUTTON.0 as i32) < 0 {
                b |= 0x2;
            }
        }
        b
    }

    pub fn cinematic_enabled(state: &SharedState) -> bool {
        let st = state.lock();
        st.recording_settings.use_cinematic_cursor()
    }

    pub fn reset_session() {
        let mut r = ring().lock();
        r.slots = [None; RING_CAP];
        r.head = 0;
        r.len = 0;
        r.latest = None;
        *CAPTURE_SPACE.lock() = None;
        *LAST_HOOK_AT.lock() = None;
        *CFR_PLAYBACK.lock() = None;
        *OUTPUT_SMOOTH.lock() = None;
    }

    pub fn set_capture_space(origin_x: i32, origin_y: i32, width: u32, height: u32) {
        if !FOLLOW_CAPTURE.load(Ordering::Acquire) {
            return;
        }
        *CAPTURE_SPACE.lock() = Some(CaptureSpace {
            origin_x,
            origin_y,
            width: width as f64,
            height: height as f64,
        });
    }

    /// High-rate sample from the mouse hook (`WM_MOUSEMOVE`).
    pub fn record_hook_move(screen_x: i32, screen_y: i32) {
        if !FOLLOW_CAPTURE.load(Ordering::Acquire) {
            return;
        }
        let space = match *CAPTURE_SPACE.lock() {
            Some(s) => s,
            None => return,
        };
        let x = clamp(
            screen_x as f64 - space.origin_x as f64,
            0.0,
            space.width,
        );
        let y = clamp(
            screen_y as f64 - space.origin_y as f64,
            0.0,
            space.height,
        );
        let session = *SESSION_START.lock();
        record_sample(session, x, y, pointer_button_state());
        *LAST_HOOK_AT.lock() = Some(Instant::now());
    }

    /// Call whenever recording/arming/cinematic settings change (never from follow thread).
    pub fn sync_follow_gate_from_state(st: &AppState) {
        let on = st.recording_settings.use_cinematic_cursor()
            && (st.recording || st.recording_armed);
        FOLLOW_CAPTURE.store(on, Ordering::Release);
        let session = if st.recording {
            st.session_start.or(st.current_start)
        } else {
            None
        };
        *SESSION_START.lock() = session;
        if !on {
            *CAPTURE_SPACE.lock() = None;
        }
    }

    /// Hot-path sample from cursor-follow thread — no `state` lock.
    pub fn record_follow_sample(x: f64, y: f64, buttons: u8) {
        if !FOLLOW_CAPTURE.load(Ordering::Acquire) {
            return;
        }
        if LAST_HOOK_AT
            .lock()
            .is_some_and(|t| t.elapsed() < Duration::from_millis(HOOK_SAMPLE_PRIORITY_MS))
        {
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
        let t = SESSION_START
            .lock()
            .as_ref()
            .map(|s| s.elapsed().as_secs_f64())
            .unwrap_or(0.0);
        sample_at(t).map(|(x, y, _)| (x, y))
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

    fn scaled_sprite(spr: &CursorSprite, sw: u32, sh: u32, out_short: u32) -> Arc<RgbaImage> {
        if sw == spr.rgba.width() && sh == spr.rgba.height() {
            return Arc::new(spr.rgba.clone());
        }
        let mut cache = SCALE_CACHE.lock();
        if let Some(cached) = cache.as_ref() {
            if cached.w == sw && cached.h == sh {
                return Arc::clone(&cached.rgba);
            }
        }
        let filter = if out_short >= 1440 {
            FilterType::Triangle
        } else {
            FilterType::Lanczos3
        };
        let resized = Arc::new(image::imageops::resize(&spr.rgba, sw, sh, filter));
        *cache = Some(ScaledCache {
            w: sw,
            h: sh,
            rgba: Arc::clone(&resized),
        });
        resized
    }

    #[inline]
    fn blend_over(out: &mut [u8], o: usize, sr: u8, sg: u8, sb: u8, alpha: f32) {
        let inv = 1.0 - alpha;
        out[o] = (sb as f32 * alpha + out[o] as f32 * inv).round().clamp(0.0, 255.0) as u8;
        out[o + 1] = (sg as f32 * alpha + out[o + 1] as f32 * inv).round().clamp(0.0, 255.0) as u8;
        out[o + 2] = (sr as f32 * alpha + out[o + 2] as f32 * inv).round().clamp(0.0, 255.0) as u8;
    }

    /// Sub-pixel bilinear splat — fractional hotspot placement without grid snap.
    fn splat_rgba(
        out: &mut [u8],
        out_w: u32,
        out_h: u32,
        row_bytes: usize,
        r: u8,
        g: u8,
        b: u8,
        a: u8,
        xf: f64,
        yf: f64,
        alpha_mul: f32,
    ) {
        if a < 8 {
            return;
        }
        let base_alpha = (a as f32 / 255.0) * alpha_mul;
        if base_alpha <= 0.001 {
            return;
        }

        let x0 = xf.floor() as i32;
        let y0 = yf.floor() as i32;
        let fx = (xf - x0 as f64) as f32;
        let fy = (yf - y0 as f64) as f32;

        let corners = [
            (0, 0, (1.0 - fx) * (1.0 - fy)),
            (1, 0, fx * (1.0 - fy)),
            (0, 1, (1.0 - fx) * fy),
            (1, 1, fx * fy),
        ];

        for (dx, dy, w) in corners {
            let wa = base_alpha * w;
            if wa <= 0.001 {
                continue;
            }
            let px = x0 + dx;
            let py = y0 + dy;
            if px < 0 || py < 0 || px >= out_w as i32 || py >= out_h as i32 {
                continue;
            }
            let o = py as usize * row_bytes + px as usize * 4;
            if o + 3 >= out.len() {
                continue;
            }
            blend_over(out, o, r, g, b, wa.min(1.0));
        }
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
        let mut scale = (short * 0.062).clamp(40.0, 124.0) / spr.rgba.height().max(1) as f64;
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
        let out_short = out_w.min(out_h);
        let sprite = scaled_sprite(spr, sw, sh, out_short);

        for y in 0..sh {
            for x in 0..sw {
                let p = sprite.get_pixel(x, y);
                if p[3] < 8 {
                    continue;
                }
                splat_rgba(
                    out,
                    out_w,
                    out_h,
                    row_bytes,
                    p[0],
                    p[1],
                    p[2],
                    p[3],
                    left + x as f64 + 1.0,
                    top + y as f64 + 1.0,
                    0.35,
                );
            }
        }

        for y in 0..sh {
            for x in 0..sw {
                let p = sprite.get_pixel(x, y);
                splat_rgba(
                    out,
                    out_w,
                    out_h,
                    row_bytes,
                    p[0],
                    p[1],
                    p[2],
                    p[3],
                    left + x as f64,
                    top + y as f64,
                    1.0,
                );
            }
        }
    }

    /// GPU overlay placement — mirrors CPU `stamp_sprite` geometry without splatting pixels.
    #[derive(Clone, Copy, Debug)]
    pub struct GpuOverlay {
        pub left: f32,
        pub top: f32,
        pub width: f32,
        pub height: f32,
        pub click: bool,
    }

    pub fn gpu_overlay_at(
        slot_t_secs: f64,
        vp: &Viewport,
        src_w: u32,
        src_h: u32,
        out_w: u32,
        out_h: u32,
    ) -> Option<GpuOverlay> {
        let Some((mx, my, buttons)) = cfr_sample_at(slot_t_secs) else {
            return None;
        };
        let layout = frame_layout(vp, src_w, src_h, out_w, out_h);
        let Some((ox, oy)) = monitor_to_output(mx, my, &layout) else {
            return None;
        };
        let (ox, oy) = smooth_output_xy(ox, oy, slot_t_secs);
        let click = buttons & 0x1 != 0;
        let spr = sprite();
        let short = out_w.min(out_h).max(1) as f64;
        let mut scale = (short * 0.062).clamp(40.0, 124.0) / spr.rgba.height().max(1) as f64;
        if click {
            scale *= 0.88;
        }
        let sw = (spr.rgba.width() as f64 * scale).round().max(1.0) as f32;
        let sh = (spr.rgba.height() as f64 * scale).round().max(1.0) as f32;
        let hx = spr.hotspot_x as f64 * scale;
        let hy = spr.hotspot_y as f64 * scale;
        Some(GpuOverlay {
            left: (ox - hx) as f32,
            top: (oy - hy) as f32,
            width: sw,
            height: sh,
            click,
        })
    }

    /// Raw RGBA bytes for uploading the cursor sprite to a D3D11 texture.
    pub fn cursor_rgba_bytes() -> (u32, u32, &'static [u8]) {
        let spr = sprite();
        (spr.rgba.width(), spr.rgba.height(), spr.rgba.as_raw())
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

        let Some((mx, my, buttons)) = cfr_sample_at(slot_t_secs) else {
            return;
        };
        let layout = frame_layout(vp, src_w, src_h, out_w, out_h);
        let Some((ox, oy)) = monitor_to_output(mx, my, &layout) else {
            return;
        };
        let (ox, oy) = smooth_output_xy(ox, oy, slot_t_secs);
        let click = buttons & 0x1 != 0;
        stamp_sprite(out, out_w, out_h, sprite(), ox, oy, click);
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn one_euro_softens_step_start() {
            let samples = vec![
                Sample {
                    t_secs: 0.0,
                    x: 0.0,
                    y: 0.0,
                    buttons: 0,
                },
                Sample {
                    t_secs: 0.05,
                    x: 100.0,
                    y: 0.0,
                    buttons: 0,
                },
            ];
            let raw = Ring::raw_linear_at(&samples, 0.05).unwrap();
            let filtered = filtered_at(&samples, 0.05).unwrap();
            assert!(filtered.0 < raw.0);
            assert!(filtered.0 > 0.0);
        }

        #[test]
        fn hook_dedup_skips_redundant_moves() {
            let mut ring = Ring::new();
            ring.push(1.0, 10.0, 20.0, 0);
            ring.push(1.0001, 10.1, 20.0, 0);
            assert_eq!(ring.len, 1);
        }

        #[test]
        fn jerk_limit_caps_velocity_spike() {
            let frames = vec![
                EuroKeyframe {
                    t_secs: 0.0,
                    x: 0.0,
                    y: 0.0,
                    buttons: 0,
                },
                EuroKeyframe {
                    t_secs: 0.02,
                    x: 200.0,
                    y: 0.0,
                    buttons: 0,
                },
            ];
            let (_, _, _) = motion_smoothed_at(&frames).unwrap();
            let mid = vec![
                EuroKeyframe {
                    t_secs: 0.0,
                    x: 0.0,
                    y: 0.0,
                    buttons: 0,
                },
                EuroKeyframe {
                    t_secs: 0.01,
                    x: 100.0,
                    y: 0.0,
                    buttons: 0,
                },
                EuroKeyframe {
                    t_secs: 0.02,
                    x: 200.0,
                    y: 0.0,
                    buttons: 0,
                },
            ];
            let (x, _, _) = motion_smoothed_at(&mid).unwrap();
            assert!(x < 100.0);
            assert!(x > 0.0);
        }

        #[test]
        fn motion_smoother_reduces_speed_wobble() {
            let mut samples = vec![Sample {
                t_secs: 0.0,
                x: 0.0,
                y: 0.0,
                buttons: 0,
            }];
            for i in 1..=40 {
                let t = i as f64 * 0.02;
                let base_x = t * 420.0;
                let jitter = match i % 4 {
                    0 => 14.0,
                    1 => -11.0,
                    2 => 7.0,
                    _ => -5.0,
                };
                samples.push(Sample {
                    t_secs: t,
                    x: base_x + jitter,
                    y: 0.0,
                    buttons: 0,
                });
            }

            let t_end = 0.8;
            let euro = euro_keyframes(&samples, t_end).unwrap();
            let mut euro_speeds = Vec::new();
            let mut smooth_speeds = Vec::new();
            for pair in euro.windows(2) {
                let dt = (pair[1].t_secs - pair[0].t_secs).max(1.0 / 2000.0);
                euro_speeds.push((pair[1].x - pair[0].x).abs() / dt);
            }
            for i in 1..euro.len() {
                let partial = &euro[..=i];
                let (x0, _, _) = motion_smoothed_at(&partial[..partial.len() - 1]).unwrap();
                let (x1, _, _) = motion_smoothed_at(partial).unwrap();
                let dt = (partial.last().unwrap().t_secs
                    - partial[partial.len() - 2].t_secs)
                    .max(1.0 / 2000.0);
                smooth_speeds.push((x1 - x0).abs() / dt);
            }

            fn variance(vals: &[f64]) -> f64 {
                if vals.len() < 2 {
                    return 0.0;
                }
                let mean = vals.iter().sum::<f64>() / vals.len() as f64;
                vals.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / vals.len() as f64
            }

            let moving_euro: Vec<f64> = euro_speeds
                .iter()
                .copied()
                .filter(|s| *s > MOVE_ON_SPEED)
                .collect();
            let moving_smooth: Vec<f64> = smooth_speeds
                .iter()
                .copied()
                .filter(|s| *s > MOVE_ON_SPEED * 0.5)
                .collect();
            assert!(!moving_euro.is_empty());
            assert!(!moving_smooth.is_empty());
            assert!(variance(&moving_smooth) < variance(&moving_euro));
        }
    }
}

#[cfg(windows)]
pub use imp::{
    cinematic_enabled, cursor_rgba_bytes, gpu_overlay_at, latest_monitor_pos, record_follow_sample,
    record_hook_move, record_sample, reset_session, set_capture_space, stamp_into_buffer,
    sync_follow_gate_from_state, GpuOverlay,
};

#[cfg(not(windows))]
use crate::state::{AppState, SharedState, Viewport};
#[cfg(not(windows))]
use std::time::Instant;

#[cfg(not(windows))]
pub fn cinematic_enabled(_state: &SharedState) -> bool {
    false
}

#[cfg(not(windows))]
pub fn reset_session() {}

#[cfg(not(windows))]
pub fn sync_follow_gate_from_state(_st: &AppState) {}

#[cfg(not(windows))]
pub fn set_capture_space(_origin_x: i32, _origin_y: i32, _width: u32, _height: u32) {}

#[cfg(not(windows))]
pub fn record_follow_sample(_x: f64, _y: f64, _buttons: u8) {}

#[cfg(not(windows))]
pub fn record_hook_move(_screen_x: i32, _screen_y: i32) {}

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
