use crate::state::{SharedState, SharedViewport};

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::commands::emit_viewport_update;
    use crate::geometry::{clamp, normalize_zoom, smooth_toward, ZOOM_SNAP_EPS};
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
        HC_ACTION, MSLLHOOKSTRUCT, MSG, WH_MOUSE_LL, WM_MOUSEHWHEEL, WM_MOUSEWHEEL,
    };

    struct Ctx {
        viewport: SharedViewport,
        state: SharedState,
        app: AppHandle,
    }

    static CTX: OnceLock<Ctx> = OnceLock::new();
    static LAST_EMIT_MS: AtomicU64 = AtomicU64::new(0);
    static LAST_FOLLOW: parking_lot::Mutex<Option<Instant>> = parking_lot::Mutex::new(None);
    static ZOOM_LOCK_UNTIL: parking_lot::Mutex<Option<Instant>> = parking_lot::Mutex::new(None);
    /// Easing toward full 9×16 — ignore Alt+scroll until the 1s hold starts.
    static PENDING_FULL_LOCK: AtomicBool = AtomicBool::new(false);
    /// Wheel deltas queued by the hook; drained on the follow thread only.
    static PENDING_WHEEL_DELTA: parking_lot::Mutex<f64> = parking_lot::Mutex::new(0.0);

    const CURSOR_TICK_MS: u64 = 8;
    const PAN_SMOOTH_HZ: f64 = 11.0;
    const ZOOM_SMOOTH_HZ: f64 = 3.8;
    const WHEEL_ZOOM_STEP: f64 = 0.09;
    const FULL_FRAME_SETTLE: f64 = 0.012;
    const FULL_FRAME_LOCK: Duration = Duration::from_secs(1);

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn alt_held() -> bool {
        unsafe {
            let left = GetAsyncKeyState(VK_MENU.0 as i32) as u16;
            let right = GetAsyncKeyState(VK_RMENU.0 as i32) as u16;
            (left & 0x8000) != 0 || (right & 0x8000) != 0
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
    }

    fn aim_full_frame(vp: &mut ViewportState) {
        vp.zoom_target = 1.0;
        PENDING_FULL_LOCK.store(true, Ordering::Release);
        *PENDING_WHEEL_DELTA.lock() = 0.0;
    }

    fn hits_full_frame_snap(prev: f64, raw_next: f64) -> bool {
        if (raw_next - 1.0).abs() <= ZOOM_SNAP_EPS {
            return true;
        }
        (prev - 1.0) * (raw_next - 1.0) < 0.0
    }

    fn wheel_delta_from_hook(mouse_data: u32) -> f64 {
        ((mouse_data >> 16) as i16) as f64 / 120.0
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
            if !scroll_input_blocked() {
                let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
                let delta = wheel_delta_from_hook(info.mouseData);
                if delta.abs() > f64::EPSILON {
                    *PENDING_WHEEL_DELTA.lock() += delta;
                }
            }
            return LRESULT(1);
        }

        CallNextHookEx(None, code, wparam, lparam)
    }

    /// Follow thread: apply queued wheel deltas (single owner of viewport pan/zoom).
    fn drain_pending_wheel(ctx: &Ctx) -> bool {
        if scroll_input_blocked() {
            *PENDING_WHEEL_DELTA.lock() = 0.0;
            return false;
        }

        let delta = {
            let mut acc = PENDING_WHEEL_DELTA.lock();
            let d = *acc;
            *acc = 0.0;
            d
        };
        if delta.abs() < f64::EPSILON {
            return false;
        }

        let mut vp = ctx.viewport.lock();

        let factor = 1.0 + delta * WHEEL_ZOOM_STEP * vp.zoom_sensitivity;
        let prev = vp.zoom_target;
        let raw_next = prev * factor;

        if hits_full_frame_snap(prev, raw_next) {
            aim_full_frame(&mut vp);
            let viewport = vp.viewport;
            drop(vp);
            emit_viewport_now(&ctx.app, viewport);
            return true;
        }

        let next = normalize_zoom(raw_next);
        if (next - prev).abs() <= f64::EPSILON {
            return false;
        }

        PENDING_FULL_LOCK.store(false, Ordering::Release);
        vp.zoom_target = next;
        let viewport = vp.viewport;
        drop(vp);
        emit_viewport_now(&ctx.app, viewport);
        true
    }

    pub fn start(app: AppHandle, viewport: SharedViewport, state: SharedState) {
        let _ = CTX.set(Ctx {
            viewport,
            state,
            app,
        });
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

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook);
    }

    fn emit_viewport_now(app: &AppHandle, viewport: crate::state::Viewport) {
        let now = now_ms();
        if now.saturating_sub(LAST_EMIT_MS.load(Ordering::Relaxed)) >= 8 {
            LAST_EMIT_MS.store(now, Ordering::Relaxed);
            emit_viewport_update(app, viewport);
        }
    }

    fn cursor_pos_for_monitor(
        origin_x: i32,
        origin_y: i32,
        width: f64,
        height: f64,
    ) -> Option<(f64, f64)> {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut pt = POINT::default();
        unsafe { GetCursorPos(&mut pt).ok()? };
        let x = pt.x as f64 - origin_x as f64;
        let y = pt.y as f64 - origin_y as f64;
        Some((clamp(x, 0.0, width), clamp(y, 0.0, height)))
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
            return false;
        };

        let ox = vp.viewport.x;
        let oy = vp.viewport.y;
        let oz = vp.viewport.zoom;

        // Pan always runs — Alt must never interrupt cursor follow.
        vp.viewport.x = smooth_toward(vp.viewport.x, tx, PAN_SMOOTH_HZ, dt_secs);
        vp.viewport.y = smooth_toward(vp.viewport.y, ty, PAN_SMOOTH_HZ, dt_secs);

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
        pan > 0.05 || zoom > 0.0005
    }

    fn zoom_animating(viewport: &SharedViewport) -> bool {
        if zoom_hold_active() {
            return false;
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

        let moved = advance_viewport(viewport, dt);
        let animating = zoom_animating(viewport);
        let blocked = scroll_input_blocked();

        let (recording, arming) = {
            let st = state.lock();
            (st.recording, st.recording_armed)
        };
        let now_ms = now_ms();
        let min_emit = if recording || arming { 16 } else { CURSOR_TICK_MS };
        if moved
            || animating
            || blocked
            || recording
            || arming
            || now_ms.saturating_sub(LAST_EMIT_MS.load(Ordering::Relaxed)) >= min_emit
        {
            LAST_EMIT_MS.store(now_ms, Ordering::Relaxed);
            if let Some(ctx) = CTX.get() {
                let vp = ctx.viewport.lock().viewport;
                emit_viewport_update(&ctx.app, vp);
            }
        }
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
pub fn start(_app: tauri::AppHandle, _viewport: SharedViewport, _state: SharedState) {}

#[cfg(not(windows))]
pub fn start_cursor_follow(
    _app: tauri::AppHandle,
    _viewport: SharedViewport,
    _state: SharedState,
) {}
