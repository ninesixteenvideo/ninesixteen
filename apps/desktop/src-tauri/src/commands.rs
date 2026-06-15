use crate::geometry::{frame_layout, normalize_zoom, output_dims};
use crate::state::{
    AppHandles, AppState, AudioDeviceInfo, AudioLevels, AudioSettings, CaptureState,
    InputSettings, MonitorInfo, Orientation, OverlayFrame, RecordingInfo, RecordingSettings,
    SharedState, StreamSettings, Viewport, ViewportState,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use parking_lot::Mutex;
use crate::state::SharedViewport;
use crate::{audio, capture, monitors, recordings, screenshot};
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

fn overlay_frame(vp: &ViewportState, quality: u32) -> Option<OverlayFrame> {
    let m = vp.monitor.as_ref()?;
    let (out_w, out_h) = output_dims(vp.viewport.orientation, quality);
    let crop = frame_layout(&vp.viewport, m.width, m.height, out_w, out_h).crop;
    Some(OverlayFrame {
        x: crop.x,
        y: crop.y,
        w: crop.w,
        h: crop.h,
        zoom: vp.viewport.zoom,
    })
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
        overlay_frame: overlay_frame(vp, st.recording_settings.quality),
        capture_cursor: st.recording_settings.capture_cursor,
        frame_frozen: vp.frame_frozen,
    }
}

fn merged_capture_state(handles: &AppHandles) -> CaptureState {
    capture_state(&handles.state.lock(), &handles.viewport.lock())
}

/// Overlay forced on while recording, streaming, or counting down to record.
fn overlay_force_visible(st: &AppState) -> bool {
    st.recording || st.streaming || st.recording_armed
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
    let _ = app.run_on_main_thread(move || match result {
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
    });
}

pub fn apply_overlay_visibility(app: &AppHandle, st: &AppState) {
    if overlay_force_visible(st) || st.overlay_visible {
        ensure_overlay(app);
    } else if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.hide();
    }
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
fn emit_overlay_frame(app: &AppHandle, viewport_state: &ViewportState, quality: u32) {
    let Some(frame) = overlay_frame(viewport_state, quality) else {
        return;
    };
    *LAST_OVERLAY_FRAME
        .get_or_init(|| Mutex::new(None))
        .lock() = Some(frame);
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("overlay:frame", frame);
    }
}

pub fn emit_viewport_sync(
    app: &AppHandle,
    viewport_state: &ViewportState,
    quality: u32,
    framing_active: bool,
) {
    if framing_active {
        // Main window is minimized during capture — skip global viewport:update so
        // React doesn't re-render at 60 Hz and starve the overlay webview / main loop.
        emit_overlay_frame(app, viewport_state, quality);
    } else {
        emit_viewport_update(app, viewport_state.viewport);
        emit_overlay_frame(app, viewport_state, quality);
    }
}

pub fn emit_viewport_from_handles(app: &AppHandle, handles: &AppHandles) {
    // LOCK ORDER: state before viewport, and never hold both at once. The reverse
    // order here (viewport then state) collides with merged_capture_state's
    // state→viewport order on a worker thread → AB-BA deadlock (AppHangB1).
    let (quality, framing) = {
        let st = handles.state.lock();
        (st.recording_settings.quality, capture_framing_active(&st))
    };
    let vp = handles.viewport.lock();
    emit_viewport_sync(app, &vp, quality, framing);
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
                let quality = state.lock().recording_settings.quality;
                let vp = viewport.lock();
                emit_overlay_frame(&app_main, &vp, quality);
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
        vp.zoom_target = viewport.zoom;
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
        vp.viewport.x += dx;
        vp.viewport.y += dy;
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
        vp.zoom_target = normalize_zoom(zoom);
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

fn run_recording_countdown(app: AppHandle, state: SharedState) {
    for remaining in (1..=RECORD_COUNTDOWN_SECS).rev() {
        {
            let mut st = state.lock();
            if !st.recording_armed {
                st.countdown_seconds = 0;
                drop(st);
                defer_countdown(&app, 0);
                defer_recording_state(
                    &app,
                    serde_json::json!({ "recording": false, "arming": false }),
                );
                defer_overlay_visibility(&app, &state);
                return;
            }
            st.countdown_seconds = remaining;
        }
        defer_countdown(&app, remaining);
        std::thread::sleep(Duration::from_secs(1));
    }

    if !state.lock().recording_armed {
        defer_countdown(&app, 0);
        defer_recording_state(
            &app,
            serde_json::json!({ "recording": false, "arming": false }),
        );
        defer_overlay_visibility(&app, &state);
        return;
    }

    crate::log::capture_log("Countdown finished — starting recording");
    match capture::start_recording(state.clone()) {
        Ok(()) => {
            {
                let mut st = state.lock();
                st.recording_armed = false;
                st.countdown_seconds = 0;
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

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    handles: State<AppHandles>,
    settings: RecordingSettings,
) -> Result<CaptureState, String> {
    {
        let st = handles.state.lock();
        let audio = &st.audio_settings;
        if crate::audio::source_active(audio.source) && !audio.calibrated {
            return Err("Calibrate audio in Studio before recording.".into());
        }
        if st.recording || st.recording_armed {
            return Err("Already recording or counting down.".into());
        }
    }
    {
        let mut st = handles.state.lock();
        st.recording_settings = settings;
        st.recording_settings.orientation = Orientation::Portrait;
        st.recording_armed = true;
        st.countdown_seconds = RECORD_COUNTDOWN_SECS;
    }
    {
        let mut vp = handles.viewport.lock();
        vp.viewport.orientation = Orientation::Portrait;
    }
    crate::rawinput::reset_frame_follow(&handles.viewport);

    crate::log::capture_log("Record countdown armed (5s)");
    emit_recording_state(
        &app,
        serde_json::json!({ "recording": false, "arming": true }),
    );

    let shared: SharedState = handles.inner().state.clone();
    capture::ensure_capture_session(shared.clone());

    // Window operations (show overlay, minimize main) MUST run on the main thread on
    // Windows — doing them from a worker/background thread can deadlock the WebView.
    let app_win = app.clone();
    let _ = app.run_on_main_thread(move || {
        ensure_overlay(&app_win);
        minimize_main_window(&app_win);
    });

    let app_bg = app.clone();
    std::thread::Builder::new()
        .name("record-countdown".into())
        .spawn(move || {
            run_recording_countdown(app_bg, shared);
        })
        .map_err(|e| format!("spawn countdown thread: {e}"))?;

    Ok(merged_capture_state(handles.inner()))
}

#[tauri::command]
pub fn cancel_recording_countdown(
    app: AppHandle,
    handles: State<AppHandles>,
) -> Result<CaptureState, String> {
    {
        let mut st = handles.state.lock();
        if !st.recording_armed {
            return Ok(merged_capture_state(handles.inner()));
        }
        st.recording_armed = false;
        st.countdown_seconds = 0;
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
    {
        let st = handles.state.lock();
        if !st.recording {
            return Ok(());
        }
    }
    crate::rawinput::reset_frame_follow(&handles.viewport);
    let _ = app.emit("frame:freeze", serde_json::json!({ "frozen": false }));
    // Update UI immediately — finalize (FFmpeg join) can take a moment on long clips.
    emit_recording_state(
        &app,
        serde_json::json!({ "recording": false, "finalizing": true }),
    );
    let shared: SharedState = handles.inner().state.clone();
    let app_bg = app.clone();
    std::thread::Builder::new()
        .name("stop-recording".into())
        .spawn(move || {
            let result = capture::stop_recording(shared.clone(), Some(app_bg.clone()))
                .map_err(|e| e.to_string());
            finish_recording_ui(&app_bg, &shared, result);
        })
        .map_err(|e| format!("spawn stop-recording thread: {e}"))?;
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
        st.recording_settings.orientation = Orientation::Portrait;
    }
    {
        let mut vp = handles.viewport.lock();
        vp.viewport.orientation = Orientation::Portrait;
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
        st.recording_settings.orientation = Orientation::Portrait;
        st.stream_settings = stream_settings;
        if st.stream_settings.stream_key.trim().is_empty() {
            return Err("Add your stream key in Settings before going live.".into());
        }
    }
    {
        let mut vp = handles.viewport.lock();
        vp.viewport.orientation = Orientation::Portrait;
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
pub fn delete_recording(id: String) {
    recordings::delete_recording(&id);
}

#[tauri::command]
pub fn sync_entitlement(
    handles: State<'_, AppHandles>,
    id_token: String,
    uid: String,
    pro_ends_at: Option<i64>,
) -> Result<bool, String> {
    let pro = crate::entitlement::check_entitlement(&id_token)?;
    handles
        .entitlement
        .lock()
        .apply(&uid, pro, pro_ends_at);
    crate::entitlement::persist_entitlement(&uid, pro, pro_ends_at);
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
pub fn set_input_settings(
    handles: State<AppHandles>,
    settings: InputSettings,
) {
    handles.state.lock().input_settings = settings;
    handles.viewport.lock().zoom_sensitivity = settings.zoom_sensitivity;
}

#[tauri::command]
pub fn set_recording_settings(
    app: AppHandle,
    handles: State<AppHandles>,
    settings: RecordingSettings,
) {
    let mut st = handles.state.lock();
    st.recording_settings = settings;
    st.recording_settings.quality = if st.recording_settings.quality <= 720 {
        720
    } else {
        1080
    };
    st.recording_settings.orientation = Orientation::Portrait;
    let capture_cursor = st.recording_settings.capture_cursor;
    handles.viewport.lock().viewport.orientation = Orientation::Portrait;
    drop(st);
    emit_cursor_capture(&app, capture_cursor);
    if let Err(e) = capture::sync_output_dimensions(handles.state.clone()) {
        crate::log::capture_log(&format!("WARN: output dimension sync failed: {e}"));
    }
}

/// Tell the overlay window whether the cursor will be baked into the recording,
/// so it can show the "cursor hidden" badge. Main window keeps it in its store.
fn emit_cursor_capture(app: &AppHandle, capture_cursor: bool) {
    let _ = app.emit("overlay:cursor-capture", capture_cursor);
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("overlay:cursor-capture", capture_cursor);
    }
}

#[tauri::command]
pub fn list_audio_devices() -> Vec<AudioDeviceInfo> {
    audio::list_devices()
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
    if settings.source == crate::state::AudioSourceMode::None {
        settings.calibrated = true;
    } else if !settings.calibrated {
        settings.calibrated = false;
    }
    let prev = handles.state.lock().audio_settings.clone();
    let monitor_needs_restart =
        prev.source != settings.source || prev.microphone_id != settings.microphone_id;
    handles.state.lock().audio_settings = settings.clone();
    if settings.source == crate::state::AudioSourceMode::None {
        audio::stop_monitor();
    } else if monitor_needs_restart {
        audio::start_monitor(settings.clone())?;
    }
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
    audio::start_monitor(settings)
}

#[tauri::command]
pub fn stop_audio_monitor() {
    audio::stop_monitor();
}

#[tauri::command]
pub fn get_audio_levels() -> AudioLevels {
    audio::monitor_levels()
}

pub fn ensure_overlay(app: &AppHandle) {
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
    exclude_from_capture(&win);
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
fn exclude_from_capture(win: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE};
    if let Ok(handle) = win.hwnd() {
        let hwnd = HWND(handle.0 as *mut core::ffi::c_void);
        unsafe {
            let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        }
    }
}
