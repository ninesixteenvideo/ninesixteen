use crate::state::{SharedState, SharedViewport};

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::geometry::{
        advance_pan_follow, clamp, normalize_zoom, pan_max_speed_for_zoom, smooth_toward_capped,
        zoom_max_vel_for_level, zoom_min_for, ZOOM_SNAP_EPS,
    };
    use crate::state::Orientation;
    use crate::log::capture_log;
    use crate::state::ViewportState;
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
        WM_KEYDOWN, WM_KEYUP, WM_MOUSEHWHEEL, WM_MOUSEWHEEL, WM_SYSKEYDOWN, WM_SYSKEYUP,
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
    /// Wheel deltas queued by the hook; drained on the follow thread only.
    static PENDING_WHEEL_DELTA: parking_lot::Mutex<f64> = parking_lot::Mutex::new(0.0);
    static LAST_ALT_DEBUG_MS: AtomicU64 = AtomicU64::new(0);
    /// Cached so the mouse hook never locks the viewport mutex (that starved pan follow).
    static ZOOM_AT_MIN: AtomicBool = AtomicBool::new(false);
    static VIEWPORT_DIRTY: AtomicBool = AtomicBool::new(false);

    const CURSOR_TICK_MS: u64 = 8;
    // Lower Hz = longer ease-in before the velocity cap engages (cinematic ramp).
    const PAN_SMOOTH_HZ: f64 = 6.2;
    const PAN_SMOOTH_HZ_ALT: f64 = 7.0;
    const PAN_SMOOTH_HZ_UNFREEZE: f64 = 4.2;
    const UNFREEZE_EASE_DURATION: Duration = Duration::from_millis(2500);
    const UNFREEZE_ARRIVED_PX: f64 = 10.0;
    // Lower = creamier zoom glide toward the target.
    const ZOOM_SMOOTH_HZ: f64 = 3.0;
    /// Base max zoom change per second at zoom 1.0; scaled by level below.
    const ZOOM_MAX_VEL_BASE: f64 = 0.55;
    const ZOOM_VEL_MIN_SCALE: f64 = 0.82;
    const ZOOM_VEL_MAX_SCALE: f64 = 2.6;
    // Soft zone: crawl while the cursor is near the current frame center.
    const PAN_SOFT_INNER_PX: f64 = 42.0;
    const PAN_SOFT_OUTER_PX: f64 = 265.0;
    const PAN_SOFT_INNER_SCALE: f64 = 0.16;
    /// Base pan cap at zoom 1.0 (monitor px/s); scaled down when wide, up when tight.
    const PAN_MAX_SPEED_BASE: f64 = 860.0;
    const PAN_MAX_SPEED_WIDE_SCALE: f64 = 0.72;
    const PAN_MAX_SPEED_TIGHT_SCALE: f64 = 1.28;
    // Gentler per-notch magnitude so each scroll step eases rather than jumps.
    const WHEEL_ZOOM_STEP: f64 = 0.075;
    const FULL_FRAME_SETTLE: f64 = 0.012;
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
            *PENDING_WHEEL_DELTA.lock() = 0.0;
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
        let pending = *PENDING_WHEEL_DELTA.lock();
        set_pending_full_lock(false);
        *PENDING_WHEEL_DELTA.lock() = 0.0;
        *ZOOM_LOCK_UNTIL.lock() = None;
        let _ = alt_held();
        if pending.abs() > f64::EPSILON {
            alt_log(&format!("key up — cleared pending wheel delta {pending:.3}"));
        } else {
            alt_log("key up — zoom state reset");
        }
    }

    fn reset_zoom_input_state(viewport: &SharedViewport) {
        set_pending_full_lock(false);
        *PENDING_WHEEL_DELTA.lock() = 0.0;
        *ZOOM_LOCK_UNTIL.lock() = None;
        let _ = alt_held();
        sync_zoom_at_min(viewport.lock().zoom_target, viewport.lock().viewport.orientation);
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
        *PENDING_WHEEL_DELTA.lock() = 0.0;
        *ZOOM_LOCK_UNTIL.lock() = Some(Instant::now() + FULL_FRAME_LOCK);
        alt_log("landed full 9×16 — 0.4s scroll lock");
    }

    fn aim_full_frame(vp: &mut ViewportState) {
        vp.zoom_target = 1.0;
        set_pending_full_lock(true);
        *PENDING_WHEEL_DELTA.lock() = 0.0;
        alt_log("snap toward full 9×16");
    }

    fn hits_full_frame_snap(prev: f64, raw_next: f64) -> bool {
        if (raw_next - 1.0).abs() <= ZOOM_SNAP_EPS {
            return true;
        }
        (prev - 1.0) * (raw_next - 1.0) < 0.0
    }

    /// Per-press keyboard zoom step. Precision-touchpad two-finger scroll is
    /// never delivered to global mouse hooks (Windows routes it as pointer /
    /// gesture messages to the focused window), so `Alt` + `↑`/`↓` is the
    /// device-independent zoom path. Holding the key auto-repeats for a smooth
    /// continuous zoom.
    const KEY_ZOOM_STEP: f64 = 0.7;

    fn zoom_key_dir(vk: u32) -> Option<f64> {
        if vk == VK_UP.0 as u32 {
            Some(1.0)
        } else if vk == VK_DOWN.0 as u32 {
            Some(-1.0)
        } else {
            None
        }
    }

    /// Queue a zoom step (shared by the low-level hook and global shortcuts).
    fn queue_zoom_step(dir: f64) -> bool {
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
        let step = dir * KEY_ZOOM_STEP;
        let queued = {
            let mut acc = PENDING_WHEEL_DELTA.lock();
            *acc = (*acc + step).clamp(-12.0, 12.0);
            *acc
        };
        alt_log(&format!("key zoom step {step:.2} (total pending {queued:.3})"));
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
                        let mut acc = PENDING_WHEEL_DELTA.lock();
                        // Clamp the backlog so a fast spin (or a trackpad flick that
                        // out-paces the drain) can't build an unbounded zoom burst.
                        *acc = (*acc + delta).clamp(-12.0, 12.0);
                        *acc
                    };
                    alt_log(&format!(
                        "wheel queued delta {delta:.3} (total pending {queued:.3}, hwheel={})",
                        msg == WM_MOUSEHWHEEL
                    ));
                }
            }
            return LRESULT(1);
        }

        CallNextHookEx(None, code, wparam, lparam)
    }

    /// Follow thread: apply queued wheel deltas (single owner of viewport pan/zoom).
    fn drain_pending_wheel(ctx: &Ctx) -> bool {
        if scroll_input_blocked() {
            let dropped = *PENDING_WHEEL_DELTA.lock();
            if dropped.abs() > f64::EPSILON {
                *PENDING_WHEEL_DELTA.lock() = 0.0;
                alt_log_throttled(
                    &format!(
                        "dropped pending delta {dropped:.3} while blocked ({})",
                        scroll_block_reason()
                    ),
                    400,
                );
            }
            return false;
        }

        // Apply the *actual* accumulated delta (fractional for trackpads, whole
        // notches for mice), capped per tick so a big backlog eases in smoothly
        // instead of jolting. Using signum here silently cancelled the small
        // fractional deltas trackpads emit, so Alt+scroll never zoomed on a
        // touchpad — apply the real value instead.
        const MAX_PER_TICK: f64 = 3.0;
        const MIN_APPLY: f64 = 1.0e-3;
        let delta = {
            let mut acc = PENDING_WHEEL_DELTA.lock();
            if acc.abs() < MIN_APPLY {
                *acc = 0.0;
                return false;
            }
            let take = acc.clamp(-MAX_PER_TICK, MAX_PER_TICK);
            *acc -= take;
            take
        };
        apply_wheel_delta(ctx, delta)
    }

    fn apply_wheel_delta(ctx: &Ctx, delta: f64) -> bool {
        if delta.abs() < f64::EPSILON {
            return false;
        }

        let mut vp = ctx.viewport.lock();

        // Note: we deliberately do NOT snap the viewport center to the cursor on
        // each wheel notch. The pan system in `advance_viewport` already eases the
        // center toward the live cursor every frame, so letting that lazy follow
        // lead — while zoom animates independently toward `zoom_target` — keeps the
        // glide smooth instead of teleporting the box on every notch.

        let factor = 1.0 + delta * WHEEL_ZOOM_STEP * vp.zoom_sensitivity;
        let prev = vp.zoom_target;
        let raw_next = prev * factor;

        let orientation = vp.viewport.orientation;

        if hits_full_frame_snap(prev, raw_next) {
            aim_full_frame(&mut vp);
            sync_zoom_at_min(vp.zoom_target, orientation);
            mark_viewport_dirty();
            return true;
        }

        let next = normalize_zoom(raw_next, orientation);
        if (next - prev).abs() <= f64::EPSILON {
            if prev <= zoom_min_for(orientation) + 0.001 && delta < 0.0 {
                alt_log_throttled(
                    if orientation == Orientation::Landscape {
                        "wheel ignored — already at min zoom (full 16×9)"
                    } else {
                        "wheel ignored — already at min zoom (full desktop)"
                    },
                    600,
                );
            } else if prev >= crate::geometry::ZOOM_MAX - 0.001 && delta > 0.0 {
                alt_log_throttled("wheel ignored — already at max zoom", 600);
            } else {
                alt_log_throttled(&format!("wheel ignored — zoom clamped at {prev:.2}"), 800);
            }
            return false;
        }

        set_pending_full_lock(false);
        vp.zoom_target = next;
        sync_zoom_at_min(next, orientation);
        let (x, y, z) = (vp.viewport.x, vp.viewport.y, vp.viewport.zoom);
        alt_log(&format!("zoom target {prev:.2} → {next:.2} (viewport @ {x:.0},{y:.0} zoom {z:.2})"));
        mark_viewport_dirty();
        true
    }

    pub fn start(app: AppHandle, viewport: SharedViewport, state: SharedState) {
        let _ = CTX.set(Ctx {
            viewport: viewport.clone(),
            state,
            app,
        });
        sync_zoom_at_min(viewport.lock().zoom_target, viewport.lock().viewport.orientation);
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

    fn advance_viewport(viewport: &SharedViewport, dt_secs: f64) -> bool {
        let hold = zoom_hold_active();
        let pending = PENDING_FULL_LOCK.load(Ordering::Acquire);

        let mut vp = viewport.lock();

        let ox = vp.viewport.x;
        let oy = vp.viewport.y;
        let oz = vp.viewport.zoom;

        if let Some(m) = vp.monitor.as_ref() {
            if !vp.frame_frozen {
                if let Some((tx, ty)) = cursor_pos_for_monitor(
                    m.origin_x,
                    m.origin_y,
                    m.width as f64,
                    m.height as f64,
                ) {
                    let pan_hz = if let Some(at) = vp.frame_unfreeze_at {
                        if Instant::now().duration_since(at) < UNFREEZE_EASE_DURATION {
                            PAN_SMOOTH_HZ_UNFREEZE
                        } else {
                            vp.frame_unfreeze_at = None;
                            if alt_held() {
                                PAN_SMOOTH_HZ_ALT
                            } else {
                                PAN_SMOOTH_HZ
                            }
                        }
                    } else if alt_held() {
                        PAN_SMOOTH_HZ_ALT
                    } else {
                        PAN_SMOOTH_HZ
                    };

                    let max_pan_speed = pan_max_speed_for_zoom(
                        vp.viewport.zoom,
                        PAN_MAX_SPEED_BASE,
                        PAN_MAX_SPEED_WIDE_SCALE,
                        PAN_MAX_SPEED_TIGHT_SCALE,
                    );

                    let (nx, ny) = advance_pan_follow(
                        vp.viewport.x,
                        vp.viewport.y,
                        tx,
                        ty,
                        pan_hz,
                        dt_secs,
                        PAN_SOFT_INNER_PX,
                        PAN_SOFT_OUTER_PX,
                        PAN_SOFT_INNER_SCALE,
                        max_pan_speed,
                    );
                    vp.viewport.x = nx;
                    vp.viewport.y = ny;

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

        if hold {
            vp.zoom_target = 1.0;
            vp.viewport.zoom = 1.0;
        } else {
            vp.viewport.zoom = smooth_toward_capped(
                vp.viewport.zoom,
                vp.zoom_target,
                ZOOM_SMOOTH_HZ,
                dt_secs,
                zoom_max_vel_for_level(
                    vp.viewport.zoom,
                    ZOOM_MAX_VEL_BASE,
                    ZOOM_VEL_MIN_SCALE,
                    ZOOM_VEL_MAX_SCALE,
                ),
            );

            if pending && (vp.viewport.zoom - 1.0).abs() <= FULL_FRAME_SETTLE {
                vp.viewport.zoom = 1.0;
                vp.zoom_target = 1.0;
                drop(vp);
                engage_full_frame_hold();
                return true;
            }
        }

        let pan = (vp.viewport.x - ox).abs() + (vp.viewport.y - oy).abs();
        let zoom = (vp.viewport.zoom - oz).abs();
        let moved = pan > 0.05 || zoom > 0.0005;
        if moved {
            mark_viewport_dirty();
        }
        moved
    }

    fn zoom_animating(viewport: &SharedViewport) -> bool {
        if zoom_hold_active() {
            return false;
        }
        let vp = viewport.lock();
        (vp.viewport.zoom - vp.zoom_target).abs() > FULL_FRAME_SETTLE
    }

    pub fn advance_viewport_follow(viewport: &SharedViewport, _state: &SharedState) -> bool {
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

        let moved = advance_viewport(viewport, dt);
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
        mark_viewport_dirty();
    }

    /// Hard reset before a new recording's countdown. Clears EVERY zoom/pan
    /// input latch and returns the frame to full 9×16 centered on the monitor —
    /// so a clip that ended zoomed all the way out (or any stuck snap/hold/
    /// at-min latch) can never carry over and swallow Alt+↑/↓ on the next take.
    pub fn reset_for_new_recording(viewport: &SharedViewport) {
        set_pending_full_lock(false);
        *PENDING_WHEEL_DELTA.lock() = 0.0;
        *ZOOM_LOCK_UNTIL.lock() = None;
        *LAST_FOLLOW.lock() = None;
        // Re-sync Alt to the physical key (drops any stale held=true).
        let _ = alt_held();

        {
            let mut vp = viewport.lock();
            vp.frame_frozen = false;
            vp.frame_unfreeze_at = None;
            vp.zoom_target = 1.0;
            vp.viewport.zoom = 1.0;
            let center = vp.monitor.as_ref().map(|m| (m.width as f64 / 2.0, m.height as f64 / 2.0));
            if let Some((cx, cy)) = center {
                vp.viewport.x = cx;
                vp.viewport.y = cy;
            }
        }

        // zoom_target is 1.0 now, so the at-min latch must read false.
        sync_zoom_at_min(1.0, viewport.lock().viewport.orientation);
        mark_viewport_dirty();
        alt_log("new recording — frame reset to full 9×16, input latches cleared");
    }
}

#[cfg(windows)]
pub use imp::{
    queue_keyboard_zoom, reset_for_new_recording, reset_frame_follow, start, start_cursor_follow,
    toggle_frame_frozen,
};

#[cfg(not(windows))]
pub fn queue_keyboard_zoom(_dir: f64) -> bool {
    false
}

#[cfg(not(windows))]
pub fn take_viewport_dirty() -> bool {
    false
}

#[cfg(not(windows))]
pub fn toggle_frame_frozen() -> Option<bool> {
    None
}

#[cfg(not(windows))]
pub fn reset_frame_follow(_viewport: SharedViewport) {}

#[cfg(not(windows))]
pub fn reset_for_new_recording(_viewport: SharedViewport) {}

#[cfg(not(windows))]
pub fn start(_app: tauri::AppHandle, _viewport: SharedViewport, _state: SharedState) {}

#[cfg(not(windows))]
pub fn start_cursor_follow(
    _app: tauri::AppHandle,
    _viewport: SharedViewport,
    _state: SharedState,
) {}
