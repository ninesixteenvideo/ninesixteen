use crate::geometry::{normalize_zoom, output_dims};
use crate::state::{
    AppHandles, AppState, AudioDeviceInfo, AudioLevels, AudioSettings, CaptureState,
    InputSettings, MonitorInfo, Orientation, RecordingInfo, RecordingSettings, SharedState,
    StreamSettings, Viewport, ViewportState,
};
use crate::{audio, capture, monitors, recordings, screenshot};
use tauri::{AppHandle, Emitter, Manager, State};

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
    }
}

fn merged_capture_state(handles: &AppHandles) -> CaptureState {
    capture_state(&handles.state.lock(), &handles.viewport.lock())
}

/// Overlay forced on while recording, streaming, or counting down to record.
fn overlay_force_visible(st: &AppState) -> bool {
    st.recording || st.streaming || st.recording_armed
}

pub fn apply_overlay_visibility(app: &AppHandle, st: &AppState) {
    if overlay_force_visible(st) || st.overlay_visible {
        ensure_overlay(app);
    } else if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.hide();
    }
}

/// Broadcast viewport changes to the main window and the overlay webview.
pub fn emit_viewport_update(app: &AppHandle, viewport: Viewport) {
    let _ = app.emit("viewport:update", viewport);
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("viewport:update", viewport);
    }
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
    emit_viewport_update(&app, viewport);
    cs
}

#[tauri::command]
pub fn nudge_viewport(
    handles: State<AppHandles>,
    dx: f64,
    dy: f64,
) -> CaptureState {
    let mut vp = handles.viewport.lock();
    vp.viewport.x += dx;
    vp.viewport.y += dy;
    merged_capture_state(handles.inner())
}

#[tauri::command]
pub fn set_zoom(
    app: AppHandle,
    handles: State<AppHandles>,
    zoom: f64,
) -> CaptureState {
    let viewport = {
        let mut vp = handles.viewport.lock();
        vp.zoom_target = normalize_zoom(zoom);
        vp.viewport.zoom = vp.zoom_target;
        vp.viewport
    };
    let cs = merged_capture_state(handles.inner());
    emit_viewport_update(&app, viewport);
    cs
}

use std::time::Duration;

fn emit_countdown(app: &AppHandle, seconds: u8) {
    let payload = serde_json::json!({ "seconds": seconds });
    let _ = app.emit("recording:countdown", payload.clone());
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit("recording:countdown", payload);
    }
}

const RECORD_COUNTDOWN_SECS: u8 = 5;

fn run_recording_countdown(app: AppHandle, state: SharedState) {
    for remaining in (1..=RECORD_COUNTDOWN_SECS).rev() {
        {
            let mut st = state.lock();
            if !st.recording_armed {
                st.countdown_seconds = 0;
                emit_countdown(&app, 0);
                let _ = app.emit(
                    "recording:state",
                    serde_json::json!({ "recording": false, "arming": false }),
                );
                apply_overlay_visibility(&app, &st);
                return;
            }
            st.countdown_seconds = remaining;
        }
        emit_countdown(&app, remaining);
        std::thread::sleep(Duration::from_secs(1));
    }

    {
        let st = state.lock();
        if !st.recording_armed {
            emit_countdown(&app, 0);
            let _ = app.emit(
                "recording:state",
                serde_json::json!({ "recording": false, "arming": false }),
            );
            apply_overlay_visibility(&app, &st);
            return;
        }
    }

    match capture::start_recording(state.clone()) {
        Ok(()) => {
            {
                let mut st = state.lock();
                st.recording = true;
                st.recording_armed = false;
                st.countdown_seconds = 0;
            }
            emit_countdown(&app, 0);
            let _ = app.emit(
                "recording:state",
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
            emit_countdown(&app, 0);
            apply_overlay_visibility(&app, &state.lock());
            let _ = app.emit("app:log", e.to_string());
            let _ = app.emit(
                "recording:state",
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

    ensure_overlay(&app);
    minimize_main_window(&app);
    let _ = app.emit(
        "recording:state",
        serde_json::json!({ "recording": false, "arming": true }),
    );

    let shared: SharedState = handles.inner().state.clone();
    let app_bg = app.clone();
    std::thread::Builder::new()
        .name("record-countdown".into())
        .spawn(move || run_recording_countdown(app_bg, shared))
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
    emit_countdown(&app, 0);
    apply_overlay_visibility(&app, &handles.state.lock());
    let _ = app.emit(
        "recording:state",
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
    // Update UI immediately — finalize (FFmpeg join) can take a moment on long clips.
    let _ = app.emit(
        "recording:state",
        serde_json::json!({ "recording": false, "finalizing": true }),
    );
    let shared: SharedState = handles.inner().state.clone();
    let app_bg = app.clone();
    std::thread::Builder::new()
        .name("stop-recording".into())
        .spawn(move || match capture::stop_recording(shared.clone()) {
            Ok(info) => {
                let _ = app_bg.emit(
                    "recording:state",
                    serde_json::json!({ "recording": false, "finalizing": false }),
                );
                let _ = app_bg.emit("recording:finished", info);
                apply_overlay_visibility(&app_bg, &shared.lock());
            }
            Err(e) => {
                let msg = e.to_string();
                crate::log::capture_log(&format!("Recording failed: {msg}"));
                let _ = app_bg.emit("app:log", &msg);
                let _ = app_bg.emit(
                    "recording:state",
                    serde_json::json!({ "recording": false, "finalizing": false }),
                );
                let _ = app_bg.emit("recording:finished", Option::<RecordingInfo>::None);
                apply_overlay_visibility(&app_bg, &shared.lock());
            }
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
pub fn start_camera(
    app: AppHandle,
    handles: State<AppHandles>,
) -> Result<CaptureState, String> {
    let shared: SharedState = handles.inner().state.clone();
    capture::start_camera(shared).map_err(|e| e.to_string())?;
    ensure_overlay(&app);
    let _ = app.emit("camera:state", serde_json::json!({ "enabled": true }));
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

/// Copy a recording to a user-chosen destination (the "Export" save flow).
/// The destination path is picked on the frontend via the save dialog; we
/// resolve the source by id here so only known recordings can be exported.
#[tauri::command]
pub fn export_recording(id: String, dest: String) -> Result<(), String> {
    let rec = recordings::list_recordings()
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Recording not found".to_string())?;
    let src = std::path::PathBuf::from(&rec.path);
    if !src.exists() {
        return Err("Source file no longer exists".to_string());
    }
    // Decrypt the at-rest .ns into the user-chosen .mp4.
    crate::crypto::decrypt_to_file(&src, std::path::Path::new(&dest))
        .map_err(|e| format!("Export failed: {e}"))?;
    Ok(())
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
    handles: State<AppHandles>,
    settings: RecordingSettings,
) {
    let mut st = handles.state.lock();
    st.recording_settings = settings;
    st.recording_settings.orientation = Orientation::Portrait;
    handles.viewport.lock().viewport.orientation = Orientation::Portrait;
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
    handles.state.lock().audio_settings = settings.clone();
    if settings.source == crate::state::AudioSourceMode::None {
        audio::stop_monitor();
    } else {
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
