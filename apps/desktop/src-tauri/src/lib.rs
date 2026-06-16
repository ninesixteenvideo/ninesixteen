mod audio;
mod capture;
mod commands;
mod crypto;
mod entitlement;
mod entitlement_store;
mod export;
mod feedback;
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
mod save_progress;
mod state;
#[cfg(desktop)]
mod tray;
mod watchdog;

use state::new_app_handles;
use tauri::{Emitter, Manager, Theme};

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

/// Free / unsigned preview length in seconds. Pro users get the full file.
const PREVIEW_SECS: f64 = 15.0;

fn preview_byte_limit(total: u64, duration_secs: f64) -> u64 {
    if total == 0 {
        return 0;
    }
    let dur = duration_secs.max(1.0);
    let cap = ((PREVIEW_SECS / dur) * total as f64).ceil() as u64;
    cap.clamp(1, total)
}

fn clamp_range(start: u64, end: u64, max_end: u64) -> Option<(u64, u64)> {
    if max_end == 0 {
        return None;
    }
    let start = start.min(max_end);
    let end = end.min(max_end);
    if start > end {
        return None;
    }
    Some((start, end))
}

/// `nsmedia://localhost/<id>` — streams a decrypted recording to the in-app
/// player with HTTP range support (so seeking works), without ever writing
/// plaintext to disk. Non-Pro users are limited to the first 15 seconds.
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

    let is_pro = state::global_entitlement().lock().is_pro();
    let served_total = if is_pro {
        total
    } else {
        preview_byte_limit(total, recordings::recording_duration(&id))
    };
    let max_end = served_total.saturating_sub(1);

    let range_hdr = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let has_range = range_hdr.is_some();
    let (start, end) = match parse_range(range_hdr.as_deref(), served_total) {
        Some(r) => r,
        None => (0, max_end),
    };
    let (start, end) = match clamp_range(start, end, max_end) {
        Some(r) => r,
        None => return fail(StatusCode::RANGE_NOT_SATISFIABLE),
    };
    let len = if served_total == 0 {
        0
    } else {
        (end - start + 1) as usize
    };

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
            .header(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{served_total}"),
            )
    } else {
        builder.status(StatusCode::OK)
    };
    builder.body(data).unwrap_or_else(|_| fail(StatusCode::INTERNAL_SERVER_ERROR))
}

/// Size the main window: 9×16 height band, twice the portrait content width.
fn apply_main_window_theme(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    // Native title bar + window chrome (Windows DWM dark mode).
    let _ = win.set_theme(Some(Theme::Dark));
}

/// Stop the Alt key from freezing our windows.
///
/// When Alt (or F10) is pressed while one of our windows is the active window,
/// Windows' `DefWindowProc` enters the modal **system-menu loop** (`SC_KEYMENU`),
/// which takes over and blocks that window's message thread until menu mode is
/// dismissed. Because Tauri pumps the overlay's per-frame updates on that same
/// thread, the on-desktop framing box stops following the cursor until Alt is
/// pressed again (which exits menu mode). The recorder runs on its own thread,
/// so the captured video is unaffected — exactly the reported symptom.
///
/// We have no native menus, so we subclass our windows and swallow `SC_KEYMENU`,
/// which prevents the modal loop from ever starting. Alt itself still works
/// everywhere else (Alt+scroll zoom uses low-level hooks that fire before this).
#[cfg(windows)]
unsafe extern "system" fn alt_menu_guard_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _uid: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{SC_KEYMENU, WM_SYSCOMMAND};
    if msg == WM_SYSCOMMAND && (wparam.0 & 0xFFF0) == SC_KEYMENU as usize {
        return windows::Win32::Foundation::LRESULT(0);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

#[cfg(windows)]
fn install_alt_menu_guard(app: &tauri::AppHandle, label: &str) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::SetWindowSubclass;
    let Some(win) = app.get_webview_window(label) else {
        return;
    };
    if let Ok(h) = win.hwnd() {
        // Reconstruct the HWND in our own `windows` crate version to avoid any
        // version-coupling with Tauri's internal handle type.
        let hwnd = HWND(h.0 as *mut core::ffi::c_void);
        unsafe {
            let _ = SetWindowSubclass(hwnd, Some(alt_menu_guard_proc), 0, 0);
        }
    }
}

#[cfg(not(windows))]
fn install_alt_menu_guard(_app: &tauri::AppHandle, _label: &str) {}

/// Pin the main window to the left work-area edge at `width` logical px × full height.
pub fn sync_dock_window(app: &tauri::AppHandle, width: f64) {
    use tauri::{PhysicalPosition, PhysicalSize};

    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let Ok(Some(mon)) = win.primary_monitor() else {
        return;
    };
    let scale = mon.scale_factor();
    let area = mon.work_area();
    let w = width.max(48.0).round();
    let phys_w = (w * scale).round().max(48.0) as u32;
    let phys_h = area.size.height as u32;
    let phys_x = area.position.x;
    let phys_y = area.position.y;

    let _ = win.set_resizable(true);
    if win
        .set_size(PhysicalSize::new(phys_w, phys_h))
        .is_err()
    {
        log::capture_log(&format!("sync_dock_window: set_size failed for width={w}"));
    }
    let _ = win.set_position(PhysicalPosition::new(phys_x, phys_y));
}

fn dock_main_window(app: &tauri::AppHandle) {
    apply_main_window_theme(app);
    install_alt_menu_guard(app, "main");
    install_alt_menu_guard(app, "overlay");
    sync_dock_window(app, 535.0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log::init();

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

    let mut builder = tauri::Builder::default();

    // Single-instance MUST be the first plugin: a second launch forwards to the
    // already-running app (show + focus the window) and then exits, so we never
    // accumulate duplicate processes / tray icons.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::show_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| hotkeys::handle(app, shortcut, event))
                .build(),
        )
        .register_uri_scheme_protocol("nsmedia", |_app, request| nsmedia_response(request))
        .manage(handles)
        .setup(move |app| {
            crate::entitlement::hydrate_from_disk();

            // Never block the WebView on filesystem migration — can encrypt many files.
            std::thread::Builder::new()
                .name("startup-migrate".into())
                .spawn(|| recordings::migrate_plaintext())
                .ok();

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
                    // Warm the encoder on a background thread so the first recording
                    // starts instantly instead of probing 4 encoders mid-countdown.
                    file_record::warmup_encoder();
                } else {
                    log::capture_log(
                        "FFmpeg not bundled — run: node scripts/fetch-ffmpeg.mjs",
                    );
                }
            }

            dock_main_window(app.handle());

            #[cfg(desktop)]
            {
                if let Err(e) = tray::setup_tray(app.handle()) {
                    log::capture_log(&format!("System tray unavailable: {e}"));
                }
            }

            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
            for (mods, code, label) in [
                (Modifiers::ALT, Code::KeyR, "Alt+R (record)"),
                (Modifiers::ALT, Code::KeyV, "Alt+V (frame)"),
                (Modifiers::ALT, Code::KeyF, "Alt+F (freeze frame)"),
                (Modifiers::ALT, Code::ArrowUp, "Alt+↑ (zoom in)"),
                (Modifiers::ALT, Code::ArrowDown, "Alt+↓ (zoom out)"),
            ] {
                let shortcut = Shortcut::new(Some(mods), code);
                if let Err(e) = app.global_shortcut().register(shortcut) {
                    log::capture_log(&format!(
                        "Global shortcut {label} unavailable (another instance running?): {e}"
                    ));
                }
            }

            rawinput::start(app.handle().clone(), viewport.clone(), shared.clone());
            rawinput::start_cursor_follow(app.handle().clone(), viewport.clone(), shared.clone());
            commands::start_overlay_refresh_loop(
                app.handle().clone(),
                shared.clone(),
                viewport.clone(),
            );
            watchdog::start(app.handle().clone(), shared.clone(), viewport.clone());

            let app_handle = app.handle().clone();
            let st = shared.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(250));
                let camera_on = st.lock().camera_enabled;
                if camera_on {
                    capture::ensure_capture_session(st.clone());
                }
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

            // Virtual camera starts only after the UI is interactive (see notify_app_ready).
            // Auto-starting WGC + 1080p GPU readback at launch starved the WebView in release builds.

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
            commands::rename_recording,
            commands::export_recording,
            commands::export_recording_local,
            commands::export_recording_to_drive,
            commands::sync_entitlement,
            commands::apply_entitlement_cache,
            commands::clear_entitlement,
            commands::open_recordings_folder,
            commands::notify_app_ready,
            commands::sync_dock_window,
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
            feedback::submit_feedback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ninesixteen.video");
}