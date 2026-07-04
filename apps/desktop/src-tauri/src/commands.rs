use crate::geometry::{
    apply_edge_soft_pan, edge_soft_zone_px, frame_layout, normalize_quality, normalize_zoom,
    output_dims, viewport_center_bounds,
};
use crate::state::{
    AppHandles, AppState, AudioDeviceInfo, AudioLevels, AudioSettings, CaptureState,
    InputSettings, MonitorInfo, Orientation, OverlayFrame, PromoMode, RecordingInfo,
    RecordingSettings, SharedState, StreamSettings, Viewport, ViewportState, WebcamDeviceInfo,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use parking_lot::Mutex;
use crate::state::SharedViewport;
use crate::{audio, capture, monitors, recordings, screenshot};

fn normalize_recording_settings(settings: &mut RecordingSettings) {
    settings.quality = normalize_quality(settings.quality, settings.orientation);
    if settings.quality >= crate::geometry::QUALITY_1440
        && settings.orientation == Orientation::Landscape
        && !crate::state::global_entitlement().lock().is_pro()
    {
        settings.quality = crate::geometry::QUALITY_1080;
    }
    settings.fps = crate::file_record::normalize_recording_fps(settings.fps);
    if settings.game_mode {
        settings.mouse_click_audio = false;
    }
}
use tauri::{AppHandle, Emitter, Manager, State};

/// v1 ships recording-only; the DirectShow virtual camera is deferred to v1.1.
/// Set to `true` (and re-add the CamStatus UI + installer registration) to re-enable.
const VIRTUAL_CAMERA_ENABLED: bool = false;

static LAST_OVERLAY_FRAME: OnceLock<Mutex<Option<OverlayFrame>>> = OnceLock::new();

fn overlay_frame_changed(prev: &OverlayFrame, next: &OverlayFrame) -> bool {
    const PAN_EPS: f64 = 0.05;
    const SIZE_EPS: f64 = 0.25;
    (prev.x - next.x).abs() > PAN_EPS
        || (prev.y - next.y).abs() > PAN_EPS
        || (prev.w - next.w).abs() > SIZE_EPS
        || (prev.h - next.h).abs() > SIZE_EPS
        || (prev.zoom - next.zoom).abs() > 0.001
}

fn overlay_frame_for_viewport(vp: &Viewport, m: &MonitorInfo, quality: u32) -> OverlayFrame {
    let (out_w, out_h) = output_dims(vp.orientation, quality);
    let crop = frame_layout(vp, m.width, m.height, out_w, out_h).crop;
    let (cursor_x, cursor_y) = crate::cursor::latest_monitor_pos().unzip();
    OverlayFrame {
        x: crop.x,
        y: crop.y,
        w: crop.w,
        h: crop.h,
        zoom: vp.zoom,
        cursor_x,
        cursor_y,
    }
}

fn overlay_frame(
    vp: &ViewportState,
    quality: u32,
    promo_mode: Option<PromoMode>,
    promo_inner_active: bool,
    recording_armed: bool,
) -> Option<OverlayFrame> {
    if promo_mode.is_some() && !promo_inner_active && !recording_armed {
        return None;
    }
    let m = vp.monitor.as_ref()?;
    let q = if promo_mode.is_some() {
        720
    } else {
        quality
    };
    Some(overlay_frame_for_viewport(
        promo_framing_viewport(vp, promo_mode, promo_inner_active, recording_armed),
        m,
        q,
    ))
}

fn promo_framing_viewport(
    vp: &ViewportState,
    promo_mode: Option<PromoMode>,
    promo_inner_active: bool,
    recording_armed: bool,
) -> &Viewport {
    if promo_mode.is_some() && promo_inner_active {
        return &vp.viewport;
    }
    if promo_mode.is_some() && recording_armed {
        return &vp.viewport;
    }
    &vp.viewport
}

/// Arm inner take: store inner crop separately — demo viewport stays untouched until inner starts.
fn arm_promo_inner(handles: &AppHandles, mode: PromoMode) {
    let (cx, cy) = {
        let vp = handles.viewport.lock();
        vp.monitor
            .as_ref()
            .map(|m| (m.width as f64 / 2.0, m.height as f64 / 2.0))
            .unwrap_or((vp.viewport.x, vp.viewport.y))
    };
    let inner_vp = crate::promo::init_inner_viewport(mode, cx, cy);
    {
        let mut vp = handles.viewport.lock();
        vp.promo_inner_viewport = Some(inner_vp);
        // Route pan/zoom to the inner crop during countdown (usage track stays on promo_usage_viewport).
        vp.viewport = inner_vp;
        vp.zoom_target = inner_vp.zoom;
    }
    crate::rawinput::ensure_promo_usage_viewport(&handles.viewport, mode);
}

/// Inner take is live — keep countdown pan/zoom; sync the armed snapshot for capture.
fn activate_promo_inner(handles: &AppHandles) {
    let mut vp = handles.viewport.lock();
    vp.promo_inner_viewport = Some(vp.viewport);
    vp.zoom_target = vp.viewport.zoom;
}

fn capture_state(st: &AppState, vp: &ViewportState) -> CaptureState {
    let (w, h) = output_dims(vp.viewport.orientation, st.recording_settings.quality);
    let elapsed = st
        .session_start
        .or(st.current_start)
        .map(|s| s.elapsed().as_secs_f64())
        .unwrap_or(0.0);
    let stream_elapsed = st
        .stream_start
        .map(|s| s.elapsed().as_secs_f64())
        .unwrap_or(0.0);
    CaptureState {
        monitor: vp.monitor.clone(),
        viewport: vp.viewport,
        recording: st.recording,
        streaming: st.streaming,
        elapsed,
        stream_elapsed,
        output_width: w,
        output_height: h,
        stream_stats: st.stream_stats.clone(),
        overlay_visible: st.overlay_visible,
        camera_enabled: st.camera_enabled,
        camera_connected: st.camera_connected,
        recording_armed: st.recording_armed,
        countdown_seconds: st.countdown_seconds,
        overlay_frame: overlay_frame(
            vp,
            st.recording_settings.quality,
            st.promo_mode,
            st.promo_inner_active,
            st.recording_armed,
        ),
        capture_cursor: st.recording_settings.capture_cursor,
        cinematic_cursor: st.recording_settings.use_cinematic_cursor(),
        game_mode: st.recording_settings.game_mode,
        game_pan_mode: st.recording_settings.game_pan_mode,
        frame_frozen: vp.frame_frozen,
        promo_mode: st.promo_mode,
        promo_inner_active: st.promo_inner_active,
        promo_enabled: st.recording_settings.promo_enabled,
    }
}

fn merged_capture_state(handles: &AppHandles) -> CaptureState {
    // Never hold state + viewport at once — overlay refresh uses state→viewport;
    // nesting the other way deadlocks the main thread (AppHangB1).
    let vp = handles.viewport.lock().clone();
    let st = handles.state.lock();
    capture_state(&st, &vp)
}

/// Overlay forced on while recording, streaming, or counting down to record.
fn overlay_force_visible(st: &AppState) -> bool {
    !st.finalizing && (st.recording || st.streaming || st.recording_armed)
}

/// True while the on-desktop frame overlay needs live viewport updates.
fn capture_framing_active(st: &AppState) -> bool {
    overlay_force_visible(st) || st.overlay_visible
}

/// Broadcast recording lifecycle to every webview (main + overlay). Must run on
/// the main thread — the overlay timer depends on `recording:state` arriving here.
fn emit_recording_state(app: &AppHandle, payload: serde_json::Value) {
    let _ = app.emit("recording:state", payload.clone());
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("recording:state", payload);
    }
}

fn defer_recording_state(app: &AppHandle, payload: serde_json::Value) {
    let app_main = app.clone();
    let _ = app.run_on_main_thread(move || emit_recording_state(&app_main, payload));
}

fn finish_recording_ui(app: &AppHandle, state: &SharedState, result: Result<Option<RecordingInfo>, String>) {
    let app_main = app.clone();
    let state = state.clone();
    let _ = app.run_on_main_thread(move || {
        {
            let mut st = state.lock();
            st.finalizing = false;
        }
        match result {
        Ok(info) => {
            emit_recording_state(
                &app_main,
                serde_json::json!({ "recording": false, "finalizing": false }),
            );
            let _ = app_main.emit("recording:finished", info);
            apply_overlay_visibility(&app_main, &state.lock());
        }
        Err(msg) => {
            crate::log::capture_log(&format!("Recording failed: {msg}"));
            let _ = app_main.emit("app:log", &msg);
            emit_recording_state(
                &app_main,
                serde_json::json!({ "recording": false, "finalizing": false }),
            );
            let _ = app_main.emit("recording:finished", Option::<RecordingInfo>::None);
            apply_overlay_visibility(&app_main, &state.lock());
        }
        }
    });
}

pub fn apply_overlay_visibility(app: &AppHandle, st: &AppState) {
    if overlay_force_visible(st) || st.overlay_visible {
        ensure_overlay_for_state(app, st);
    } else if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.hide();
    }
}

/// During promo inner countdown only — frame overlay in WGC for the on-screen preview.
/// Inner take excludes overlay from capture so the composited "final take" act is clean.
/// Demo-only promo keeps overlay excluded (P/L badge stays on desktop, not in export).
fn overlay_include_in_capture(st: &AppState) -> bool {
    st.promo_mode.is_some() && st.recording_armed
}

/// Apply overlay visibility from a background/worker thread. WebView window ops
/// (show/hide/move/resize) MUST run on the main thread on Windows — calling them
/// from a spawned thread blocks on the main loop and deadlocks (AppHangB1 766f).
fn defer_overlay_visibility(app: &AppHandle, state: &SharedState) {
    let app_main = app.clone();
    let state = state.clone();
    let _ = app.run_on_main_thread(move || {
        apply_overlay_visibility(&app_main, &state.lock());
    });
}

/// Monitor-space crop rectangle for the on-desktop overlay (matches the recorder exactly).
pub fn emit_viewport_update(app: &AppHandle, viewport: Viewport) {
    let _ = app.emit("viewport:update", viewport);
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("viewport:update", viewport);
    }
}

/// Push the latest crop rect to the overlay webview only. Must run on the main thread.
fn emit_overlay_frame(
    app: &AppHandle,
    viewport_state: &ViewportState,
    quality: u32,
    promo_mode: Option<PromoMode>,
    promo_inner_active: bool,
    recording_armed: bool,
) {
    let Some(frame) = overlay_frame(
        viewport_state,
        quality,
        promo_mode,
        promo_inner_active,
        recording_armed,
    ) else {
        return;
    };
    *LAST_OVERLAY_FRAME
        .get_or_init(|| Mutex::new(None))
        .lock() = Some(frame.clone());
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("overlay:frame", frame);
    }
}

pub fn emit_viewport_sync(
    app: &AppHandle,
    viewport_state: &ViewportState,
    quality: u32,
    framing_active: bool,
    promo_mode: Option<PromoMode>,
    promo_inner_active: bool,
    recording_armed: bool,
) {
    let overlay_only =
        framing_active && (promo_mode.is_none() || promo_inner_active || recording_armed);
    if overlay_only {
        emit_overlay_frame(
            app,
            viewport_state,
            quality,
            promo_mode,
            promo_inner_active,
            recording_armed,
        );
    } else {
        emit_viewport_update(app, viewport_state.viewport);
        emit_overlay_frame(
            app,
            viewport_state,
            quality,
            promo_mode,
            promo_inner_active,
            recording_armed,
        );
    }
}

pub fn emit_viewport_from_handles(app: &AppHandle, handles: &AppHandles) {
    // LOCK ORDER: state before viewport, and never hold both at once. The reverse
    // order here (viewport then state) collides with merged_capture_state's
    // state→viewport order on a worker thread → AB-BA deadlock (AppHangB1).
    let (quality, framing, promo_mode, promo_inner_active, recording_armed) = {
        let st = handles.state.lock();
        (
            st.recording_settings.quality,
            capture_framing_active(&st),
            st.promo_mode,
            st.promo_inner_active,
            st.recording_armed,
        )
    };
    let vp = handles.viewport.lock();
    emit_viewport_sync(
        app,
        &vp,
        quality,
        framing,
        promo_mode,
        promo_inner_active,
        recording_armed,
    );
}

/// Main-thread overlay pump: cursor follow only updates shared viewport state;
/// this loop pushes `overlay:frame` at ~60 Hz without touching webviews off-thread.
pub fn start_overlay_refresh_loop(app: AppHandle, state: SharedState, viewport: SharedViewport) {
    std::thread::Builder::new()
        .name("overlay-refresh".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(16));
            let needed = {
                let st = state.lock();
                capture_framing_active(&st)
            };
            if !needed {
                continue;
            }
            let app_main = app.clone();
            let state = state.clone();
            let viewport = viewport.clone();
            let _ = app.run_on_main_thread(move || {
                // LOCK ORDER: state before viewport (see emit_viewport_from_handles).
                let (quality, promo_mode, promo_inner_active, recording_armed) = {
                    let st = state.lock();
                    (
                        st.recording_settings.quality,
                        st.promo_mode,
                        st.promo_inner_active,
                        st.recording_armed,
                    )
                };
                let vp = viewport.lock();
                emit_overlay_frame(
                    &app_main,
                    &vp,
                    quality,
                    promo_mode,
                    promo_inner_active,
                    recording_armed,
                );
            });
        })
        .ok();
}

#[tauri::command]
pub fn list_monitors() -> Vec<MonitorInfo> {
    monitors::list_monitors()
}

#[tauri::command]
pub fn get_state(handles: State<AppHandles>) -> CaptureState {
    merged_capture_state(handles.inner())
}

#[tauri::command]
pub fn get_monitor_thumbnail(_monitor_id: Option<i64>) -> String {
    screenshot::monitor_thumbnail(1280)
}

#[tauri::command]
pub fn set_viewport(
    app: AppHandle,
    handles: State<AppHandles>,
    viewport: Viewport,
) -> CaptureState {
    {
        let mut vp = handles.viewport.lock();
        vp.viewport = viewport;
        let z = normalize_zoom(viewport.zoom, viewport.orientation);
        vp.viewport.zoom = z;
        vp.zoom_target = z;
    }
    let cs = merged_capture_state(handles.inner());
    emit_viewport_from_handles(&app, handles.inner());
    cs
}

#[tauri::command]
pub fn nudge_viewport(
    handles: State<AppHandles>,
    dx: f64,
    dy: f64,
) -> CaptureState {
    {
        let mut vp = handles.viewport.lock();
        if let Some(m) = vp.monitor.as_ref() {
            let (out_w, out_h) = output_dims(vp.viewport.orientation, 1080);
            let layout = frame_layout(&vp.viewport, m.width, m.height, out_w, out_h);
            let soft = edge_soft_zone_px(layout.crop.w, layout.crop.h);
            let (min_x, max_x, min_y, max_y) =
                viewport_center_bounds(&vp.viewport, m.width, m.height);
            let (nx, ny) = apply_edge_soft_pan(
                vp.viewport.x,
                vp.viewport.y,
                vp.viewport.x + dx,
                vp.viewport.y + dy,
                min_x,
                max_x,
                min_y,
                max_y,
                soft,
            );
            vp.viewport.x = nx;
            vp.viewport.y = ny;
        } else {
            vp.viewport.x += dx;
            vp.viewport.y += dy;
        }
    }
    merged_capture_state(handles.inner())
}

#[tauri::command]
pub fn set_zoom(
    app: AppHandle,
    handles: State<AppHandles>,
    zoom: f64,
) -> CaptureState {
    let _viewport = {
        let mut vp = handles.viewport.lock();
        let orientation = vp.viewport.orientation;
        vp.zoom_target = normalize_zoom(zoom, orientation);
        vp.viewport.zoom = vp.zoom_target;
        vp.viewport
    };
    let cs = merged_capture_state(handles.inner());
    emit_viewport_from_handles(&app, handles.inner());
    cs
}

fn emit_countdown(app: &AppHandle, seconds: u8) {
    if seconds > 0 {
        crate::log::capture_log(&format!("Countdown: {seconds}s"));
    }
    let payload = serde_json::json!({ "seconds": seconds });
    let _ = app.emit("recording:countdown", payload.clone());
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("recording:countdown", payload);
    }
}

fn defer_countdown(app: &AppHandle, seconds: u8) {
    let app_main = app.clone();
    let _ = app.run_on_main_thread(move || emit_countdown(&app_main, seconds));
}

const RECORD_COUNTDOWN_SECS: u8 = 5;
const GAME_PULSE_MS: u64 = 1000;

fn emit_game_pulse(app: &AppHandle, phase: &str) {
    crate::log::capture_log(&format!("Game pulse: {phase}"));
    let payload = serde_json::json!({ "phase": phase });
    let _ = app.emit("recording:game-pulse", payload.clone());
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("recording:game-pulse", payload);
    }
}

fn defer_game_pulse(app: &AppHandle, phase: &str) {
    let app_main = app.clone();
    let phase = phase.to_string();
    let _ = app.run_on_main_thread(move || emit_game_pulse(&app_main, &phase));
}

fn sleep_game_pulse_ms(state: &SharedState) -> bool {
    const STEPS: u64 = 10;
    let step_ms = GAME_PULSE_MS / STEPS;
    for _ in 0..STEPS {
        if !state.lock().recording_armed {
            return false;
        }
        std::thread::sleep(Duration::from_millis(step_ms));
    }
    true
}

fn abort_armed_countdown(app: &AppHandle, state: &SharedState) {
    {
        let mut st = state.lock();
        st.recording_armed = false;
        st.countdown_seconds = 0;
    }
    defer_countdown(app, 0);
    if state.lock().promo_mode.is_none() {
        defer_recording_state(
            app,
            serde_json::json!({ "recording": false, "arming": false }),
        );
        defer_overlay_visibility(app, state);
    }
}

fn run_recording_countdown(app: AppHandle, state: SharedState, handles: Option<AppHandles>, promo_countdown: bool) {
    capture::prewarm_game_webcam_for_recording(&state);

    let use_game_pulse = !promo_countdown;

    if use_game_pulse {
        if !state.lock().recording_armed {
            abort_armed_countdown(&app, &state);
            return;
        }
        defer_game_pulse(&app, "start");
        if !sleep_game_pulse_ms(&state) {
            abort_armed_countdown(&app, &state);
            return;
        }
    } else {
        for remaining in (1..=RECORD_COUNTDOWN_SECS).rev() {
            {
                let mut st = state.lock();
                if !st.recording_armed {
                    st.countdown_seconds = 0;
                    let promo = st.promo_mode;
                    drop(st);
                    defer_countdown(&app, 0);
                    if promo.is_none() {
                        defer_recording_state(
                            &app,
                            serde_json::json!({ "recording": false, "arming": false }),
                        );
                        defer_overlay_visibility(&app, &state);
                    }
                    return;
                }
                st.countdown_seconds = remaining;
            }
            defer_countdown(&app, remaining);
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    if !state.lock().recording_armed {
        defer_countdown(&app, 0);
        if state.lock().promo_mode.is_none() {
            defer_recording_state(
                &app,
                serde_json::json!({ "recording": false, "arming": false }),
            );
            defer_overlay_visibility(&app, &state);
        }
        return;
    }

    if promo_countdown {
        let Some(handles) = handles else {
            crate::log::capture_log("Promo countdown finished without handles");
            return;
        };
        let mode = state.lock().promo_mode.ok_or(()).ok();
        let Some(mode) = mode else {
            return;
        };
        crate::log::capture_log("Promo countdown finished — starting inner take");
        let inner_path =
            std::env::temp_dir().join(format!("ns-promo-inner-{}.mp4", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")));
        match crate::promo::start_inner_recorder(mode, inner_path.clone()) {
            Ok(()) => {
                {
                    let mut st = state.lock();
                    st.recording_armed = false;
                    st.countdown_seconds = 0;
                    st.promo_inner_active = true;
                    st.promo_inner_path = Some(inner_path);
                    st.promo_inner_started_at = Some(Instant::now());
                    st.overlay_visible = true;
                    crate::cursor::sync_follow_gate_from_state(&st);
                    crate::click_audio::sync_click_gate_from_state(&st);
                }
                defer_countdown(&app, 0);
                crate::rawinput::ensure_promo_usage_viewport(&handles.viewport, mode);
                activate_promo_inner(&handles);
                let promo_mode = match mode {
                    PromoMode::Portrait => "portrait",
                    PromoMode::Landscape => "landscape",
                };
                defer_recording_state(
                    &app,
                    serde_json::json!({
                        "recording": true,
                        "arming": false,
                        "promoInnerActive": true,
                        "promoMode": promo_mode,
                    }),
                );
                let app_main = app.clone();
                let handles = handles.clone();
                let _ = app.run_on_main_thread(move || {
                    apply_overlay_visibility(&app_main, &handles.state.lock());
                    emit_viewport_from_handles(&app_main, &handles);
                });
            }
            Err(e) => {
                crate::log::capture_log(&format!("Promo inner start failed: {e}"));
                let _ = cancel_promo_session_inner(&app, &handles);
            }
        }
        return;
    }

    crate::log::capture_log("Countdown finished — starting recording");
    match capture::start_recording(state.clone()) {
        Ok(()) => {
            {
                let mut st = state.lock();
                st.recording_armed = false;
                st.countdown_seconds = 0;
                crate::cursor::sync_follow_gate_from_state(&st);
                crate::click_audio::sync_click_gate_from_state(&st);
            }
            defer_countdown(&app, 0);
            defer_recording_state(
                &app,
                serde_json::json!({ "recording": true, "arming": false }),
            );
        }
        Err(e) => {
            crate::log::capture_log(&format!("Recording start failed: {e}"));
            {
                let mut st = state.lock();
                st.recording_armed = false;
                st.countdown_seconds = 0;
                crate::cursor::sync_follow_gate_from_state(&st);
                crate::click_audio::sync_click_gate_from_state(&st);
            }
            defer_countdown(&app, 0);
            defer_overlay_visibility(&app, &state);
            let _ = app.emit("app:log", e.to_string());
            defer_recording_state(
                &app,
                serde_json::json!({ "recording": false, "arming": false }),
            );
        }
    }
}

fn arm_recording_countdown(
    app: &AppHandle,
    handles: &AppHandles,
    promo_inner: bool,
) -> Result<CaptureState, String> {
    if promo_inner {
        let mode = handles
            .state
            .lock()
            .promo_mode
            .ok_or_else(|| "Promo mode not set".to_string())?;
        arm_promo_inner(handles, mode);
    } else {
        let orientation = handles.state.lock().recording_settings.orientation;
        handles.viewport.lock().viewport.orientation = orientation;
    }

    {
        let mut st = handles.state.lock();
        st.recording_armed = true;
        st.countdown_seconds = if promo_inner {
            RECORD_COUNTDOWN_SECS
        } else {
            0
        };
        crate::cursor::sync_follow_gate_from_state(&st);
        crate::click_audio::sync_click_gate_from_state(&st);
    }

    if !promo_inner {
        crate::rawinput::reset_for_new_recording(&handles.viewport, None);
    }
    emit_viewport_from_handles(app, handles);

    crate::log::capture_log(if promo_inner {
        "Promo inner countdown armed (5s)"
    } else {
        "Record pulse armed (1s)"
    });
    emit_recording_state(
        app,
        serde_json::json!({ "recording": promo_inner, "arming": true }),
    );

    let shared: SharedState = handles.state.clone();
    capture::ensure_capture_session(shared.clone());

    let include_overlay_in_capture = promo_inner;
    ensure_overlay_with_capture(app, include_overlay_in_capture);
    if promo_inner {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.unminimize();
            let _ = win.show();
            let _ = win.set_focus();
        }
    } else {
        minimize_main_window(app);
    }

    defer_overlay_visibility(app, &handles.state);

    let app_bg = app.clone();
    let handles_bg = handles.clone();
    std::thread::Builder::new()
        .name("record-countdown".into())
        .spawn(move || {
            run_recording_countdown(
                app_bg,
                shared,
                if promo_inner { Some(handles_bg) } else { None },
                promo_inner,
            );
        })
        .map_err(|e| format!("spawn countdown thread: {e}"))?;

    Ok(merged_capture_state(handles))
}

fn cancel_promo_session_inner(app: &AppHandle, handles: &AppHandles) -> Result<(), String> {
    {
        let mut st = handles.state.lock();
        st.recording_armed = false;
        st.countdown_seconds = 0;
        st.overlay_visible = false;
        st.promo_inner_started_at = None;
        crate::cursor::sync_follow_gate_from_state(&st);
        crate::click_audio::sync_click_gate_from_state(&st);
    }
    emit_countdown(app, 0);
    crate::rawinput::reset_frame_follow(&handles.viewport);
    let _ = app.emit("frame:freeze", serde_json::json!({ "frozen": false }));
    capture::cancel_promo_recording(handles.state.clone()).map_err(|e| e.to_string())?;
    handles.viewport.lock().promo_usage_viewport = None;
    handles.viewport.lock().promo_inner_viewport = None;
    emit_recording_state(
        app,
        serde_json::json!({ "recording": false, "arming": false, "promoMode": null, "promoInnerActive": false }),
    );
    apply_overlay_visibility(app, &handles.state.lock());
    emit_viewport_from_handles(app, handles);
    Ok(())
}

#[tauri::command]
pub fn cancel_promo_session(
    app: AppHandle,
    handles: State<AppHandles>,
) -> Result<CaptureState, String> {
    {
        let st = handles.state.lock();
        if st.promo_mode.is_none() {
            return Ok(merged_capture_state(handles.inner()));
        }
    }
    cancel_promo_session_inner(&app, handles.inner())?;
    Ok(merged_capture_state(handles.inner()))
}

#[tauri::command]
pub fn start_promo_recording(
    app: AppHandle,
    handles: State<AppHandles>,
    mode: PromoMode,
) -> Result<CaptureState, String> {
    {
        let st = handles.state.lock();
        if !st.recording_settings.promo_enabled {
            return Err("Promo recording is not enabled.".into());
        }
        if st.promo_mode == Some(mode) {
            drop(st);
            return cancel_promo_session(app, handles);
        }
        if st.promo_mode.is_some() {
            return Err("Promo session already active.".into());
        }
        if st.recording || st.recording_armed {
            return Err("Already recording or counting down.".into());
        }
        let audio = &st.audio_settings;
        if crate::audio::source_active(audio.source) && !audio.calibrated {
            return Err(
                "Audio is not ready — re-select your audio source in Studio.".into(),
            );
        }
    }

    let orientation = match mode {
        PromoMode::Portrait => Orientation::Portrait,
        PromoMode::Landscape => Orientation::Landscape,
    };

    {
        let mut st = handles.state.lock();
        st.promo_mode = Some(mode);
        st.promo_inner_active = false;
        st.promo_inner_path = None;
        st.recording_settings.quality = 720;
        st.recording_settings.fps = 60;
        st.recording_settings.orientation = orientation;
        crate::cursor::sync_follow_gate_from_state(&st);
        crate::click_audio::sync_click_gate_from_state(&st);
    }

    crate::rawinput::reset_for_new_recording(&handles.viewport, Some(mode));
    emit_viewport_from_handles(&app, handles.inner());

    let shared: SharedState = handles.inner().state.clone();
    let viewport = handles.inner().viewport.clone();
    capture::ensure_capture_session(shared.clone());

    // Keep the main window visible for promo — must run inline (commands are on the UI thread;
    // `run_on_main_thread` here deadlocks waiting on the same thread).
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
    }

    let promo_mode_label = match mode {
        PromoMode::Portrait => "portrait".to_string(),
        PromoMode::Landscape => "landscape".to_string(),
    };
    let app_bg = app.clone();
    std::thread::Builder::new()
        .name("promo-start".into())
        .spawn(move || {
            let result = capture::start_promo_recording(shared.clone());
            let app_emit = app_bg.clone();
            let app_overlay = app_bg.clone();
            let shared_ui = shared.clone();
            let viewport_ui = viewport.clone();
            let promo_label = promo_mode_label.clone();
            let _ = app_bg.run_on_main_thread(move || {
                match result {
                    Ok(()) => {
                        emit_recording_state(
                            &app_emit,
                            serde_json::json!({
                                "recording": true,
                                "arming": false,
                                "promoMode": promo_label,
                                "promoInnerActive": false,
                            }),
                        );
                        defer_overlay_visibility(&app_overlay, &shared_ui);
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        {
                            let mut st = shared_ui.lock();
                            st.promo_mode = None;
                            st.recording = false;
                            st.current_path = None;
                            crate::cursor::sync_follow_gate_from_state(&st);
                            crate::click_audio::sync_click_gate_from_state(&st);
                        }
                        {
                            let mut vs = viewport_ui.lock();
                            vs.promo_usage_viewport = None;
                            vs.promo_inner_viewport = None;
                        }
                        let _ = app_emit.emit("app:log", msg);
                        emit_recording_state(
                            &app_emit,
                            serde_json::json!({
                                "recording": false,
                                "promoMode": null,
                            }),
                        );
                    }
                }
            });
        })
        .map_err(|e| format!("spawn promo-start thread: {e}"))?;

    Ok(merged_capture_state(handles.inner()))
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    handles: State<AppHandles>,
    settings: RecordingSettings,
) -> Result<CaptureState, String> {
    {
        let st = handles.state.lock();
        if let Some(_mode) = st.promo_mode {
            if st.recording && !st.promo_inner_active && !st.recording_armed {
                drop(st);
                return arm_recording_countdown(&app, handles.inner(), true);
            }
            if st.promo_inner_active {
                return Err("Inner promo take already recording.".into());
            }
            if st.recording_armed {
                return Err("Already counting down.".into());
            }
        }
        let audio = &st.audio_settings;
        if crate::audio::source_active(audio.source) && !audio.calibrated {
            return Err(
                "Audio is not ready — re-select your audio source in Studio.".into(),
            );
        }
        if st.recording || st.recording_armed {
            return Err("Already recording or counting down.".into());
        }
    }

    {
        let mut st = handles.state.lock();
        st.recording_settings = settings;
        normalize_recording_settings(&mut st.recording_settings);
    }

    arm_recording_countdown(&app, handles.inner(), false)
}

#[tauri::command]
pub fn cancel_recording_countdown(
    app: AppHandle,
    handles: State<AppHandles>,
) -> Result<CaptureState, String> {
    {
        let st = handles.state.lock();
        if st.promo_mode.is_some() {
            drop(st);
            return cancel_promo_session(app, handles);
        }
        if !st.recording_armed {
            return Ok(merged_capture_state(handles.inner()));
        }
    }
    {
        let mut st = handles.state.lock();
        st.recording_armed = false;
        st.countdown_seconds = 0;
        crate::cursor::sync_follow_gate_from_state(&st);
        crate::click_audio::sync_click_gate_from_state(&st);
    }
    crate::rawinput::reset_frame_follow(&handles.viewport);
    let _ = app.emit("frame:freeze", serde_json::json!({ "frozen": false }));
    emit_countdown(&app, 0);
    apply_overlay_visibility(&app, &handles.state.lock());
    capture::ensure_capture_session(handles.inner().state.clone());
    emit_recording_state(
        &app,
        serde_json::json!({ "recording": false, "arming": false }),
    );
    Ok(merged_capture_state(handles.inner()))
}

#[tauri::command]
pub fn stop_recording(
    app: AppHandle,
    handles: State<AppHandles>,
) -> Result<(), String> {
    let pulse_end = {
        let mut st = handles.state.lock();
        if !st.recording {
            return Ok(());
        }
        let pulse_end = st.promo_mode.is_none();
        st.finalizing = true;
        st.overlay_visible = pulse_end;
        pulse_end
    };
    crate::rawinput::reset_frame_follow(&handles.viewport);
    let _ = app.emit("frame:freeze", serde_json::json!({ "frozen": false }));
    if pulse_end {
        defer_game_pulse(&app, "end");
    }
    // Update UI immediately — finalize (FFmpeg join) can take a moment on long clips.
    emit_recording_state(
        &app,
        serde_json::json!({ "recording": false, "finalizing": true }),
    );
    let shared: SharedState = handles.inner().state.clone();
    let app_ui = app.clone();
    let state_ui = shared.clone();
    let show_window_now = !pulse_end;
    let _ = app.run_on_main_thread(move || {
        apply_overlay_visibility(&app_ui, &state_ui.lock());
        if show_window_now {
            crate::tray::show_main_window(&app_ui);
        }
    });
    let app_bg = app.clone();
    std::thread::Builder::new()
        .name("stop-recording".into())
        .spawn(move || {
            if pulse_end {
                std::thread::sleep(Duration::from_millis(GAME_PULSE_MS));
                {
                    let mut st = shared.lock();
                    st.overlay_visible = false;
                }
                let app_ui = app_bg.clone();
                let state_ui = shared.clone();
                let _ = app_bg.run_on_main_thread(move || {
                    apply_overlay_visibility(&app_ui, &state_ui.lock());
                });
            }
            let result = capture::stop_recording(shared.clone(), Some(app_bg.clone()))
                .map_err(|e| e.to_string());
            finish_recording_ui(&app_bg, &shared, result);
        })
        .map_err(|e| {
            {
                let mut st = handles.state.lock();
                st.finalizing = false;
            }
            format!("spawn stop-recording thread: {e}")
        })?;
    Ok(())
}

#[tauri::command]
pub fn start_streaming(
    app: AppHandle,
    handles: State<AppHandles>,
    settings: Option<StreamSettings>,
) -> Result<CaptureState, String> {
    {
        let mut st = handles.state.lock();
        if let Some(s) = settings {
            st.stream_settings = s;
        }
    }
    {
        let st = handles.state.lock();
        if !st.recording && st.stream_settings.stream_key.trim().is_empty() {
            return Err("Add your stream key in Settings before going live.".into());
        }
    }
    let shared: SharedState = handles.inner().state.clone();
    capture::start_streaming(shared).map_err(|e| e.to_string())?;
    ensure_overlay(&app);
    let _ = app.emit("streaming:state", serde_json::json!({ "streaming": true }));
    Ok(merged_capture_state(handles.inner()))
}

#[tauri::command]
pub fn start_both(
    app: AppHandle,
    handles: State<AppHandles>,
    recording_settings: RecordingSettings,
    stream_settings: StreamSettings,
) -> Result<CaptureState, String> {
    {
        let mut st = handles.state.lock();
        st.recording_settings = recording_settings;
        normalize_recording_settings(&mut st.recording_settings);
        st.stream_settings = stream_settings;
        if st.stream_settings.stream_key.trim().is_empty() {
            return Err("Add your stream key in Settings before going live.".into());
        }
        let orientation = st.recording_settings.orientation;
        drop(st);
        handles.viewport.lock().viewport.orientation = orientation;
    }
    let shared: SharedState = handles.inner().state.clone();
    capture::start_both(shared).map_err(|e| e.to_string())?;
    ensure_overlay(&app);
    let _ = app.emit("recording:state", serde_json::json!({ "recording": true }));
    let _ = app.emit("streaming:state", serde_json::json!({ "streaming": true }));
    Ok(merged_capture_state(handles.inner()))
}

#[tauri::command]
pub fn notify_app_ready(_app: AppHandle, _handles: State<AppHandles>) -> Result<(), String> {
    static STARTED: AtomicBool = AtomicBool::new(false);
    if STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    crate::log::capture_log("UI ready");
    Ok(())
}

static CAM_STARTING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn start_camera(
    app: AppHandle,
    handles: State<AppHandles>,
) -> Result<CaptureState, String> {
    // v1 ships recording-only. The virtual camera is deferred to v1.1 — flip this
    // flag (and re-add the CamStatus UI + installer registration) to re-enable.
    if !VIRTUAL_CAMERA_ENABLED {
        let _ = app.emit("camera:state", serde_json::json!({ "enabled": false }));
        return Ok(merged_capture_state(handles.inner()));
    }
    if handles.state.lock().camera_enabled {
        return Ok(merged_capture_state(handles.inner()));
    }
    if CAM_STARTING.swap(true, Ordering::SeqCst) {
        return Ok(merged_capture_state(handles.inner()));
    }

    let app_bg = app.clone();
    let shared: SharedState = handles.inner().state.clone();
    std::thread::Builder::new()
        .name("virtual-camera-start".into())
        .spawn(move || {
            struct Guard;
            impl Drop for Guard {
                fn drop(&mut self) {
                    CAM_STARTING.store(false, Ordering::SeqCst);
                }
            }
            let _guard = Guard;

            crate::log::capture_log("Registering virtual camera…");
            match capture::register_virtual_camera(shared.clone()) {
                Ok(()) => {
                    let dims = shared.lock().current_dims;
                    crate::log::capture_log(&format!(
                        "Virtual camera ready — pick \"ninesixteen.video\" in any app ({}×{}). Screen capture starts when an app opens the camera or you record.",
                        dims.0, dims.1
                    ));
                    capture::ensure_capture_session(shared);
                    let _ = app_bg.emit("camera:state", serde_json::json!({ "enabled": true }));
                }
                Err(e) => {
                    crate::log::capture_log(&format!("Virtual camera unavailable: {e}"));
                    let _ = app_bg.emit("app:log", format!("Virtual camera unavailable: {e}"));
                    let _ = app_bg.emit("camera:state", serde_json::json!({ "enabled": false }));
                }
            }
        })
        .map_err(|e| {
            CAM_STARTING.store(false, Ordering::SeqCst);
            format!("spawn virtual camera: {e}")
        })?;

    Ok(merged_capture_state(handles.inner()))
}

#[tauri::command]
pub fn stop_camera(
    app: AppHandle,
    handles: State<AppHandles>,
) -> CaptureState {
    let shared: SharedState = handles.inner().state.clone();
    capture::stop_camera(shared);
    let _ = app.emit("camera:state", serde_json::json!({ "enabled": false }));
    apply_overlay_visibility(&app, &handles.state.lock());
    merged_capture_state(handles.inner())
}

#[tauri::command]
pub fn stop_streaming(
    app: AppHandle,
    handles: State<AppHandles>,
) -> CaptureState {
    let shared: SharedState = handles.inner().state.clone();
    capture::stop_streaming(shared);
    let _ = app.emit("streaming:state", serde_json::json!({ "streaming": false }));
    apply_overlay_visibility(&app, &handles.state.lock());
    merged_capture_state(handles.inner())
}

#[tauri::command]
pub fn set_stream_settings(handles: State<AppHandles>, settings: StreamSettings) {
    handles.state.lock().stream_settings = settings;
}

#[tauri::command]
pub fn list_recordings() -> Vec<RecordingInfo> {
    recordings::list_recordings()
}

#[tauri::command]
pub fn get_recording_thumbnail(id: String) -> String {
    recordings::thumbnail_data_url(&id)
}

#[tauri::command]
pub fn delete_recording(id: String) {
    recordings::delete_recording(&id);
}

#[tauri::command]
pub fn rename_recording(id: String, filename: String) -> Result<RecordingInfo, String> {
    recordings::rename_recording(&id, &filename)
}

#[tauri::command]
pub fn sync_entitlement(
    handles: State<'_, AppHandles>,
    id_token: String,
    uid: String,
    pro_ends_at: Option<i64>,
) -> Result<bool, String> {
    // `check_entitlement` updates the in-memory cache and (on a real server
    // response) sets the `server_verified` flag. Use `set_identity` here so we
    // record the uid/expiry without clobbering that flag.
    let pro = crate::entitlement::check_entitlement(&id_token)?;
    handles.entitlement.lock().set_identity(&uid, pro_ends_at);
    crate::entitlement_store::save(&uid, pro, pro_ends_at);
    Ok(pro)
}

#[tauri::command]
pub fn apply_entitlement_cache(
    handles: State<'_, AppHandles>,
    uid: String,
    pro: bool,
    pro_ends_at: Option<i64>,
) {
    handles
        .entitlement
        .lock()
        .apply(&uid, pro, pro_ends_at);
    crate::entitlement::persist_entitlement(&uid, pro, pro_ends_at);
}

#[tauri::command]
pub fn clear_entitlement(_handles: State<'_, AppHandles>) {
    crate::entitlement::clear_persisted_entitlement();
}

/// Copy a recording to a user-chosen destination (legacy save dialog flow).
#[tauri::command]
pub fn export_recording(id: String, dest: String, id_token: String) -> Result<(), String> {
    crate::entitlement::verify_pro_export(&id_token)?;
    let rec = crate::export::resolve_recording(&id)?;
    crate::export::export_decrypted_mp4(&rec, std::path::Path::new(&dest))?;
    Ok(())
}

#[tauri::command]
pub async fn export_recording_local(id: String, id_token: String) -> Result<String, String> {
    crate::entitlement::verify_pro_export(&id_token)?;
    tauri::async_runtime::spawn_blocking(move || crate::export::export_recording_local(&id))
        .await
        .map_err(|e| format!("Export task failed: {e}"))?
}

#[tauri::command]
pub async fn export_recording_to_drive(
    id: String,
    access_token: String,
    id_token: String,
) -> Result<String, String> {
    crate::entitlement::verify_pro_export(&id_token)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::export::upload_recording_to_drive(&id, &access_token)
    })
    .await
    .map_err(|e| format!("Drive export task failed: {e}"))?
}

#[tauri::command]
pub fn open_recordings_folder() {
    let dir = recordings::recordings_dir();
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(dir).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
    }
}

#[tauri::command]
pub fn get_hardware_profile() -> crate::hardware::HardwareProfile {
    crate::hardware::hardware_profile()
}

#[tauri::command]
pub fn get_input_settings(handles: State<AppHandles>) -> InputSettings {
    handles.state.lock().input_settings
}

#[tauri::command]
pub fn set_input_settings(
    handles: State<AppHandles>,
    mut settings: InputSettings,
) {
    // Clamp to the UI slider range and reject non-finite values so a bad payload
    // can never poison the zoom math (which would silently break Alt+scroll).
    if !settings.zoom_sensitivity.is_finite() {
        settings.zoom_sensitivity = 1.0;
    }
    settings.zoom_sensitivity = settings.zoom_sensitivity.clamp(0.2, 3.0);
    if !settings.follow_speed.is_finite() {
        settings.follow_speed = 1.0;
    }
    settings.follow_speed = settings.follow_speed.clamp(0.75, 1.25);
    handles.state.lock().input_settings = settings;
    handles.viewport.lock().zoom_sensitivity = settings.zoom_sensitivity;
    #[cfg(windows)]
    crate::rawinput::reset_pan_follow_tuning();
}

#[tauri::command]
pub fn set_recording_settings(
    app: AppHandle,
    handles: State<AppHandles>,
    settings: RecordingSettings,
) {
    let mut st = handles.state.lock();
    st.recording_settings = settings;
    normalize_recording_settings(&mut st.recording_settings);
    let orientation = st.recording_settings.orientation;
    let capture_cursor = st.recording_settings.capture_cursor;
    let cinematic_cursor = st.recording_settings.use_cinematic_cursor();
    let game_mode = st.recording_settings.game_mode;
    let game_pan_mode = st.recording_settings.game_pan_mode;
    crate::cursor::sync_follow_gate_from_state(&st);
    crate::click_audio::sync_click_gate_from_state(&st);
    {
        let mut vp = handles.viewport.lock();
        vp.viewport.orientation = orientation;
        let z = if game_mode {
            1.0
        } else {
            normalize_zoom(vp.viewport.zoom, orientation)
        };
        vp.viewport.zoom = z;
        vp.zoom_target = z;
    }
    drop(st);
    if game_mode {
        #[cfg(windows)]
        crate::rawinput::apply_game_mode_viewport(&handles.viewport);
    }
    emit_cursor_capture(
        &app,
        capture_cursor,
        cinematic_cursor,
        game_mode,
        game_pan_mode,
    );
    if let Err(e) = capture::sync_output_dimensions(handles.state.clone()) {
        crate::log::capture_log(&format!("WARN: output dimension sync failed: {e}"));
    }
    emit_viewport_from_handles(&app, handles.inner());
}

/// Tell the overlay whether the system cursor is baked into capture or cinematic stamp is used.
fn emit_cursor_capture(
    app: &AppHandle,
    capture_cursor: bool,
    cinematic_cursor: bool,
    game_mode: bool,
    game_pan_mode: crate::state::GamePanMode,
) {
    let payload = serde_json::json!({
        "captureCursor": capture_cursor,
        "cinematicCursor": cinematic_cursor,
        "gameMode": game_mode,
        "gamePanMode": game_pan_mode,
    });
    let _ = app.emit("overlay:cursor-capture", payload.clone());
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("overlay:cursor-capture", payload);
    }
}

#[tauri::command]
pub fn list_audio_devices() -> Vec<AudioDeviceInfo> {
    audio::list_devices()
}

#[tauri::command]
pub fn list_webcam_devices() -> Vec<WebcamDeviceInfo> {
    crate::webcam::list_devices()
}

#[tauri::command]
pub fn get_audio_settings(handles: State<AppHandles>) -> AudioSettings {
    handles.state.lock().audio_settings.clone()
}

#[tauri::command]
pub fn set_audio_settings(
    app: AppHandle,
    handles: State<AppHandles>,
    settings: AudioSettings,
) -> Result<AudioSettings, String> {
    let mut settings = settings;
    settings.system_gain = settings.system_gain.clamp(0.0, 2.0);
    settings.mic_gain = settings.mic_gain.clamp(0.0, 2.0);
    settings.mic_delay_ms = settings.mic_delay_ms.clamp(-500, 500);
    let prev = handles.state.lock().audio_settings.clone();
    let monitor_needs_restart =
        prev.source != settings.source || prev.microphone_id != settings.microphone_id;

    if settings.source == crate::state::AudioSourceMode::None {
        settings.calibrated = true;
        audio::stop_monitor();
    } else {
        if monitor_needs_restart {
            audio::start_monitor(settings.clone())?;
        }
        // Gain sliders in Studio are the calibration UI — once a source is active
        // and monitoring is running, recording is allowed.
        settings.calibrated = true;
    }

    handles.state.lock().audio_settings = settings.clone();
    let _ = app.emit("audio:settings", &settings);
    Ok(settings)
}

#[tauri::command]
pub fn start_audio_monitor(handles: State<AppHandles>) -> Result<(), String> {
    let settings = handles.state.lock().audio_settings.clone();
    if settings.source == crate::state::AudioSourceMode::None {
        audio::stop_monitor();
        return Ok(());
    }
    audio::start_monitor(settings)?;
    handles.state.lock().audio_settings.calibrated = true;
    Ok(())
}

#[tauri::command]
pub fn stop_audio_monitor() {
    audio::stop_monitor();
}

#[tauri::command]
pub fn get_audio_levels() -> AudioLevels {
    audio::monitor_levels()
}

#[tauri::command]
pub fn preview_mouse_click_audio(volume: f64) -> Result<(), String> {
    crate::click_audio::preview(volume as f32)
}

pub fn ensure_overlay(app: &AppHandle) {
    ensure_overlay_with_capture(app, false);
}

fn ensure_overlay_for_state(app: &AppHandle, st: &AppState) {
    ensure_overlay_with_capture(app, overlay_include_in_capture(st));
}

fn ensure_overlay_with_capture(app: &AppHandle, include_in_capture: bool) {
    let Some(win) = app.get_webview_window("overlay") else {
        return;
    };
    if let Ok(Some(mon)) = win.primary_monitor() {
        let _ = win.set_position(*mon.position());
        let _ = win.set_size(*mon.size());
    }
    let _ = win.set_ignore_cursor_events(true);
    let _ = win.set_always_on_top(true);
    let _ = win.show();

    #[cfg(windows)]
    set_overlay_capture_excluded(&win, !include_in_capture);
}

fn minimize_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[tauri::command]
pub fn show_overlay(app: AppHandle) -> Result<(), String> {
    ensure_overlay(&app);
    Ok(())
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub fn set_overlay(app: AppHandle, visible: bool) -> Result<(), String> {
    if visible {
        show_overlay(app)
    } else {
        hide_overlay(app)
    }
}

#[tauri::command]
pub fn set_overlay_visible(
    app: AppHandle,
    handles: State<AppHandles>,
    visible: bool,
) -> Result<CaptureState, String> {
    {
        let st = handles.state.lock();
        if overlay_force_visible(&st) && !visible {
            return Err(
                "Frame stays visible while recording, streaming, or counting down.".into(),
            );
        }
    }
    {
        let mut st = handles.state.lock();
        st.overlay_visible = visible;
    }
    apply_overlay_visibility(&app, &handles.state.lock());
    Ok(merged_capture_state(handles.inner()))
}

#[cfg(windows)]
fn set_overlay_capture_excluded(win: &tauri::WebviewWindow, excluded: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };
    if let Ok(handle) = win.hwnd() {
        let hwnd = HWND(handle.0 as *mut core::ffi::c_void);
        let affinity = if excluded {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            WDA_NONE
        };
        unsafe {
            let _ = SetWindowDisplayAffinity(hwnd, affinity);
        }
    }
}

/// Resize and pin the main window to the left screen edge (dock / taskbar layout).
#[tauri::command]
pub fn sync_dock_window(app: AppHandle, width: f64) -> Result<(), String> {
    crate::sync_dock_window(&app, width);
    Ok(())
}
