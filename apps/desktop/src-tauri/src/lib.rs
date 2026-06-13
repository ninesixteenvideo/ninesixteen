mod audio;
mod capture;
mod commands;
mod crypto;
mod geometry;
mod hotkeys;
#[cfg(windows)]
mod flv;
#[cfg(windows)]
mod gpu_scale;
mod monitors;
mod rawinput;
mod recordings;
#[cfg(windows)]
mod rtmp_publish;
mod screenshot;
#[cfg(windows)]
mod stream;
#[cfg(windows)]
mod ffmpeg_util;
#[cfg(windows)]
mod file_record;
#[cfg(windows)]
mod camera;
mod log;
mod state;
#[cfg(desktop)]
mod tray;

use state::new_app_handles;
use tauri::{Emitter, LogicalSize, Manager};

/// Parse a `Range: bytes=…` header value into an inclusive `(start, end)` range.
fn parse_range(header: Option<&str>, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return Some((0, 0));
    }
    let spec = header?.strip_prefix("bytes=")?;
    let (s, e) = spec.split_once('-')?;
    if s.is_empty() {
        // suffix range: last N bytes
        let n: u64 = e.parse().ok()?;
        let n = n.min(total);
        return Some((total - n, total - 1));
    }
    let start: u64 = s.parse().ok()?;
    let end: u64 = if e.is_empty() {
        total - 1
    } else {
        e.parse::<u64>().ok()?.min(total - 1)
    };
    if start > end {
        return None;
    }
    Some((start, end))
}

/// `nsmedia://localhost/<id>` — streams a decrypted recording to the in-app
/// player with HTTP range support (so seeking works), without ever writing
/// plaintext to disk.
fn nsmedia_response(request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};

    let fail = |code: StatusCode| {
        Response::builder()
            .status(code)
            .body(Vec::new())
            .unwrap_or_default()
    };

    let id = request.uri().path().trim_start_matches('/').to_string();
    if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return fail(StatusCode::BAD_REQUEST);
    }
    let ns = recordings::recordings_dir().join(format!("{id}.ns"));
    if !ns.exists() {
        return fail(StatusCode::NOT_FOUND);
    }
    let total = match crypto::plaintext_len(&ns) {
        Ok(t) => t,
        Err(_) => return fail(StatusCode::INTERNAL_SERVER_ERROR),
    };

    let range_hdr = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let has_range = range_hdr.is_some();
    let (start, end) = parse_range(range_hdr.as_deref(), total).unwrap_or((0, total.saturating_sub(1)));
    let len = if total == 0 { 0 } else { (end - start + 1) as usize };

    let data = match crypto::decrypt_range(&ns, start, len) {
        Ok(d) => d,
        Err(_) => return fail(StatusCode::INTERNAL_SERVER_ERROR),
    };

    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, "video/mp4")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_LENGTH, data.len());
    builder = if has_range {
        builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{total}"))
    } else {
        builder.status(StatusCode::OK)
    };
    builder.body(data).unwrap_or_else(|_| fail(StatusCode::INTERNAL_SERVER_ERROR))
}

/// Size the main window: 9×16 height band, twice the portrait content width.
fn fit_main_window_portrait(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(mon)) = win.primary_monitor() else {
        return;
    };
    let scale = mon.scale_factor();
    let mon_w = mon.size().width as f64 / scale;
    let mon_h = mon.size().height as f64 / scale;
    let margin = 0.94;
    let height = mon_h * margin;
    let mut width = height * 9.0 / 16.0 * 2.0;
    if width > mon_w * margin {
        width = mon_w * margin;
    }
    let _ = win.set_size(LogicalSize::new(width.round(), height.round()));
    let _ = win.center();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let handles = new_app_handles();
    let shared = handles.state.clone();
    let viewport = handles.viewport.clone();

    {
        let mons = monitors::list_monitors();
        let primary = mons
            .iter()
            .find(|m| m.is_primary)
            .cloned()
            .or_else(|| mons.first().cloned());
        if let Some(m) = primary {
            let mut vp = viewport.lock();
            vp.viewport.x = m.width as f64 / 2.0;
            vp.viewport.y = m.height as f64 / 2.0;
            vp.zoom_target = vp.viewport.zoom;
            vp.monitor = Some(m);
        }
    }

    #[cfg(windows)]
    capture::bind_viewport(viewport.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["Alt+KeyR", "Alt+KeyV"])
                .expect("valid global shortcut definitions")
                .with_handler(|app, shortcut, event| hotkeys::handle(app, shortcut, event))
                .build(),
        )
        .register_uri_scheme_protocol("nsmedia", |_app, request| nsmedia_response(request))
        .manage(handles)
        .setup(move |app| {
            // Encrypt any leftover plaintext recordings before anything reads them.
            recordings::migrate_plaintext();

            #[cfg(windows)]
            {
                let mut bundled: Option<std::path::PathBuf> = None;
                if let Ok(res) = app.path().resource_dir() {
                    let candidate = res.join("ffmpeg").join("ffmpeg.exe");
                    if candidate.exists() {
                        bundled = Some(candidate);
                    }
                }
                if bundled.is_none() {
                    let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("resources")
                        .join("ffmpeg")
                        .join("ffmpeg.exe");
                    if dev.exists() {
                        bundled = Some(dev);
                    }
                }
                if let Some(path) = bundled {
                    ffmpeg_util::set_bundled_ffmpeg(path);
                    file_record::warmup_encoder();
                } else {
                    log::capture_log(
                        "FFmpeg not bundled — run: node scripts/fetch-ffmpeg.mjs",
                    );
                }
            }

            fit_main_window_portrait(app.handle());

            #[cfg(desktop)]
            {
                if let Err(e) = tray::setup_tray(app.handle()) {
                    log::capture_log(&format!("System tray unavailable: {e}"));
                }
            }

            rawinput::start(app.handle().clone(), viewport.clone(), shared.clone());
            rawinput::start_cursor_follow(app.handle().clone(), viewport.clone(), shared.clone());

            let overlay_handle = app.handle().clone();
            let overlay_state = shared.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(350));
                commands::apply_overlay_visibility(&overlay_handle, &overlay_state.lock());
            });

            let app_handle = app.handle().clone();
            let st = shared.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                let (recording, streaming, camera_enabled, elapsed, stream_elapsed, size, stream_stats, camera_connected) = {
                    let mut s = st.lock();
                    let elapsed = s
                        .session_start
                        .or(s.current_start)
                        .map(|t| t.elapsed().as_secs_f64())
                        .unwrap_or(0.0);
                    let stream_elapsed = s
                        .stream_start
                        .map(|t| t.elapsed().as_secs_f64())
                        .unwrap_or(0.0);
                    let size = s
                        .current_path
                        .as_ref()
                        .and_then(|p| std::fs::metadata(p).ok())
                        .map(|m| m.len())
                        .unwrap_or(0);
                    if s.streaming {
                        s.stream_stats.connected = true;
                    }
                    if s.camera_enabled {
                        s.camera_connected = capture::poll_camera_connected();
                    }
                    (
                        s.recording,
                        s.streaming,
                        s.camera_enabled,
                        elapsed,
                        stream_elapsed,
                        size,
                        s.stream_stats.clone(),
                        s.camera_connected,
                    )
                };
                if recording {
                    let _ = app_handle.emit(
                        "recording:tick",
                        serde_json::json!({ "elapsed": elapsed, "size_bytes": size }),
                    );
                }
                if streaming {
                    let _ = app_handle.emit(
                        "streaming:tick",
                        serde_json::json!({
                            "elapsed": stream_elapsed,
                            "bytes_sent": stream_stats.bytes_sent,
                            "frames_sent": stream_stats.frames_sent,
                            "connected": stream_stats.connected,
                            "error": stream_stats.error,
                        }),
                    );
                }
                if camera_enabled {
                    let _ = app_handle.emit(
                        "camera:tick",
                        serde_json::json!({ "connected": camera_connected }),
                    );
                }
            });

            let audio_app = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(100));
                if audio::monitor_active() {
                    let levels = audio::monitor_levels();
                    let _ = audio_app.emit("audio:levels", levels);
                }
            });

            // Virtual camera is always on — pick "ninesixteen.video" in any app.
            let cam_app = app.handle().clone();
            let cam_state = shared.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(900));
                match capture::start_camera(cam_state.clone()) {
                    Ok(()) => {
                        let _ = cam_app.emit("camera:state", serde_json::json!({ "enabled": true }));
                        commands::apply_overlay_visibility(&cam_app, &cam_state.lock());
                    }
                    Err(e) => {
                        log::capture_log(&format!("Virtual camera unavailable: {e}"));
                        let _ = cam_app.emit(
                            "app:log",
                            format!("Virtual camera unavailable: {e}"),
                        );
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            tray::on_main_window_event(window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_monitors,
            commands::get_state,
            commands::get_monitor_thumbnail,
            commands::set_viewport,
            commands::nudge_viewport,
            commands::set_zoom,
            commands::start_recording,
            commands::cancel_recording_countdown,
            commands::stop_recording,
            commands::start_camera,
            commands::stop_camera,
            commands::start_streaming,
            commands::start_both,
            commands::stop_streaming,
            commands::set_stream_settings,
            commands::list_recordings,
            commands::delete_recording,
            commands::export_recording,
            commands::open_recordings_folder,
            commands::set_input_settings,
            commands::set_recording_settings,
            commands::list_audio_devices,
            commands::get_audio_settings,
            commands::set_audio_settings,
            commands::start_audio_monitor,
            commands::stop_audio_monitor,
            commands::get_audio_levels,
            commands::show_overlay,
            commands::hide_overlay,
            commands::set_overlay,
            commands::set_overlay_visible,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ninesixteen.video");
}