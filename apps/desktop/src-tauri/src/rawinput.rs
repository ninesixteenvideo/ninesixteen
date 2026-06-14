use crate::state::{SharedState, SharedViewport};

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::geometry::{clamp, normalize_zoom, smooth_toward, ZOOM_SNAP_EPS};
    use crate::log::capture_log;
    use crate::state::ViewportState;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};
    use tauri::AppHandle;

    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU, VK_RMENU};
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
    /// Easing toward full 9×16 — ignore Alt+scroll until the 1s hold starts.
    static PENDING_FULL_LOCK: AtomicBool = AtomicBool::new(false);
    /// Wheel deltas queued by the hook; drained on the follow thread only.
    static PENDING_WHEEL_DELTA: parking_lot::Mutex<f64> = parking_lot::Mutex::new(0.0);
    static LAST_ALT_DEBUG_MS: AtomicU64 = AtomicU64::new(0);
    /// Cached so the mouse hook never locks the viewport mutex (that starved pan follow).
    static ZOOM_AT_MIN: AtomicBool = AtomicBool::new(false);
    static VIEWPORT_DIRTY: AtomicBool = AtomicBool::new(false);

    const CURSOR_TICK_MS: u64 = 8;
    const PAN_SMOOTH_HZ: f64 = 11.0;
    const PAN_SMOOTH_HZ_ALT: f64 = 22.0;
    const ZOOM_SMOOTH_HZ: f64 = 3.8;
    const WHEEL_ZOOM_STEP: f64 = 0.09;
    const FULL_FRAME_SETTLE: f64 = 0.012;
    const FULL_FRAME_LOCK: Duration = Duration::from_secs(1);

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

    fn sync_zoom_at_min(zoom_target: f64) {
        ZOOM_AT_MIN.store(
            zoom_target <= crate::geometry::ZOOM_MIN + 0.001,
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

    fn alt_held() -> bool {
        if ALT_HELD.load(Ordering::Acquire) {
            return true;
        }
        unsafe {
            let left = GetAsyncKeyState(VK_MENU.0 as i32) as u16;
            let right = GetAsyncKeyState(VK_RMENU.0 as i32) as u16;
            (left & 0x8000) != 0 || (right & 0x8000) != 0
        }
    }

    fn is_alt_vk(vk: u32) -> bool {
        vk == VK_MENU.0 as u32 || vk == VK_RMENU.0 as u32
    }

    fn release_alt_zoom_state() {
        let pending = *PENDING_WHEEL_DELTA.lock();
        ALT_HELD.store(false, Ordering::Release);
        PENDING_FULL_LOCK.store(false, Ordering::Release);
        *PENDING_WHEEL_DELTA.lock() = 0.0;
        if pending.abs() > f64::EPSILON {
            alt_log(&format!("key up — cleared pending wheel delta {pending:.3}"));
        } else {
            alt_log("key up — zoom state reset");
        }
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
        zoom_hold_active() || PENDING_FULL_LOCK.load(Ordering::Acquire)
    }

    fn engage_full_frame_hold() {
        PENDING_FULL_LOCK.store(false, Ordering::Release);
        *PENDING_WHEEL_DELTA.lock() = 0.0;
        *ZOOM_LOCK_UNTIL.lock() = Some(Instant::now() + FULL_FRAME_LOCK);
        alt_log("landed full 9×16 — 1s scroll lock");
    }

    fn aim_full_frame(vp: &mut ViewportState) {
        vp.zoom_target = 1.0;
        PENDING_FULL_LOCK.store(true, Ordering::Release);
        *PENDING_WHEEL_DELTA.lock() = 0.0;
        alt_log("snap toward full 9×16");
    }

    fn hits_full_frame_snap(prev: f64, raw_next: f64) -> bool {
        if (raw_next - 1.0).abs() <= ZOOM_SNAP_EPS {
            return true;
        }
        (prev - 1.0) * (raw_next - 1.0) < 0.0
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
                        *acc += delta;
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

        let mut applied = false;
        for _ in 0..4 {
            let delta = {
                let mut acc = PENDING_WHEEL_DELTA.lock();
                if acc.abs() < f64::EPSILON {
                    break;
                }
                let step = acc.signum();
                *acc -= step;
                step
            };
            if apply_wheel_delta(ctx, delta) {
                applied = true;
            }
        }
        applied
    }

    fn apply_wheel_delta(ctx: &Ctx, delta: f64) -> bool {
        if delta.abs() < f64::EPSILON {
            return false;
        }

        let mut vp = ctx.viewport.lock();

        // Keep zoom anchored to the live cursor — prevents drift while Alt+scroll is held.
        if let Some(m) = vp.monitor.as_ref() {
            if let Some((tx, ty)) = cursor_pos_for_monitor(
                m.origin_x,
                m.origin_y,
                m.width as f64,
                m.height as f64,
            ) {
                vp.viewport.x = tx;
                vp.viewport.y = ty;
            }
        }

        let factor = 1.0 + delta * WHEEL_ZOOM_STEP * vp.zoom_sensitivity;
        let prev = vp.zoom_target;
        let raw_next = prev * factor;

        if hits_full_frame_snap(prev, raw_next) {
            aim_full_frame(&mut vp);
            sync_zoom_at_min(vp.zoom_target);
            mark_viewport_dirty();
            return true;
        }

        let next = normalize_zoom(raw_next);
        if (next - prev).abs() <= f64::EPSILON {
            if prev <= crate::geometry::ZOOM_MIN + 0.001 && delta < 0.0 {
                alt_log_throttled("wheel ignored — already at min zoom (full desktop)", 600);
            } else if prev >= crate::geometry::ZOOM_MAX - 0.001 && delta > 0.0 {
                alt_log_throttled("wheel ignored — already at max zoom", 600);
            } else {
                alt_log_throttled(&format!("wheel ignored — zoom clamped at {prev:.2}"), 800);
            }
            return false;
        }

        PENDING_FULL_LOCK.store(false, Ordering::Release);
        vp.zoom_target = next;
        sync_zoom_at_min(next);
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
        sync_zoom_at_min(viewport.lock().zoom_target);
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

        let (origin_x, origin_y, width, height) = match vp.monitor.as_ref() {
            Some(m) => (
                m.origin_x,
                m.origin_y,
                m.width as f64,
                m.height as f64,
            ),
            None => return false,
        };

        let Some((tx, ty)) = cursor_pos_for_monitor(origin_x, origin_y, width, height) else {
            alt_log_throttled("cursor read failed — pan paused", 2000);
            return false;
        };

        let ox = vp.viewport.x;
        let oy = vp.viewport.y;
        let oz = vp.viewport.zoom;

        let pan_hz = if alt_held() { PAN_SMOOTH_HZ_ALT } else { PAN_SMOOTH_HZ };
        // Pan always runs — Alt must never interrupt cursor follow.
        vp.viewport.x = smooth_toward(vp.viewport.x, tx, pan_hz, dt_secs);
        vp.viewport.y = smooth_toward(vp.viewport.y, ty, pan_hz, dt_secs);
        sync_zoom_at_min(vp.zoom_target);

        if hold {
            vp.zoom_target = 1.0;
            vp.viewport.zoom = 1.0;
        } else {
            vp.viewport.zoom =
                smooth_toward(vp.viewport.zoom, vp.zoom_target, ZOOM_SMOOTH_HZ, dt_secs);

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
}

#[cfg(windows)]
pub use imp::{start, start_cursor_follow};

#[cfg(not(windows))]
pub fn take_viewport_dirty() -> bool {
    false
}

#[cfg(not(windows))]
pub fn start(_app: tauri::AppHandle, _viewport: SharedViewport, _state: SharedState) {}

#[cfg(not(windows))]
pub fn start_cursor_follow(
    _app: tauri::AppHandle,
    _viewport: SharedViewport,
    _state: SharedState,
) {}
