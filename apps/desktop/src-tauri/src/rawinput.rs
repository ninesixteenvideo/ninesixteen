use crate::state::{SharedState, SharedViewport};

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::geometry::{
        advance_pan_follow, apply_edge_soft_pan, clamp, clamp_zoom, converge_center_to_bounds,
        ease_in_out_cubic, edge_soft_zone_px, frame_layout, magnet_zoom_target, output_dims,
        pan_follow_profile, pan_follow_profile_game, pan_max_speed_for_zoom, viewport_center_bounds,
        zoom_canonical_step_scale, zoom_from_gesture_ticks,
        zoom_gesture_duration_secs, zoom_min_for, crosses_canonical_zoom, OneEuro2d,
        CANONICAL_ZOOM_EASE_SECS, smooth_toward,
        ZOOM_TICKS_PER_NOTCH,
    };
    use crate::state::{GamePanMode, Orientation, PromoMode, Viewport, ViewportState};
    use crate::log::capture_log;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter, Manager};

    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_DOWN, VK_MENU, VK_RMENU, VK_UP,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage,
        HC_ACTION, KBDLLHOOKSTRUCT, MSLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WH_MOUSE_LL,
        WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL,
        WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    static ALT_HELD: AtomicBool = AtomicBool::new(false);

    struct Ctx {
        viewport: SharedViewport,
        state: SharedState,
        app: AppHandle,
    }

    static CTX: OnceLock<Ctx> = OnceLock::new();
    static LAST_FOLLOW: parking_lot::Mutex<Option<Instant>> = parking_lot::Mutex::new(None);
    static ZOOM_LOCK_UNTIL: parking_lot::Mutex<Option<Instant>> = parking_lot::Mutex::new(None);
    /// Easing toward full 9×16 — ignore Alt+scroll until the 0.4s hold starts.
    static PENDING_FULL_LOCK: AtomicBool = AtomicBool::new(false);
    /// When `PENDING_FULL_LOCK` was last engaged (ms since epoch). Used purely as a
    /// safety deadline so the latch can never stay stuck and swallow Alt+scroll.
    static PENDING_FULL_LOCK_SINCE_MS: AtomicU64 = AtomicU64::new(0);
    /// Wheel notches queued by the hook; drained on the follow thread only.
    static PENDING_WHEEL_NOTCHES: parking_lot::Mutex<f64> = parking_lot::Mutex::new(0.0);
    /// Gesture anchor zoom (when the current scroll burst started).
    static GESTURE_ANCHOR_ZOOM: parking_lot::Mutex<Option<f64>> = parking_lot::Mutex::new(None);
    /// Accumulated virtual ticks for the active gesture (notches × 13).
    static GESTURE_TICKS: parking_lot::Mutex<f64> = parking_lot::Mutex::new(0.0);
    /// Cubic ease-in-out animation toward `zoom_target`.
    static ZOOM_EASE_FROM: parking_lot::Mutex<f64> = parking_lot::Mutex::new(1.0);
    static ZOOM_EASE_TO: parking_lot::Mutex<f64> = parking_lot::Mutex::new(1.0);
    static ZOOM_EASE_START: parking_lot::Mutex<Option<Instant>> = parking_lot::Mutex::new(None);
    static ZOOM_EASE_DUR: parking_lot::Mutex<f64> = parking_lot::Mutex::new(0.5);
    static LAST_ALT_DEBUG_MS: AtomicU64 = AtomicU64::new(0);
    /// Cached so the mouse hook never locks the viewport mutex (that starved pan follow).
    static ZOOM_AT_MIN: AtomicBool = AtomicBool::new(false);
    static VIEWPORT_DIRTY: AtomicBool = AtomicBool::new(false);
    /// Low-pass the raw cursor before pan follow — removes micro-jitter from polling.
    static PAN_CURSOR_FILTER: parking_lot::Mutex<Option<((f64, f64), OneEuro2d, f64)>> =
        parking_lot::Mutex::new(None);

    const CURSOR_TICK_MS: u64 = 8;
    // Baselines — overridden per frame by `pan_follow_profile` from Studio settings.
    const PAN_SMOOTH_HZ: f64 = 5.2;
    const PAN_SMOOTH_HZ_ALT: f64 = 5.8;
    /// One Euro on live cursor — smooth at rest, responsive on fast drags (defaults).
    const PAN_EURO_MIN_CUTOFF: f64 = 0.85;
    const PAN_EURO_BETA: f64 = 0.035;
    const UNFREEZE_PAN_HZ_START: f64 = 1.5;
    const UNFREEZE_SPEED_START: f64 = 0.09;
    const UNFREEZE_EASE_DURATION: Duration = Duration::from_millis(3600);
    const UNFREEZE_ARRIVED_PX: f64 = 10.0;
    // Soft zone: gentle crawl near frame center, long ramp to full follow speed.
    const PAN_SOFT_INNER_PX: f64 = 55.0;
    const PAN_SOFT_OUTER_PX: f64 = 340.0;
    const PAN_SOFT_INNER_SCALE: f64 = 0.32;
    /// Base pan cap at zoom 1.0 (monitor px/s); scaled down when wide, up when tight.
    const PAN_MAX_SPEED_BASE: f64 = 760.0;
    const PAN_MAX_SPEED_WIDE_SCALE: f64 = 0.72;
    const PAN_MAX_SPEED_TIGHT_SCALE: f64 = 1.28;
    /// Max queued notches (×13 virtual ticks each) before clamping a fast spin.
    const MAX_PENDING_NOTCHES: f64 = 24.0;
    const FULL_FRAME_SETTLE: f64 = 0.012;
    const ZOOM_SETTLE_EPS: f64 = 0.0008;
    const ZOOM_CREEP_HZ: f64 = 5.0;
    /// While easing to full 9×16, bounds shrink every frame — pull center in if pan lags.
    const FULL_FRAME_LOCK: Duration = Duration::from_millis(400);
    /// Hard safety bound for the easing-to-full latch. Easing to full 9×16 settles
    /// in well under a second; if the latch is somehow still set after this long
    /// (a starved follow tick, a failed cursor read, or the monitor handle going
    /// away mid-ease) we force-clear it so Alt+scroll can NEVER stay swallowed.
    const MAX_PENDING_FULL_MS: u64 = 2000;

    fn alt_log(msg: &str) {
        capture_log(&format!("Alt: {msg}"));
    }

    /// Throttle noisy hook logs (e.g. repeated blocked wheel events).
    fn alt_log_throttled(msg: &str, min_interval_ms: u64) {
        let now = now_ms();
        let last = LAST_ALT_DEBUG_MS.load(Ordering::Relaxed);
        if now.saturating_sub(last) >= min_interval_ms {
            LAST_ALT_DEBUG_MS.store(now, Ordering::Relaxed);
            alt_log(msg);
        }
    }

    fn clear_gesture_zoom_state() {
        *PENDING_WHEEL_NOTCHES.lock() = 0.0;
        *GESTURE_ANCHOR_ZOOM.lock() = None;
        *GESTURE_TICKS.lock() = 0.0;
        *ZOOM_EASE_START.lock() = None;
    }

    fn gesture_session_active() -> bool {
        GESTURE_ANCHOR_ZOOM.lock().is_some()
    }

    /// Hold the ease slot open at the settled zoom so staggered wheel notches
    /// retarget smoothly instead of cold-starting a new ease-in-out segment.
    fn park_zoom_ease(at: f64) {
        *ZOOM_EASE_FROM.lock() = at;
        *ZOOM_EASE_TO.lock() = at;
        *ZOOM_EASE_START.lock() = Some(Instant::now());
        *ZOOM_EASE_DUR.lock() = 0.05;
    }

    fn zoom_ease_mid_flight() -> bool {
        ZOOM_EASE_START.lock().is_some()
            && (*ZOOM_EASE_FROM.lock() - *ZOOM_EASE_TO.lock()).abs() > ZOOM_SETTLE_EPS
    }

    fn restart_zoom_ease(from: f64, to: f64, total_ticks: f64) {
        *ZOOM_EASE_FROM.lock() = from;
        *ZOOM_EASE_TO.lock() = to;
        *ZOOM_EASE_START.lock() = Some(Instant::now());
        *ZOOM_EASE_DUR.lock() = zoom_gesture_duration_secs(from, to, total_ticks);
    }

    /// Redirect or extend an in-flight ease without jolting — keeps accel/decel continuity.
    fn retarget_zoom_ease(
        current: f64,
        new_to: f64,
        total_ticks: f64,
        added_ticks: f64,
        canonical_snap: bool,
    ) {
        let segment_dur = if canonical_snap {
            CANONICAL_ZOOM_EASE_SECS
        } else {
            zoom_gesture_duration_secs(current, new_to, added_ticks.max(1.0))
        };

        if zoom_ease_mid_flight() {
            let started = ZOOM_EASE_START.lock().expect("ease start");
            let elapsed = started.elapsed().as_secs_f64();
            let old_dur = (*ZOOM_EASE_DUR.lock()).max(0.05);
            let remaining = (old_dur - elapsed).max(0.0);
            let new_dur = (segment_dur + remaining * 0.5).clamp(0.55, 3.6);
            *ZOOM_EASE_FROM.lock() = current;
            *ZOOM_EASE_TO.lock() = new_to;
            *ZOOM_EASE_START.lock() = Some(Instant::now());
            *ZOOM_EASE_DUR.lock() = new_dur;
        } else if gesture_session_active() {
            let new_dur = segment_dur.clamp(0.55, 3.6);
            *ZOOM_EASE_FROM.lock() = current;
            *ZOOM_EASE_TO.lock() = new_to;
            *ZOOM_EASE_START.lock() = Some(Instant::now());
            *ZOOM_EASE_DUR.lock() = new_dur;
        } else {
            restart_zoom_ease(current, new_to, total_ticks);
            if canonical_snap {
                *ZOOM_EASE_DUR.lock() = CANONICAL_ZOOM_EASE_SECS;
            }
        }
    }

    fn zoom_ease_active() -> bool {
        zoom_ease_mid_flight()
    }

    fn advance_zoom_ease(vp: &mut ViewportState, dt_secs: f64) -> bool {
        let start = *ZOOM_EASE_START.lock();
        let Some(started) = start else {
            return false;
        };
        let from = *ZOOM_EASE_FROM.lock();
        let to = *ZOOM_EASE_TO.lock();
        let dur = (*ZOOM_EASE_DUR.lock()).max(0.05);
        let orientation = vp.viewport.orientation;
        let segment_span = (from - to).abs().max(0.02);
        let t = (started.elapsed().as_secs_f64() / dur).clamp(0.0, 1.0);
        let current = vp.viewport.zoom;

        if (from - to).abs() <= ZOOM_SETTLE_EPS {
            return false;
        }

        if t < 1.0 {
            let desired = from + (to - from) * ease_in_out_cubic(t);
            let step = desired - current;
            let scale = zoom_canonical_step_scale(current, step, to, orientation, segment_span);
            vp.viewport.zoom = current + step * scale;
        } else {
            let remain = to - current;
            if remain.abs() > ZOOM_SETTLE_EPS {
                let scale = zoom_canonical_step_scale(current, remain, to, orientation, segment_span);
                let eff_hz = ZOOM_CREEP_HZ * scale.max(crate::geometry::SOFT_APPROACH_FLOOR);
                vp.viewport.zoom = smooth_toward(current, to, eff_hz, dt_secs.max(1.0 / 240.0));
                return false;
            }
            let snapped = magnet_zoom_target(to, orientation);
            vp.viewport.zoom = snapped;
            vp.zoom_target = snapped;
            sync_zoom_at_min(snapped, orientation);
            const MIN_NOTCH: f64 = 1.0e-4;
            if gesture_session_active()
                && PENDING_WHEEL_NOTCHES.lock().abs() < MIN_NOTCH
                && !pending_full_lock_active()
            {
                park_zoom_ease(snapped);
                return false;
            }
            *ZOOM_EASE_START.lock() = None;
            return true;
        }
        false
    }

    fn scroll_block_reason() -> &'static str {
        if zoom_hold_active() {
            "full-frame-hold"
        } else if PENDING_FULL_LOCK.load(Ordering::Acquire) {
            "easing-to-full"
        } else {
            "none"
        }
    }

    fn sync_zoom_at_min(zoom_target: f64, orientation: Orientation) {
        ZOOM_AT_MIN.store(
            zoom_target <= zoom_min_for(orientation) + 0.001,
            Ordering::Release,
        );
    }

    fn mark_viewport_dirty() {
        VIEWPORT_DIRTY.store(true, Ordering::Release);
    }

    fn reset_pan_cursor_filter() {
        *PAN_CURSOR_FILTER.lock() = None;
    }

    pub fn reset_pan_follow_tuning() {
        reset_pan_cursor_filter();
    }

    fn filter_pan_cursor(
        raw_x: f64,
        raw_y: f64,
        dt_secs: f64,
        min_cutoff: f64,
        beta: f64,
    ) -> (f64, f64) {
        let mut slot = PAN_CURSOR_FILTER.lock();
        let cfg = (min_cutoff, beta);
        if slot.as_ref().map(|(c, _, _)| *c) != Some(cfg) {
            *slot = Some((cfg, OneEuro2d::new(min_cutoff, beta), 0.0));
        }
        let (_cfg, filter, t) = slot.as_mut().expect("pan cursor filter");
        *t += dt_secs;
        filter.filter(raw_x, raw_y, *t)
    }

    pub fn take_viewport_dirty() -> bool {
        VIEWPORT_DIRTY.swap(false, Ordering::AcqRel)
    }

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// Set/clear the easing-to-full latch, stamping when it engaged so it can
    /// be force-recovered if it ever overstays its welcome.
    fn set_pending_full_lock(on: bool) {
        PENDING_FULL_LOCK.store(on, Ordering::Release);
        PENDING_FULL_LOCK_SINCE_MS.store(if on { now_ms() } else { 0 }, Ordering::Release);
    }

    /// True while genuinely easing to full 9×16. Self-heals: if the latch has
    /// been set longer than `MAX_PENDING_FULL_MS` it is force-cleared (and any
    /// queued wheel dropped) so a stranded ease can never swallow Alt+scroll
    /// forever. Safe to call from the hook or the follow thread.
    fn pending_full_lock_active() -> bool {
        if !PENDING_FULL_LOCK.load(Ordering::Acquire) {
            return false;
        }
        let since = PENDING_FULL_LOCK_SINCE_MS.load(Ordering::Acquire);
        if since != 0 && now_ms().saturating_sub(since) > MAX_PENDING_FULL_MS {
            set_pending_full_lock(false);
            *PENDING_WHEEL_NOTCHES.lock() = 0.0;
            clear_gesture_zoom_state();
            alt_log("recovered stuck easing-to-full latch — Alt+scroll re-armed");
            return false;
        }
        true
    }

    fn alt_held() -> bool {
        unsafe {
            let left = GetAsyncKeyState(VK_MENU.0 as i32) as u16;
            let right = GetAsyncKeyState(VK_RMENU.0 as i32) as u16;
            let held = (left & 0x8000) != 0 || (right & 0x8000) != 0;
            // Always mirror physical Alt — a missed WM_SYSKEYUP (focus churn
            // when minimizing/restoring between recordings) must not leave a
            // stale true that swallows Alt+arrow without zooming.
            ALT_HELD.store(held, Ordering::Release);
            held
        }
    }

    fn is_alt_vk(vk: u32) -> bool {
        vk == VK_MENU.0 as u32 || vk == VK_RMENU.0 as u32
    }

    fn release_alt_zoom_state() {
        let pending = *PENDING_WHEEL_NOTCHES.lock();
        set_pending_full_lock(false);
        clear_gesture_zoom_state();
        *ZOOM_LOCK_UNTIL.lock() = None;
        let _ = alt_held();
        if pending.abs() > f64::EPSILON {
            alt_log(&format!("key up — cleared pending wheel notches {pending:.3}"));
        } else {
            alt_log("key up — zoom state reset");
        }
    }

    fn reset_zoom_input_state(viewport: &SharedViewport) {
        set_pending_full_lock(false);
        clear_gesture_zoom_state();
        *ZOOM_LOCK_UNTIL.lock() = None;
        reset_pan_cursor_filter();
        let _ = alt_held();
        let vp = viewport.lock();
        sync_zoom_at_min(vp.zoom_target, vp.viewport.orientation);
        alt_log("capture input reset");
    }

    fn zoom_hold_active() -> bool {
        let mut slot = ZOOM_LOCK_UNTIL.lock();
        match slot.as_ref() {
            Some(until) if Instant::now() < *until => true,
            Some(_) => {
                *slot = None;
                false
            }
            None => false,
        }
    }

    /// True while easing to, or holding at, full 9×16 — Alt+wheel is swallowed and ignored.
    fn scroll_input_blocked() -> bool {
        zoom_hold_active() || pending_full_lock_active()
    }

    fn engage_full_frame_hold() {
        set_pending_full_lock(false);
        clear_gesture_zoom_state();
        *ZOOM_LOCK_UNTIL.lock() = Some(Instant::now() + FULL_FRAME_LOCK);
        alt_log("landed full 9×16 — 0.4s scroll lock");
    }

    fn aim_full_frame(vp: &mut ViewportState) {
        vp.zoom_target = 1.0;
        set_pending_full_lock(true);
        clear_gesture_zoom_state();
        restart_zoom_ease(vp.viewport.zoom, 1.0, ZOOM_TICKS_PER_NOTCH);
        alt_log("snap toward full 9×16");
    }

    enum WheelApply {
        Applied,
        Ignored,
    }

    /// Per-press keyboard zoom — one key repeat = one wheel notch (13 virtual ticks).
    const KEY_ZOOM_NOTCHES: f64 = 1.0;

    fn zoom_key_dir(vk: u32) -> Option<f64> {
        if vk == VK_UP.0 as u32 {
            Some(1.0)
        } else if vk == VK_DOWN.0 as u32 {
            Some(-1.0)
        } else {
            None
        }
    }

    fn promo_blocks_zoom() -> bool {
        let Some(ctx) = CTX.get() else {
            return false;
        };
        let st = ctx.state.lock();
        // Block zoom only during the demo-only phase (P/L badge). Allow during inner countdown + take.
        st.promo_mode.is_some() && !st.promo_inner_active && !st.recording_armed
    }

    fn game_blocks_zoom() -> bool {
        let Some(ctx) = CTX.get() else {
            return false;
        };
        let st = ctx.state.lock();
        st.recording_settings.game_mode && st.promo_mode.is_none()
    }

    fn mode_blocks_zoom() -> bool {
        promo_blocks_zoom() || game_blocks_zoom()
    }

    /// Queue a zoom step (shared by the low-level hook and global shortcuts).
    fn queue_zoom_step(dir: f64) -> bool {
        if mode_blocks_zoom() {
            if game_blocks_zoom() {
                alt_log_throttled("zoom blocked — game mode", 400);
            } else {
                alt_log_throttled("zoom blocked during promo usage phase", 400);
            }
            return true;
        }
        if dir < 0.0 && ZOOM_AT_MIN.load(Ordering::Acquire) {
            alt_log_throttled("key zoom-out dropped — already at min zoom (full desktop)", 600);
            return true;
        }
        if scroll_input_blocked() {
            alt_log_throttled(
                &format!("key zoom swallowed while blocked ({})", scroll_block_reason()),
                400,
            );
            return true;
        }
        let step = dir * KEY_ZOOM_NOTCHES;
        let queued = {
            let mut acc = PENDING_WHEEL_NOTCHES.lock();
            *acc = (*acc + step).clamp(-MAX_PENDING_NOTCHES, MAX_PENDING_NOTCHES);
            *acc
        };
        alt_log(&format!(
            "key zoom notch {step:.2} ({:.0} virtual ticks pending)",
            queued * ZOOM_TICKS_PER_NOTCH
        ));
        true
    }

    pub fn queue_keyboard_zoom(dir: f64) -> bool {
        queue_zoom_step(dir)
    }

    fn wheel_delta_from_hook(mouse_data: u32) -> f64 {
        let steps = ((mouse_data >> 16) as i16) as f64 / 120.0;
        // Trackpads often emit smaller deltas — keep zoom responsive.
        if steps.abs() > 0.0 && steps.abs() < 0.35 {
            steps * 2.5
        } else {
            steps
        }
    }

    /// Hook thread: track Alt reliably; swallow Alt+wheel (never touch viewport mutex).
    unsafe extern "system" fn keyboard_ll_proc(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code == HC_ACTION as i32 {
            let msg = wparam.0 as u32;
            if matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN | WM_KEYUP | WM_SYSKEYUP) {
                let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
                if is_alt_vk(kb.vkCode) {
                    match msg {
                        WM_KEYDOWN | WM_SYSKEYDOWN => {
                            if !ALT_HELD.swap(true, Ordering::Release) {
                                alt_log("key down");
                            }
                        }
                        _ => release_alt_zoom_state(),
                    }
                } else if matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN) {
                    // Keyboard zoom fallback (works on trackpads, which never
                    // deliver wheel events to global hooks). WM_SYSKEYDOWN means
                    // Alt is held — don't rely on GetAsyncKeyState alone.
                    if let Some(dir) = zoom_key_dir(kb.vkCode) {
                        let sys = msg == WM_SYSKEYDOWN;
                        if sys {
                            ALT_HELD.store(true, Ordering::Release);
                        }
                        if (sys || alt_held()) && queue_zoom_step(dir) {
                            return LRESULT(1);
                        }
                    }
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    /// Hook thread: swallow Alt+wheel (never touch viewport mutex — that starved cursor follow).
    unsafe extern "system" fn mouse_ll_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code < 0 {
            return CallNextHookEx(None, code, wparam, lparam);
        }
        if code != HC_ACTION as i32 {
            return CallNextHookEx(None, code, wparam, lparam);
        }

        let msg = wparam.0 as u32;
        if (msg == WM_MOUSEWHEEL || msg == WM_MOUSEHWHEEL) && alt_held() {
            if scroll_input_blocked() {
                let reason = scroll_block_reason();
                alt_log_throttled(
                    &format!("wheel swallowed while blocked ({reason}) — pan still active"),
                    400,
                );
            } else {
                let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
                let mut delta = wheel_delta_from_hook(info.mouseData);
                if msg == WM_MOUSEHWHEEL {
                    delta = -delta;
                }
                if delta.abs() > f64::EPSILON {
                    // Drop scroll-in attempts when already at zoom min (avoids queued-but-ignored buildup).
                    if delta < 0.0 {
                        if ZOOM_AT_MIN.load(Ordering::Acquire) {
                            alt_log_throttled(
                                "wheel dropped — already at min zoom (full desktop)",
                                600,
                            );
                            return LRESULT(1);
                        }
                    }
                    let queued = {
                        let mut acc = PENDING_WHEEL_NOTCHES.lock();
                        *acc = (*acc + delta).clamp(-MAX_PENDING_NOTCHES, MAX_PENDING_NOTCHES);
                        *acc
                    };
                    alt_log(&format!(
                        "wheel queued {delta:.3} notches ({:.0} virtual ticks total, hwheel={})",
                        queued * ZOOM_TICKS_PER_NOTCH,
                        msg == WM_MOUSEHWHEEL
                    ));
                }
            }
            return LRESULT(1);
        }

        if msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN {
            crate::click_audio::record_click(crate::file_record::session_t_secs());
        }

        if msg == WM_MOUSEMOVE {
            let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            crate::cursor::record_hook_move(info.pt.x, info.pt.y);
        }

        CallNextHookEx(None, code, wparam, lparam)
    }

    /// Follow thread: merge queued notches into the active gesture target.
    fn drain_pending_wheel(ctx: &Ctx) -> bool {
        if scroll_input_blocked() {
            let dropped = *PENDING_WHEEL_NOTCHES.lock();
            if dropped.abs() > f64::EPSILON {
                clear_gesture_zoom_state();
                alt_log_throttled(
                    &format!(
                        "dropped pending {dropped:.3} notches while blocked ({})",
                        scroll_block_reason()
                    ),
                    400,
                );
            }
            return false;
        }

        const MIN_NOTCH: f64 = 1.0e-4;
        let notches = {
            let mut acc = PENDING_WHEEL_NOTCHES.lock();
            if acc.abs() < MIN_NOTCH {
                return false;
            }
            let take = *acc;
            *acc = 0.0;
            take
        };
        match apply_wheel_notches(ctx, notches) {
            WheelApply::Applied => true,
            WheelApply::Ignored => false,
        }
    }

    fn apply_wheel_notches(ctx: &Ctx, notches: f64) -> WheelApply {
        if notches.abs() < f64::EPSILON {
            return WheelApply::Ignored;
        }
        if game_blocks_zoom() {
            alt_log_throttled("wheel ignored — game mode", 600);
            return WheelApply::Ignored;
        }

        let mut vp = ctx.viewport.lock();
        let orientation = vp.viewport.orientation;
        let sensitivity = vp.zoom_sensitivity;

        if notches < 0.0 && vp.viewport.zoom <= zoom_min_for(orientation) + 0.001 {
            alt_log_throttled(
                if orientation == Orientation::Landscape {
                    "wheel ignored — already at min zoom (full 16×9)"
                } else {
                    "wheel ignored — already at min zoom (full desktop)"
                },
                600,
            );
            return WheelApply::Ignored;
        }

        let mut ticks = *GESTURE_TICKS.lock();
        let mut anchor = *GESTURE_ANCHOR_ZOOM.lock();

        if anchor.is_none() {
            anchor = Some(vp.viewport.zoom);
            *GESTURE_ANCHOR_ZOOM.lock() = anchor;
        }
        let anchor = anchor.unwrap_or(vp.viewport.zoom);

        let prev_ticks = ticks;
        ticks += notches * ZOOM_TICKS_PER_NOTCH;
        *GESTURE_TICKS.lock() = ticks;

        let prev_target = vp.zoom_target;
        let raw_target = zoom_from_gesture_ticks(anchor, ticks, sensitivity, orientation);

        if let Some(canonical) = crosses_canonical_zoom(prev_target, raw_target, orientation) {
            if (canonical - 1.0).abs() <= crate::geometry::ZOOM_SNAP_EPS {
                set_pending_full_lock(true);
            } else {
                set_pending_full_lock(false);
            }
            vp.zoom_target = canonical;
            sync_zoom_at_min(canonical, orientation);
            retarget_zoom_ease(
                vp.viewport.zoom,
                canonical,
                ticks,
                notches.abs() * ZOOM_TICKS_PER_NOTCH,
                true,
            );
            mark_viewport_dirty();
            return WheelApply::Applied;
        }

        let next = clamp_zoom(raw_target, orientation);
        if (next - prev_target).abs() <= f64::EPSILON && (next - vp.viewport.zoom).abs() <= f64::EPSILON {
            if vp.viewport.zoom >= crate::geometry::ZOOM_MAX - 0.001 && notches > 0.0 {
                alt_log_throttled("wheel ignored — already at max zoom", 600);
            } else {
                alt_log_throttled(&format!("wheel ignored — zoom clamped at {next:.2}"), 800);
            }
            *GESTURE_TICKS.lock() = prev_ticks;
            return WheelApply::Ignored;
        }

        set_pending_full_lock(false);
        vp.zoom_target = next;
        sync_zoom_at_min(next, orientation);

        retarget_zoom_ease(
            vp.viewport.zoom,
            next,
            ticks,
            notches.abs() * ZOOM_TICKS_PER_NOTCH,
            false,
        );

        let (x, y, z) = (vp.viewport.x, vp.viewport.y, vp.viewport.zoom);
        alt_log(&format!(
            "zoom gesture {prev_ticks:.0}→{ticks:.0} ticks → target {prev_target:.2}→{next:.2} (now {z:.2} @ {x:.0},{y:.0})"
        ));
        mark_viewport_dirty();
        WheelApply::Applied
    }

    pub fn start(app: AppHandle, viewport: SharedViewport, state: SharedState) {
        // Single lock guard — two lock() calls in one statement deadlock on the same thread.
        let _ = CTX.set(Ctx {
            viewport: viewport.clone(),
            state,
            app,
        });
        let vp = viewport.lock();
        sync_zoom_at_min(vp.zoom_target, vp.viewport.orientation);
        std::thread::spawn(|| unsafe {
            run_message_loop();
        });
    }

    unsafe fn run_message_loop() {
        let hinstance = match GetModuleHandleW(None) {
            Ok(h) => h,
            Err(_) => return,
        };
        let hinst = HINSTANCE(hinstance.0);

        let hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_ll_proc), Some(hinst), 0) {
            Ok(h) => h,
            Err(_) => return,
        };

        let _kb_hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_ll_proc), Some(hinst), 0)
        {
            Ok(h) => h,
            Err(_) => return,
        };

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook);
        let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(_kb_hook);
    }

    /// Cursor follow only updates shared viewport state; overlay refresh runs on
    /// the main thread via `commands::start_overlay_refresh_loop`.
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

    fn cursor_pos_for_monitor(
        origin_x: i32,
        origin_y: i32,
        width: f64,
        height: f64,
    ) -> Option<(f64, f64)> {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        for attempt in 0..3 {
            let mut pt = POINT::default();
            let ok = unsafe { GetCursorPos(&mut pt).is_ok() };
            if ok {
                let x = pt.x as f64 - origin_x as f64;
                let y = pt.y as f64 - origin_y as f64;
                return Some((clamp(x, 0.0, width), clamp(y, 0.0, height)));
            }
            if attempt + 1 < 3 {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        None
    }

    fn advance_viewport(viewport: &SharedViewport, state: &SharedState, dt_secs: f64) -> (bool, Option<(f64, f64)>) {
        let hold = zoom_hold_active();
        let pending = PENDING_FULL_LOCK.load(Ordering::Acquire);
        let (input, game_viewport_active, game_pan_mode) = {
            let st = state.lock();
            (
                st.input_settings,
                st.recording_settings.game_mode && st.promo_mode.is_none(),
                st.recording_settings.game_pan_mode,
            )
        };
        let follow = if game_viewport_active
            && {
                let vp = viewport.lock();
                vp.viewport.orientation == Orientation::Portrait && game_pan_mode == GamePanMode::Cursor
            }
        {
            pan_follow_profile_game()
        } else {
            pan_follow_profile(input.follow_speed)
        };

        let mut sample_pos = None;
        let mut vp = viewport.lock();

        let ox = vp.viewport.x;
        let oy = vp.viewport.y;
        let oz = vp.viewport.zoom;

        let pin_center = game_viewport_active
            && (vp.viewport.orientation == Orientation::Landscape
                || game_pan_mode == GamePanMode::Crosshair);

        if let Some(m) = vp.monitor.clone() {
            let cx = m.width as f64 / 2.0;
            let cy = m.height as f64 / 2.0;

            if pin_center {
                vp.viewport.x = cx;
                vp.viewport.y = cy;
            } else if !vp.frame_frozen {
                crate::cursor::set_capture_space(m.origin_x, m.origin_y, m.width, m.height);
                if let Some((tx, ty)) = cursor_pos_for_monitor(
                    m.origin_x,
                    m.origin_y,
                    m.width as f64,
                    m.height as f64,
                ) {
                    let (tx, ty) = filter_pan_cursor(
                        tx,
                        ty,
                        dt_secs,
                        follow.euro_min_cutoff,
                        follow.euro_beta,
                    );
                    sample_pos = Some((tx, ty));
                    let (pan_hz, speed_mult) = if let Some(at) = vp.frame_unfreeze_at {
                        let elapsed = Instant::now().duration_since(at).as_secs_f64();
                        let dur = UNFREEZE_EASE_DURATION.as_secs_f64();
                        if elapsed >= dur {
                            vp.frame_unfreeze_at = None;
                            let hz = if alt_held() {
                                follow.smooth_hz_alt
                            } else {
                                follow.smooth_hz
                            };
                            (hz, 1.0)
                        } else {
                            // Ease-in: gentle acceleration off a frozen frame.
                            let t = (elapsed / dur).clamp(0.0, 1.0);
                            let ease = t * t;
                            let target_hz = if alt_held() {
                                follow.smooth_hz_alt
                            } else {
                                follow.smooth_hz
                            };
                            (
                                UNFREEZE_PAN_HZ_START + (target_hz - UNFREEZE_PAN_HZ_START) * ease,
                                UNFREEZE_SPEED_START + (1.0 - UNFREEZE_SPEED_START) * ease,
                            )
                        }
                    } else if alt_held() {
                        (follow.smooth_hz_alt, 1.0)
                    } else {
                        (follow.smooth_hz, 1.0)
                    };

                    let max_pan_speed = pan_max_speed_for_zoom(
                        vp.viewport.zoom,
                        PAN_MAX_SPEED_BASE,
                        PAN_MAX_SPEED_WIDE_SCALE,
                        PAN_MAX_SPEED_TIGHT_SCALE,
                    ) * speed_mult
                        * follow.max_speed_mult;

                    let follow_ty = if game_viewport_active
                        && vp.viewport.orientation == Orientation::Portrait
                        && game_pan_mode == GamePanMode::Cursor
                    {
                        cy
                    } else {
                        ty
                    };

                    let (nx, ny) = advance_pan_follow(
                        vp.viewport.x,
                        vp.viewport.y,
                        tx,
                        follow_ty,
                        pan_hz,
                        dt_secs,
                        follow.soft_inner_px,
                        follow.soft_outer_px,
                        follow.soft_inner_scale,
                        max_pan_speed,
                    );
                    let (out_w, out_h) = output_dims(vp.viewport.orientation, 1080);
                    let layout = frame_layout(&vp.viewport, m.width, m.height, out_w, out_h);
                    let soft = edge_soft_zone_px(layout.crop.w, layout.crop.h);
                    let (min_x, max_x, min_y, max_y) =
                        viewport_center_bounds(&vp.viewport, m.width, m.height);
                    let (mut nx, mut ny) = apply_edge_soft_pan(
                        vp.viewport.x,
                        vp.viewport.y,
                        nx,
                        ny,
                        min_x,
                        max_x,
                        min_y,
                        max_y,
                        soft,
                    );
                    let zoom_easing = zoom_ease_active();
                    if pending || zoom_easing {
                        (nx, ny) = converge_center_to_bounds(
                            nx,
                            ny,
                            min_x,
                            max_x,
                            min_y,
                            max_y,
                            follow.bounds_converge_hz,
                            dt_secs,
                        );
                    }
                    if game_viewport_active
                        && vp.viewport.orientation == Orientation::Portrait
                        && game_pan_mode == GamePanMode::Cursor
                    {
                        ny = cy;
                    }
                    vp.viewport.x = nx;
                    vp.viewport.y = ny;

                    if let Some(usage) = vp.promo_usage_viewport.as_mut() {
                        // Usage track always stays full-frame — never mirror inner pan/zoom
                        // (including during the inner countdown while the overlay shows the crop).
                        let mut usage_vp = *usage;
                        usage_vp.zoom = 1.0;
                        let (out_w, out_h) = output_dims(usage.orientation, 1080);
                        let layout = frame_layout(&usage_vp, m.width, m.height, out_w, out_h);
                        let soft = edge_soft_zone_px(layout.crop.w, layout.crop.h);
                        let (min_x, max_x, min_y, max_y) =
                            viewport_center_bounds(&usage_vp, m.width, m.height);
                        let (ux, uy) = advance_pan_follow(
                            usage.x,
                            usage.y,
                            tx,
                            ty,
                            pan_hz,
                            dt_secs,
                            follow.soft_inner_px,
                            follow.soft_outer_px,
                            follow.soft_inner_scale,
                            max_pan_speed,
                        );
                        let (ux, uy) = apply_edge_soft_pan(
                            usage.x,
                            usage.y,
                            ux,
                            uy,
                            min_x,
                            max_x,
                            min_y,
                            max_y,
                            soft,
                        );
                        usage.x = ux;
                        usage.y = uy;
                        usage.zoom = 1.0;
                    }

                    let dist = (vp.viewport.x - tx).abs() + (vp.viewport.y - ty).abs();
                    if dist <= UNFREEZE_ARRIVED_PX {
                        vp.frame_unfreeze_at = None;
                    }
                } else {
                    alt_log_throttled("cursor read failed — pan paused", 2000);
                }
            }
        }

        sync_zoom_at_min(vp.zoom_target, vp.viewport.orientation);

        if game_viewport_active {
            vp.zoom_target = 1.0;
            vp.viewport.zoom = 1.0;
            *ZOOM_EASE_START.lock() = None;
            sync_zoom_at_min(1.0, vp.viewport.orientation);
        }

        if hold {
            vp.zoom_target = 1.0;
            vp.viewport.zoom = 1.0;
            *ZOOM_EASE_START.lock() = None;
        } else if zoom_ease_active() {
            let settled = advance_zoom_ease(&mut vp, dt_secs);

            if pending && settled && (vp.viewport.zoom - 1.0).abs() <= FULL_FRAME_SETTLE {
                vp.viewport.zoom = 1.0;
                vp.zoom_target = 1.0;
                *ZOOM_EASE_START.lock() = None;
                drop(vp);
                engage_full_frame_hold();
                return (true, sample_pos);
            }
        } else if (vp.viewport.zoom - vp.zoom_target).abs() > FULL_FRAME_SETTLE {
            let ticks = *GESTURE_TICKS.lock();
            restart_zoom_ease(vp.viewport.zoom, vp.zoom_target, ticks);
            let _ = advance_zoom_ease(&mut vp, dt_secs);
        }

        let pan = (vp.viewport.x - ox).abs() + (vp.viewport.y - oy).abs();
        let zoom = (vp.viewport.zoom - oz).abs();
        let moved = pan > 0.05 || zoom > 0.0005;
        if moved {
            mark_viewport_dirty();
        }
        (moved, sample_pos)
    }

    fn zoom_animating(viewport: &SharedViewport) -> bool {
        if zoom_hold_active() {
            return false;
        }
        if zoom_ease_active() {
            return true;
        }
        let vp = viewport.lock();
        (vp.viewport.zoom - vp.zoom_target).abs() > FULL_FRAME_SETTLE
    }

    pub fn advance_viewport_follow(viewport: &SharedViewport, state: &SharedState) -> bool {
        let now = Instant::now();
        let dt = {
            let mut last = LAST_FOLLOW.lock();
            let dt = last
                .map(|t| now.duration_since(t).as_secs_f64())
                .unwrap_or(CURSOR_TICK_MS as f64 / 1000.0)
                .clamp(1.0 / 240.0, 0.05);
            *last = Some(now);
            dt
        };

        if let Some(ctx) = CTX.get() {
            let _ = drain_pending_wheel(ctx);
        }

        let (moved, sample_pos) = advance_viewport(viewport, state, dt);
        if let Some((x, y)) = sample_pos {
            crate::cursor::record_follow_sample(x, y, pointer_button_state());
        }
        let animating = zoom_animating(viewport);
        moved || animating
    }

    pub fn start_cursor_follow(_app: AppHandle, viewport: SharedViewport, state: SharedState) {
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(CURSOR_TICK_MS));
            let _ = advance_viewport_follow(&viewport, &state);
        });
    }

    /// Toggle frame freeze during countdown or recording. Returns the new frozen state.
    pub fn toggle_frame_frozen() -> Option<bool> {
        let ctx = CTX.get()?;
        {
            let st = ctx.state.lock();
            if !st.recording && !st.recording_armed {
                return None;
            }
        }

        let frozen = {
            let mut vp = ctx.viewport.lock();
            let was_frozen = vp.frame_frozen;
            vp.frame_frozen = !was_frozen;
            if was_frozen && !vp.frame_frozen {
                vp.frame_unfreeze_at = Some(Instant::now());
                alt_log("frame unfrozen — easing back to cursor");
            } else if vp.frame_frozen {
                vp.frame_unfreeze_at = None;
                alt_log("frame frozen");
            }
            mark_viewport_dirty();
            vp.frame_frozen
        };

        let _ = ctx.app.emit("frame:freeze", serde_json::json!({ "frozen": frozen }));
        if let Some(overlay) = ctx.app.get_webview_window("overlay") {
            let _ = overlay.emit("frame:freeze", serde_json::json!({ "frozen": frozen }));
        }

        Some(frozen)
    }

    pub fn reset_frame_follow(viewport: &SharedViewport) {
        reset_zoom_input_state(viewport);
        let mut vp = viewport.lock();
        vp.frame_frozen = false;
        vp.frame_unfreeze_at = None;
        vp.promo_usage_viewport = None;
        vp.promo_inner_viewport = None;
        mark_viewport_dirty();
    }

    /// Keep the usage-track viewport alive for the whole promo session.
    pub fn ensure_promo_usage_viewport(viewport: &SharedViewport, mode: PromoMode) {
        let mut vp = viewport.lock();
        if vp.promo_usage_viewport.is_some() {
            return;
        }
        let orientation = match mode {
            PromoMode::Portrait => Orientation::Portrait,
            PromoMode::Landscape => Orientation::Landscape,
        };
        let (cx, cy) = vp
            .monitor
            .as_ref()
            .map(|m| (m.width as f64 / 2.0, m.height as f64 / 2.0))
            .unwrap_or((vp.viewport.x, vp.viewport.y));
        vp.promo_usage_viewport = Some(Viewport {
            x: cx,
            y: cy,
            zoom: 1.0,
            rotation: 0.0,
            orientation,
        });
        mark_viewport_dirty();
    }

    /// Hard reset before a new recording's countdown. Clears EVERY zoom/pan
    /// input latch and returns the frame to full 9×16 centered on the monitor —
    /// so a clip that ended zoomed all the way out (or any stuck snap/hold/
    /// at-min latch) can never carry over and swallow Alt+↑/↓ on the next take.
    pub fn reset_for_new_recording(viewport: &SharedViewport, mode: Option<PromoMode>) {
        set_pending_full_lock(false);
        clear_gesture_zoom_state();
        *ZOOM_LOCK_UNTIL.lock() = None;
        *LAST_FOLLOW.lock() = None;
        reset_pan_cursor_filter();
        // Re-sync Alt to the physical key (drops any stale held=true).
        let _ = alt_held();

        {
            let mut vp = viewport.lock();
            vp.frame_frozen = false;
            vp.frame_unfreeze_at = None;
            vp.zoom_target = 1.0;
            vp.viewport.zoom = 1.0;
            let center = vp
                .monitor
                .as_ref()
                .map(|m| (m.width as f64 / 2.0, m.height as f64 / 2.0));
            if let Some((cx, cy)) = center {
                vp.viewport.x = cx;
                vp.viewport.y = cy;
            }
            if let Some(mode) = mode {
                let orientation = match mode {
                    PromoMode::Portrait => Orientation::Portrait,
                    PromoMode::Landscape => Orientation::Landscape,
                };
                vp.viewport.orientation = orientation;
                vp.promo_usage_viewport = Some(Viewport {
                    x: vp.viewport.x,
                    y: vp.viewport.y,
                    zoom: 1.0,
                    rotation: 0.0,
                    orientation,
                });
                crate::log::capture_log(
                    "Promo recording — usage track locked at full frame; pan follows cursor",
                );
            } else {
                vp.promo_usage_viewport = None;
            }
        }

        // zoom_target is 1.0 now, so the at-min latch must read false.
        sync_zoom_at_min(1.0, viewport.lock().viewport.orientation);
        mark_viewport_dirty();
        alt_log("new recording — frame reset to full 9×16, input latches cleared");
    }

    /// Snap viewport to game-mode framing (full frame, centered).
    pub fn apply_game_mode_viewport(viewport: &SharedViewport) {
        clear_gesture_zoom_state();
        set_pending_full_lock(false);
        *ZOOM_LOCK_UNTIL.lock() = None;
        reset_pan_cursor_filter();
        let mut vp = viewport.lock();
        vp.zoom_target = 1.0;
        vp.viewport.zoom = 1.0;
        let center = vp
            .monitor
            .as_ref()
            .map(|m| (m.width as f64 / 2.0, m.height as f64 / 2.0));
        if let Some((cx, cy)) = center {
            vp.viewport.x = cx;
            vp.viewport.y = cy;
        }
        sync_zoom_at_min(1.0, vp.viewport.orientation);
        mark_viewport_dirty();
    }
}

#[cfg(windows)]
pub use imp::{
    apply_game_mode_viewport, ensure_promo_usage_viewport, queue_keyboard_zoom,
    reset_for_new_recording, reset_frame_follow, reset_pan_follow_tuning, start,
    start_cursor_follow, toggle_frame_frozen,
};

#[cfg(not(windows))]
pub fn queue_keyboard_zoom(_dir: f64) -> bool {
    false
}

#[cfg(not(windows))]
pub fn reset_pan_follow_tuning() {}

#[cfg(not(windows))]
pub fn take_viewport_dirty() -> bool {
    false
}

#[cfg(not(windows))]
pub fn toggle_frame_frozen() -> Option<bool> {
    None
}

#[cfg(not(windows))]
pub fn ensure_promo_usage_viewport(_viewport: SharedViewport, _mode: crate::state::PromoMode) {}

#[cfg(not(windows))]
pub fn reset_frame_follow(_viewport: &SharedViewport) {}

#[cfg(not(windows))]
pub fn reset_for_new_recording(_viewport: SharedViewport, _mode: Option<crate::state::PromoMode>) {}

#[cfg(not(windows))]
pub fn start(_app: tauri::AppHandle, _viewport: SharedViewport, _state: SharedState) {}

#[cfg(not(windows))]
pub fn start_cursor_follow(
    _app: tauri::AppHandle,
    _viewport: SharedViewport,
    _state: SharedState,
) {}

#[cfg(not(windows))]
pub fn apply_game_mode_viewport(_viewport: &SharedViewport) {}
