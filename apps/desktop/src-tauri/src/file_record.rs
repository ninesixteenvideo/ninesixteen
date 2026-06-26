//! Local MP4 recording — MF GPU surface ingest (default) or FFmpeg raw BGRA pipe (fallback).
use crate::ffmpeg_util::{find_ffmpeg, ffmpeg_command};
use crate::log::capture_log;
use crate::save_progress;
use crate::state::{SharedState, Viewport};
#[cfg(windows)]
use crate::audio::{self, RecordingAudio};
#[cfg(windows)]
use crate::hw_encode::{prefer_hw_encode, HwEncoder};
#[cfg(windows)]
use windows_capture::d3d11::SendDirectX;
#[cfg(windows)]
use windows::Graphics::DirectX::Direct3D11::IDirect3DSurface;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use parking_lot::Mutex;

static CACHED_ENCODER: OnceLock<String> = OnceLock::new();

/// Move the MP4 index (`moov`) to the front for fast library load / seeking.
#[cfg(windows)]
pub fn apply_faststart(path: &Path) -> Result<(), String> {
    use std::process::Stdio;

    if !path.exists() {
        return Err("recording file missing".into());
    }
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() < 512 {
        return Ok(());
    }
    let ffmpeg = find_ffmpeg()?;
    let temp = path.with_extension("faststart.tmp.mp4");
    let output = ffmpeg_command(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
        ])
        .arg(path)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(&temp)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("faststart ffmpeg: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(&temp);
        return Err(format!("faststart remux failed: {err}"));
    }
    std::fs::rename(&temp, path).map_err(|e| format!("replace after faststart: {e}"))?;
    Ok(())
}

#[cfg(not(windows))]
pub fn apply_faststart(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// CFR slot rate fed to FFmpeg — honors the user's 30 or 60fps choice for every
/// resolution and orientation. When the GPU cannot keep pace, the wall-clock slot
/// scheduler holds the last unique frame (duplicate CFR slots) so A/V stays aligned.
pub fn recording_fps(requested: u32) -> u32 {
    normalize_recording_fps(requested)
}

/// UI exposes 30 and 60; clamp anything else to the nearest supported rate.
pub fn normalize_recording_fps(requested: u32) -> u32 {
    if requested >= 55 {
        60
    } else {
        30
    }
}

#[cfg(test)]
mod recording_fps_tests {
    use super::*;

    #[test]
    fn recording_fps_honors_sixty_for_all_modes() {
        assert_eq!(recording_fps(60), 60);
        assert_eq!(recording_fps(30), 30);
        assert_eq!(normalize_recording_fps(45), 30);
        assert_eq!(normalize_recording_fps(59), 60);
    }
}

/// COM surface safe to share across recording threads (ref-counted clone).
#[cfg(windows)]
struct ShareSurface(SendDirectX<IDirect3DSurface>);

#[cfg(windows)]
impl Clone for ShareSurface {
    fn clone(&self) -> Self {
        Self(SendDirectX::new(self.0.0.clone()))
    }
}

#[cfg(windows)]
unsafe impl Send for ShareSurface {}

#[cfg(windows)]
unsafe impl Sync for ShareSurface {}

/// Desktop crop + session timestamp baked at GPU publish time (not at encode time).
#[derive(Clone)]
pub struct RecFrame {
    pub pixels: Option<Arc<Vec<u8>>>,
    #[cfg(windows)]
    pub surface: Option<ShareSurface>,
    pub viewport: Viewport,
    pub src_w: u32,
    pub src_h: u32,
    /// CFR timeline position for this slot (seconds from session start).
    pub t_secs: f64,
    /// Monotonic id bumped on each GPU publish (holds share the same id).
    pub capture_id: u64,
    /// Cinematic cursor already composited on GPU (or promo CPU stamp).
    pub cursor_pre_stamped: bool,
}

static REC_CAPTURE_ID: AtomicU64 = AtomicU64::new(0);
static REC_GPU_PUBLISHES: AtomicU64 = AtomicU64::new(0);

/// Unique GPU frames published since the last recording (reset in `clear_capture_frame`).
pub fn recording_gpu_publish_count() -> u64 {
    REC_GPU_PUBLISHES.load(Ordering::Relaxed)
}

fn rec_frame_is_hold(prev: &RecFrame, next: &RecFrame) -> bool {
    prev.capture_id != 0 && prev.capture_id == next.capture_id
}

/// Bind a CFR slot time and the live viewport at push time (cursor + crop metadata).
fn frame_for_cfr_slot(source: &Arc<RecFrame>, slot_t_secs: f64) -> Arc<RecFrame> {
    let (viewport, src_w, src_h) = crate::capture::recording_viewport_context();
    Arc::new(RecFrame {
        pixels: source.pixels.clone(),
        #[cfg(windows)]
        surface: source.surface.clone(),
        viewport,
        src_w,
        src_h,
        t_secs: slot_t_secs,
        capture_id: source.capture_id,
        cursor_pre_stamped: source.cursor_pre_stamped,
    })
}

static HW_ENCODE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// True while an MF GPU-surface recorder is active (capture skips CPU readback).
pub fn recording_uses_hw_encode() -> bool {
    HW_ENCODE_ACTIVE.load(Ordering::Relaxed)
}

static REC_SESSION_CLOCK: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

fn arm_recording_session_clock(start: Instant) {
    *REC_SESSION_CLOCK
        .get_or_init(|| Mutex::new(None))
        .lock() = Some(start);
}

fn clear_recording_session_clock() {
    if let Some(slot) = REC_SESSION_CLOCK.get() {
        *slot.lock() = None;
    }
}

pub fn session_t_secs() -> f64 {
    REC_SESSION_CLOCK
        .get()
        .and_then(|slot| slot.lock().as_ref().map(|s| s.elapsed().as_secs_f64()))
        .unwrap_or(0.0)
}

pub fn warmup_encoder() {
    if CACHED_ENCODER.get().is_some() {
        return;
    }
    std::thread::Builder::new()
        .name("ffmpeg-warmup".into())
        .spawn(|| {
            let enc = select_encoder();
            capture_log(&format!("FFmpeg encoder selected: {enc}"));
            let _ = CACHED_ENCODER.set(enc);
        })
        .ok();
}

pub struct FileRecorder {
    stop_tx: SyncSender<()>,
    worker: Option<JoinHandle<Result<(u64, f64), String>>>,
    path: PathBuf,
    tagged_fps: u32,
    #[cfg(windows)]
    audio: Option<RecordingAudio>,
}

impl FileRecorder {
    pub fn start(
        path: &Path,
        width: u32,
        height: u32,
        fps: u32,
        bitrate_kbps: u32,
        state: SharedState,
    ) -> Result<Arc<Self>, String> {
        let path = path.to_path_buf();
        let path_log = path.display().to_string();
        let (stop_tx, stop_rx) = mpsc::sync_channel(1);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let path_worker = path.clone();
        let tagged_fps = fps.max(1);
        let audio_settings = state.lock().audio_settings.clone();
        let (session_tx, session_rx) = mpsc::sync_channel(1);
        let session_target = Arc::new(AtomicU64::new(0));
        let pcm_path = path.with_extension("pcm");
        #[cfg(windows)]
        let (audio, has_audio, audio_stop) = if audio::source_active(audio_settings.source) {
            match RecordingAudio::start(
                audio_settings,
                session_rx,
                session_target.clone(),
                pcm_path.clone(),
            ) {
                Ok((rec, pcm_log)) => {
                    let stop_flag = rec.stop_flag();
                    capture_log(&format!("Audio capture → {}", pcm_log.display()));
                    (Some(rec), true, Some(stop_flag))
                }
                Err(e) => {
                    capture_log(&format!("WARN: audio capture failed ({e}); recording video only"));
                    (None, false, None)
                }
            }
        } else {
            (None, false, None)
        };
        #[cfg(windows)]
        let session_tx = if has_audio {
            Some(session_tx)
        } else {
            None
        };
        #[cfg(not(windows))]
        let has_audio = false;
        let pcm_path_worker = pcm_path.clone();

        let worker = std::thread::Builder::new()
            .name("file-recorder".into())
            .spawn(move || {
                run(
                    path_worker,
                    stop_rx,
                    ready_tx,
                    width,
                    height,
                    tagged_fps,
                    bitrate_kbps,
                    state,
                    has_audio,
                    pcm_path_worker,
                    session_target,
                    session_tx,
                    audio_stop,
                )
            })
            .map_err(|e| format!("spawn recorder thread: {e}"))?;

        match ready_rx.recv_timeout(Duration::from_secs(45)) {
            Ok(Ok(())) => {
                capture_log(&format!(
                    "FFmpeg recorder ready → {path_log} ({tagged_fps}fps CFR, wall-clock slots)"
                ));
            }
            Ok(Err(e)) => return Err(e),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return Err("FFmpeg did not start in time".into());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("recorder thread exited before FFmpeg started".into());
            }
        }

        Ok(Arc::new(Self {
            stop_tx,
            worker: Some(worker),
            path,
            tagged_fps,
            #[cfg(windows)]
            audio,
        }))
    }

    pub fn finish(self: Arc<Self>) -> Result<(u64, u64, f64), String> {
        let _ = self.stop_tx.send(());
        let mut rec = Arc::try_unwrap(self)
            .map_err(|_| "recorder still referenced during finalize".to_string())?;
        let path = rec.path.clone();
        let tagged_fps = rec.tagged_fps;
        #[cfg(windows)]
        let audio = rec.audio.take();
        let worker = rec
            .worker
            .take()
            .ok_or_else(|| "recorder worker missing".to_string())?;
        drop(rec);
        save_progress::report(12, "finalizing");
        let _heartbeat = save_progress::start_heartbeat(12, 21, 60.0);
        let (frames, duration) = match worker.join() {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err("recorder thread panicked".into()),
        };
        // Worker may already have reported up to ~38; bridge before post-join steps.
        save_progress::report(45, "finalizing");
        save_progress::report(52, "finalizing");
        #[cfg(windows)]
        if let Some(audio) = audio {
            if let Err(e) = audio.stop() {
                capture_log(&format!("WARN: audio stop: {e}"));
            }
        }
        #[cfg(windows)]
        {
            let pcm_path = path.with_extension("pcm");
            let wants_clicks = crate::click_audio::has_recorded_clicks();
            if wants_clicks {
                save_progress::report(54, "audio");
                if let Err(e) = crate::click_audio::apply_to_pcm_sidecar(&pcm_path, duration) {
                    capture_log(&format!("WARN: click audio mix failed ({e}"));
                }
            }
            if has_audio_sidecar(&pcm_path) {
                save_progress::report(55, "audio");
                if let Err(e) = mux_pcm_audio(&path, &pcm_path, duration) {
                    capture_log(&format!("WARN: audio mux failed ({e}"));
                }
                save_progress::report(62, "audio");
                let _ = std::fs::remove_file(&pcm_path);
            }
        }
        if frames > 0 && duration >= 0.25 {
            capture_log(&format!(
                "Recording timing: {frames} frames @ {tagged_fps}fps = {duration:.2}s"
            ));
        }
        let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        Ok((frames, bytes, duration))
    }
}

fn wait_until_slot(deadline: Instant) {
    loop {
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        let remaining = deadline - now;
        if remaining > Duration::from_millis(2) {
            std::thread::sleep(Duration::from_micros(500));
        } else {
            std::hint::spin_loop();
        }
    }
}

#[cfg(windows)]
fn boost_recording_thread_priority() {
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL,
    };
    unsafe {
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
    }
}

#[cfg(not(windows))]
fn boost_recording_thread_priority() {}

/// Latest recording frame written by the capture thread (fresh monitor ingest).
static REC_CAPTURE_FRAME: OnceLock<parking_lot::Mutex<Option<Arc<RecFrame>>>> = OnceLock::new();

/// Viewport baked into the last GPU render — avoids re-locking shared viewport on publish.
static REC_FRAME_CONTEXT: OnceLock<parking_lot::Mutex<Option<(Viewport, u32, u32)>>> =
    OnceLock::new();

/// Called from the WGC thread after each GPU crop (while `gpu_bridge` is already locked).
pub fn set_rec_frame_context(viewport: Viewport, src_w: u32, src_h: u32) {
    *REC_FRAME_CONTEXT
        .get_or_init(|| parking_lot::Mutex::new(None))
        .lock() = Some((viewport, src_w, src_h));
}

fn rec_frame_context() -> (Viewport, u32, u32) {
    if let Some(ctx) = REC_FRAME_CONTEXT
        .get()
        .and_then(|slot| slot.lock().clone())
    {
        return ctx;
    }
    crate::capture::recording_viewport_context()
}

pub fn publish_capture_frame(pixels: Vec<u8>) {
    publish_capture_frame_inner(Some(pixels), None, false);
}

pub fn publish_promo_capture_frame(pixels: Vec<u8>) {
    publish_capture_frame_inner(Some(pixels), None, true);
}

#[cfg(windows)]
pub fn publish_capture_surface(surface: SendDirectX<IDirect3DSurface>, cursor_pre_stamped: bool) {
    publish_capture_frame_inner(None, Some(ShareSurface(surface)), cursor_pre_stamped);
}

pub fn publish_capture_frame_pre_stamped(pixels: Vec<u8>) {
    publish_capture_frame_inner(Some(pixels), None, true);
}

fn publish_capture_frame_inner(
    pixels: Option<Vec<u8>>,
    #[cfg(windows)] surface: Option<ShareSurface>,
    #[cfg(not(windows))] _surface: Option<()>,
    cursor_pre_stamped: bool,
) {
    let (viewport, src_w, src_h) = rec_frame_context();
    let frame = Arc::new(RecFrame {
        pixels: pixels.map(Arc::new),
        #[cfg(windows)]
        surface,
        viewport,
        src_w,
        src_h,
        t_secs: session_t_secs(),
        capture_id: REC_CAPTURE_ID.fetch_add(1, Ordering::Relaxed) + 1,
        cursor_pre_stamped,
    });
    let slot = REC_CAPTURE_FRAME.get_or_init(|| parking_lot::Mutex::new(None));
    *slot.lock() = Some(frame);
    REC_GPU_PUBLISHES.fetch_add(1, Ordering::Relaxed);
}

fn peek_capture_frame() -> Option<Arc<RecFrame>> {
    REC_CAPTURE_FRAME
        .get()
        .and_then(|slot| slot.lock().clone())
}

/// Drop any frame left in the shared slot from a previous recording.
///
/// The slot is a process-global latch that retains the last published frame
/// after a recording stops. If the next recording uses a different resolution
/// (e.g. 1080p → 720p) that stale frame would be the wrong size for the new
/// FFmpeg pipe, so we discard it here so the new recording only ever starts
/// from a freshly captured frame at the current resolution.
fn clear_capture_frame() {
    if let Some(slot) = REC_CAPTURE_FRAME.get() {
        *slot.lock() = None;
    }
    if let Some(ctx) = REC_FRAME_CONTEXT.get() {
        *ctx.lock() = None;
    }
    REC_CAPTURE_ID.store(0, Ordering::Relaxed);
    REC_GPU_PUBLISHES.store(0, Ordering::Relaxed);
    clear_recording_session_clock();
    STRAY_FRAME_LOGS.store(0, Ordering::Relaxed);
}

fn log_rec_live_stats(
    state: SharedState,
    elapsed: f64,
    written: u64,
    hold_frames: u64,
    hold_pct: f64,
    gpu_fps: f64,
    target_fps: u32,
    wgc_5s: u64,
    cap_renders_5s: u64,
    glide_5s: u64,
    avg_render_us: u64,
    avg_read_us: u64,
    avg_handler_us: u64,
    enc_backlog: u64,
    encoder_label: &str,
) {
    capture_log(&format!(
        "Rec live @ {elapsed:.0}s: {written} {encoder_label}, {hold_frames} holds ({hold_pct:.0}%), \
         {gpu_fps:.1} unique GPU/s (target {target_fps}fps), WGC {wgc_5s}/5s, capture renders {cap_renders_5s}/5s, \
         glide {glide_5s}/5s, GPU render {:.1}ms read {:.1}ms handler {:.1}ms, enc backlog {enc_backlog}",
        avg_render_us as f64 / 1000.0,
        avg_read_us as f64 / 1000.0,
        avg_handler_us as f64 / 1000.0,
    ));
    if elapsed <= 8.0 && gpu_fps < target_fps as f64 * 0.75 && hold_pct >= 40.0 {
        capture_log(&format!(
            "WARN: capture warming up — {:.0}% hold frames, {:.1}/{target_fps} unique GPU/s (overlay/cursor may feel sluggish)",
            hold_pct, gpu_fps
        ));
    } else if elapsed >= 60.0 && hold_pct >= 8.0 && gpu_fps < target_fps as f64 * 0.92 {
        capture_log(&format!(
            "WARN: capture falling behind — {:.0}% hold frames, {:.1}/{target_fps} unique GPU/s (WGC may be throttling; playback may stutter)",
            hold_pct, gpu_fps
        ));
    }
    crate::capture::recording_pipeline_health_check(
        state,
        elapsed,
        wgc_5s,
        hold_pct,
        target_fps,
    );
}

/// Per-recording counter so we log (at most) a few stray-frame skips without spam.
static STRAY_FRAME_LOGS: AtomicU64 = AtomicU64::new(0);

/// Writes a frame to FFmpeg, returning `Ok(true)` if it was written.
fn write_bgra_frame(
    stdin: &mut impl Write,
    bgra: &[u8],
    width: u32,
    height: u32,
) -> Result<bool, String> {
    let expected = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    if bgra.len() != expected {
        if STRAY_FRAME_LOGS.fetch_add(1, Ordering::Relaxed) < 3 {
            capture_log(&format!(
                "skipped stray frame: got {} bytes, expected {} for {}x{}",
                bgra.len(),
                expected,
                width,
                height
            ));
        }
        return Ok(false);
    }
    stdin
        .write_all(bgra)
        .map_err(|e| format!("write frame to FFmpeg: {e}"))?;
    Ok(true)
}

fn write_arc_frame(
    stdin: &mut impl Write,
    bgra: &Arc<Vec<u8>>,
    width: u32,
    height: u32,
) -> Result<bool, String> {
    write_bgra_frame(stdin, bgra.as_slice(), width, height)
}

#[cfg(windows)]
fn write_recording_frame(
    stdin: &mut impl Write,
    frame: &RecFrame,
    width: u32,
    height: u32,
    cinematic: bool,
    scratch: &mut Vec<u8>,
) -> Result<bool, String> {
    if !cinematic || frame.cursor_pre_stamped {
        let Some(pixels) = frame.pixels.as_ref() else {
            return Ok(false);
        };
        return write_arc_frame(stdin, pixels, width, height);
    }
    let Some(pixels) = frame.pixels.as_ref() else {
        return Ok(false);
    };
    // Cursor must use the same session time as this frame's baked viewport + desktop crop.
    // Hold frames reuse the same `RecFrame`, so the pointer stays locked to the crop.
    crate::cursor::stamp_into_buffer(
        scratch,
        pixels.as_slice(),
        width,
        height,
        &frame.viewport,
        frame.src_w,
        frame.src_h,
        frame.t_secs,
    );
    write_bgra_frame(stdin, scratch, width, height)
}

#[cfg(not(windows))]
fn write_recording_frame(
    stdin: &mut impl Write,
    frame: &RecFrame,
    width: u32,
    height: u32,
    _cinematic: bool,
    _scratch: &mut Vec<u8>,
) -> Result<bool, String> {
    let Some(pixels) = frame.pixels.as_ref() else {
        return Ok(false);
    };
    write_arc_frame(stdin, pixels, width, height)
}

fn slot_scheduler_loop(
    sender: Arc<parking_lot::Mutex<Option<SyncSender<Arc<RecFrame>>>>>,
    session_start: Instant,
    fps_f: f64,
    recording_done: Arc<AtomicBool>,
    slot_done: Arc<AtomicBool>,
) {
    let mut pushed = 0u64;
    let mut last: Option<Arc<RecFrame>> = None;

    let mut push_one = |pushed: &mut u64| -> bool {
        let frame = peek_capture_frame().or_else(|| last.clone());
        let Some(arc) = frame else {
            return false;
        };
        let slot_t_secs = *pushed as f64 / fps_f;
        let scheduled = frame_for_cfr_slot(&arc, slot_t_secs);
        loop {
            let send_result = {
                let guard = sender.lock();
                let Some(tx) = guard.as_ref() else {
                    return true;
                };
                tx.try_send(scheduled.clone())
            };
            match send_result {
                Ok(()) => {
                    crate::capture::recording_encoder_queue_note_sent();
                    last = Some(arc);
                    *pushed += 1;
                    return false;
                }
                Err(TrySendError::Disconnected(_)) => return true,
                Err(TrySendError::Full(_)) => {
                    if recording_done.load(Ordering::Acquire) {
                        // Encoder stopped receiving — don't block shutdown on a full queue.
                        return true;
                    }
                    std::thread::sleep(Duration::from_micros(200));
                }
            }
        }
    };

    while !recording_done.load(Ordering::Acquire) {
        let elapsed = session_start.elapsed().as_secs_f64();
        let due = (elapsed * fps_f).floor() as u64;
        if pushed >= due {
            std::thread::sleep(Duration::from_micros(500));
            continue;
        }

        let slot_deadline =
            session_start + Duration::from_secs_f64((pushed + 1) as f64 / fps_f);
        wait_until_slot(slot_deadline);

        if recording_done.load(Ordering::Acquire) {
            break;
        }

        if push_one(&mut pushed) {
            slot_done.store(true, Ordering::Release);
            return;
        }
    }

    let final_due = (session_start.elapsed().as_secs_f64() * fps_f).floor() as u64;
    while pushed < final_due {
        if push_one(&mut pushed) {
            break;
        }
    }
    slot_done.store(true, Ordering::Release);
}

#[cfg(windows)]
fn write_hw_frame(encoder: &mut HwEncoder, frame: &RecFrame) -> Result<bool, String> {
    let Some(surface) = frame.surface.as_ref() else {
        if STRAY_FRAME_LOGS.fetch_add(1, Ordering::Relaxed) < 3 {
            capture_log("skipped stray frame: missing GPU surface for MF encoder");
        }
        return Ok(false);
    };
    encoder.send_surface(SendDirectX::new(surface.0.0.clone()), frame.t_secs)?;
    Ok(true)
}

#[cfg(windows)]
fn run_hw_body(
    mut encoder: HwEncoder,
    path: PathBuf,
    stop_rx: Receiver<()>,
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
    state: SharedState,
    has_audio: bool,
    session_target: Arc<AtomicU64>,
    session_tx: Option<SyncSender<Instant>>,
    audio_stop: Option<Arc<std::sync::atomic::AtomicBool>>,
) -> Result<(u64, f64), String> {
    boost_recording_thread_priority();
    crate::capture::recording_encoder_queue_reset();

    let fps_f = fps.max(1) as f64;
    let mut written = 0u64;
    let mut hold_frames = 0u64;
    let mut stop_session_secs: Option<f64> = None;

    clear_capture_frame();

    let first_frame_deadline = Instant::now() + Duration::from_secs(12);
    let mut waited_for_first = false;
    while peek_capture_frame().is_none() {
        if stop_rx.try_recv().is_ok() {
            let _ = std::fs::remove_file(&path);
            HW_ENCODE_ACTIVE.store(false, Ordering::Release);
            return Ok((0, 0.0));
        }
        if Instant::now() >= first_frame_deadline {
            capture_log("WARN: no capture frame after 12s — starting clock without first-frame anchor");
            break;
        }
        waited_for_first = true;
        std::thread::sleep(Duration::from_millis(2));
    }

    let session_start = Instant::now();
    arm_recording_session_clock(session_start);
    if waited_for_first {
        capture_log("Recording clock anchored to first captured frame");
    }
    {
        let mut st = state.lock();
        st.session_start = Some(session_start);
        st.current_start = Some(session_start);
        crate::cursor::sync_follow_gate_from_state(&st);
        crate::click_audio::sync_click_gate_from_state(&st);
    }
    let click_volume = {
        let st = state.lock();
        st.recording_settings.mouse_click_volume as f32
    };
    crate::click_audio::reset_session(click_volume);
    if has_audio {
        if let Some(tx) = session_tx {
            let _ = tx.send(session_start);
        }
    }

    let cinematic = {
        let st = state.lock();
        st.recording_settings.use_cinematic_cursor()
    };
    crate::cursor::reset_session();
    if cinematic {
        capture_log("Cinematic cursor: GPU composited on D3D11 output");
    }

    let (frame_tx, frame_rx) =
        mpsc::sync_channel::<Arc<RecFrame>>(encoder_queue_capacity(fps, width, height));
    let frame_sender = Arc::new(parking_lot::Mutex::new(Some(frame_tx)));
    capture_log(&format!(
        "MF encoder frame queue capacity: {} ({}x{} @ {}fps CFR)",
        encoder_queue_capacity(fps, width, height),
        width,
        height,
        fps
    ));
    let recording_done = Arc::new(AtomicBool::new(false));
    let recording_done_slot = recording_done.clone();
    let slot_done = Arc::new(AtomicBool::new(false));
    let slot_done_t = slot_done.clone();

    let slot_thread = std::thread::Builder::new()
        .name("rec-slot-sched".into())
        .spawn({
            let frame_sender = frame_sender.clone();
            move || {
                slot_scheduler_loop(
                    frame_sender,
                    session_start,
                    fps_f,
                    recording_done_slot,
                    slot_done_t,
                );
            }
        })
        .map_err(|e| format!("spawn slot scheduler: {e}"))?;

    let mut last_stats = Instant::now();
    let stop_session_audio = |secs: f64| {
        if has_audio {
            session_target.store(
                (secs * audio::SAMPLE_RATE as f64).round() as u64,
                Ordering::Release,
            );
            if let Some(stop) = &audio_stop {
                stop.store(true, Ordering::Release);
            }
        }
    };

    let mut last_frame: Option<Arc<RecFrame>> = None;
    let mut stopping = false;

    loop {
        if !stopping && stop_rx.try_recv().is_ok() {
            stopping = true;
            stop_session_secs = Some(session_start.elapsed().as_secs_f64());
            recording_done.store(true, Ordering::Release);
            stop_session_audio(stop_session_secs.unwrap_or(0.0));
            if let Some(secs) = stop_session_secs {
                let target_frames = (secs * fps_f).floor() as u64;
                let debt_frames = target_frames.saturating_sub(written);
                if debt_frames > fps as u64 {
                    capture_log(&format!(
                        "WARN: encoder {:.1}s behind wall-clock CFR at stop ({written}/{target_frames} frames) — motion may look sped up until drain completes",
                        debt_frames as f64 / fps_f
                    ));
                }
            }
            capture_log(&format!(
                "Recording stop @ {:.2}s ({} frames encoded, draining CFR queue)",
                stop_session_secs.unwrap_or(0.0),
                written
            ));
        }

        let frame_result = if stopping && slot_done.load(Ordering::Acquire) {
            frame_rx.try_recv().map_err(|_| RecvTimeoutError::Timeout)
        } else {
            frame_rx.recv_timeout(Duration::from_millis(50))
        };

        match frame_result {
            Ok(frame) => {
                let is_hold = last_frame
                    .as_ref()
                    .is_some_and(|prev| rec_frame_is_hold(prev.as_ref(), frame.as_ref()));
                if !write_hw_frame(&mut encoder, frame.as_ref())? {
                    continue;
                }
                crate::capture::recording_encoder_queue_note_consumed();
                if is_hold {
                    hold_frames += 1;
                }
                last_frame = Some(frame);
                written += 1;

                if last_stats.elapsed() >= Duration::from_secs(5) {
                    let elapsed = session_start.elapsed().as_secs_f64();
                    let gpu_total = recording_gpu_publish_count();
                    let gpu_fps = gpu_total as f64 / elapsed.max(0.1);
                    let hold_pct = if written > 0 {
                        hold_frames as f64 / written as f64 * 100.0
                    } else {
                        0.0
                    };
                    let (wgc_5s, cap_renders_5s, glide_5s, avg_render_us, avg_read_us, avg_handler_us) =
                        crate::capture::recording_pipeline_window_stats();
                    let enc_backlog = crate::capture::recording_encoder_queue_depth();
                    log_rec_live_stats(
                        state.clone(),
                        elapsed,
                        written,
                        hold_frames,
                        hold_pct,
                        gpu_fps,
                        fps,
                        wgc_5s,
                        cap_renders_5s,
                        glide_5s,
                        avg_render_us,
                        avg_read_us,
                        avg_handler_us,
                        enc_backlog,
                        "MF-encoded",
                    );
                    last_stats = Instant::now();
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if stopping && slot_done.load(Ordering::Acquire) {
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                stop_session_secs = Some(session_start.elapsed().as_secs_f64());
                stop_session_audio(stop_session_secs.unwrap_or(0.0));
                break;
            }
        }
    }

    let _ = slot_thread.join();
    frame_sender.lock().take();
    save_progress::report(16, "finalizing");

    let target_frames = stop_session_secs
        .map(|secs| (secs * fps_f).floor() as u64)
        .unwrap_or(written.max(1));

    while let Ok(frame) = frame_rx.try_recv() {
        let is_hold = last_frame
            .as_ref()
            .is_some_and(|prev| rec_frame_is_hold(prev.as_ref(), frame.as_ref()));
        if !write_hw_frame(&mut encoder, frame.as_ref())? {
            continue;
        }
        crate::capture::recording_encoder_queue_note_consumed();
        if is_hold {
            hold_frames += 1;
        }
        last_frame = Some(frame);
        written += 1;
    }

    if let (Some(secs), Some(last)) = (stop_session_secs, last_frame.clone()) {
        let target = (secs * fps_f).floor() as u64;
        let mut padded = 0u64;
        while written < target {
            let slot_t = written as f64 / fps_f;
            let slot_frame = frame_for_cfr_slot(&last, slot_t);
            if !write_hw_frame(&mut encoder, slot_frame.as_ref())? {
                break;
            }
            hold_frames += 1;
            written += 1;
            padded += 1;
        }
        if padded > 0 {
            capture_log(&format!(
                "CFR tail padded {padded} hold frames ({written}/{target})"
            ));
        }
    }

    save_progress::report(20, "finalizing");
    let gpu_samples = recording_gpu_publish_count();

    if let Some(secs) = stop_session_secs {
        let target_frames = (secs * fps_f).floor() as u64;
        let pad = target_frames.saturating_sub(written);
        if pad > 0 {
            capture_log(&format!(
                "WARN: recording ended {pad} frames short of target ({written}/{target_frames})"
            ));
        }
        if hold_frames > 0 {
            let hold_pct = hold_frames as f64 / written as f64 * 100.0;
            capture_log(&format!(
                "Recording CFR: {hold_frames} hold frames ({hold_pct:.0}%, {gpu_samples} GPU samples, {written} total @ {fps}fps)"
            ));
        }
    }

    let encoded_secs = written as f64 / fps_f;
    let session_secs = stop_session_secs.unwrap_or(encoded_secs);

    save_progress::report(22, "finalizing");
    encoder.finish().map_err(|e| {
        let _ = std::fs::remove_file(&path);
        e
    })?;
    HW_ENCODE_ACTIVE.store(false, Ordering::Release);
    save_progress::report(38, "finalizing");

    if session_secs > encoded_secs + 0.5 && encoded_secs >= 0.5 {
        let factor = session_secs / encoded_secs;
        if factor > 1.02 {
            capture_log(&format!(
                "WARN: timing stretch needed ({encoded_secs:.2}s → {session_secs:.2}s ×{factor:.3})"
            ));
            save_progress::report(42, "timing");
            if let Err(e) =
                stretch_playback_duration(&path, fps, factor, written, encoded_secs)
            {
                capture_log(&format!("WARN: timing stretch failed ({e}); keeping {encoded_secs:.2}s"));
            } else {
                save_progress::report(48, "timing");
            }
        }
    }

    let duration = if session_secs > encoded_secs + 0.5 && (session_secs / encoded_secs) > 1.02 {
        session_secs
    } else {
        encoded_secs
    };
    let wall = session_start.elapsed().as_secs_f64();
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    capture_log(&format!(
        "MF GPU recorder finished ({written} frames, {gpu_samples} GPU samples, {duration:.2}s playback / {encoded_secs:.2}s encoded / {wall:.2}s wall, {bytes} bytes)"
    ));
    Ok((written, duration))
}

fn run(
    path: PathBuf,
    stop_rx: Receiver<()>,
    ready_tx: mpsc::SyncSender<Result<(), String>>,
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
    state: SharedState,
    has_audio: bool,
    _pcm_path: PathBuf,
    session_target: Arc<AtomicU64>,
    #[cfg(windows)] session_tx: Option<SyncSender<Instant>>,
    #[cfg(windows)] audio_stop: Option<Arc<std::sync::atomic::AtomicBool>>,
) -> Result<(u64, f64), String> {
    #[cfg(windows)]
    {
        let try_hw = {
            let st = state.lock();
            prefer_hw_encode()
                && !st.streaming
                && st.promo_mode.is_none()
                && !st.recording_settings.use_cinematic_cursor()
        };
        if try_hw {
            HW_ENCODE_ACTIVE.store(true, Ordering::Release);
            match HwEncoder::start(&path, width, height, fps, bitrate_kbps) {
                Ok(encoder) => {
                    if ready_tx.send(Ok(())).is_err() {
                        HW_ENCODE_ACTIVE.store(false, Ordering::Release);
                        return Err("recorder cancelled before MF encoder started".into());
                    }
                    return run_hw_body(
                        encoder,
                        path,
                        stop_rx,
                        width,
                        height,
                        fps,
                        bitrate_kbps,
                        state,
                        has_audio,
                        session_target,
                        session_tx,
                        audio_stop,
                    );
                }
                Err(e) => {
                    HW_ENCODE_ACTIVE.store(false, Ordering::Release);
                    capture_log(&format!(
                        "WARN: MF GPU encode unavailable ({e}); falling back to FFmpeg pipe"
                    ));
                    clear_capture_frame();
                }
            }
        }
    }

    boost_recording_thread_priority();
    crate::capture::recording_encoder_queue_reset();

    let mut child = match spawn_ffmpeg(&path, width, height, fps, bitrate_kbps) {
        Ok(child) => child,
        Err(e) => {
            let _ = ready_tx.send(Err(e.clone()));
            return Err(e);
        }
    };
    if ready_tx.send(Ok(())).is_err() {
        return Err("recorder cancelled before FFmpeg started".into());
    }
    let Some(mut stdin) = child.stdin.take() else {
        return Err("FFmpeg stdin unavailable".into());
    };

    let fps_f = fps.max(1) as f64;
    let mut written = 0u64;
    let mut hold_frames = 0u64;
    let mut stop_session_secs: Option<f64> = None;
    let mut stamp_scratch: Vec<u8> =
        Vec::with_capacity((width as usize).saturating_mul(height as usize).saturating_mul(4));

    // Drop any frame left over from a previous recording so a stale wrong-size
    // frame (after a resolution switch) can never prime this recording.
    clear_capture_frame();

    // Anchor t=0 to the FIRST real captured frame, not to thread start. On
    // slower machines the GPU scaler init + first WGC frame can take several
    // seconds; if we started the clock (and released audio) here, video would
    // freeze on its first frame for that gap while audio ran ahead — producing
    // the "audio 5–10s ahead of video" desync. Waiting here keeps A/V aligned.
    let first_frame_deadline = Instant::now() + Duration::from_secs(12);
    let mut waited_for_first = false;
    while peek_capture_frame().is_none() {
        if stop_rx.try_recv().is_ok() {
            // Stopped before any frame arrived — nothing was recorded.
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&path);
            return Ok((0, 0.0));
        }
        if Instant::now() >= first_frame_deadline {
            capture_log("WARN: no capture frame after 12s — starting clock without first-frame anchor");
            break;
        }
        waited_for_first = true;
        std::thread::sleep(Duration::from_millis(2));
    }

    let session_start = Instant::now();
    arm_recording_session_clock(session_start);
    if waited_for_first {
        capture_log("Recording clock anchored to first captured frame");
    }
    {
        let mut st = state.lock();
        st.session_start = Some(session_start);
        st.current_start = Some(session_start);
        crate::cursor::sync_follow_gate_from_state(&st);
        crate::click_audio::sync_click_gate_from_state(&st);
    }
    let click_volume = {
        let st = state.lock();
        st.recording_settings.mouse_click_volume as f32
    };
    crate::click_audio::reset_session(click_volume);
    if has_audio {
        #[cfg(windows)]
        if let Some(tx) = session_tx {
            let _ = tx.send(session_start);
        }
    }

    let cinematic = {
        let st = state.lock();
        st.recording_settings.use_cinematic_cursor()
    };
    crate::cursor::reset_session();
    if cinematic {
        capture_log("Cinematic cursor session started (per-slot stamp on CFR timeline)");
    }

    let (frame_tx, frame_rx) =
        mpsc::sync_channel::<Arc<RecFrame>>(encoder_queue_capacity(fps, width, height));
    let frame_sender = Arc::new(parking_lot::Mutex::new(Some(frame_tx)));
    capture_log(&format!(
        "Encoder frame queue capacity: {} ({}x{} @ {}fps CFR)",
        encoder_queue_capacity(fps, width, height),
        width,
        height,
        fps
    ));
    let recording_done = Arc::new(AtomicBool::new(false));
    let recording_done_slot = recording_done.clone();
    let slot_done = Arc::new(AtomicBool::new(false));
    let slot_done_t = slot_done.clone();

    let slot_thread = std::thread::Builder::new()
        .name("rec-slot-sched".into())
        .spawn({
            let frame_sender = frame_sender.clone();
            move || {
                slot_scheduler_loop(
                    frame_sender,
                    session_start,
                    fps_f,
                    recording_done_slot,
                    slot_done_t,
                );
            }
        })
        .map_err(|e| format!("spawn slot scheduler: {e}"))?;

    let mut last_stats = Instant::now();

    #[cfg(windows)]
    let stop_session_audio = |secs: f64| {
        if has_audio {
            session_target.store(
                (secs * audio::SAMPLE_RATE as f64).round() as u64,
                Ordering::Release,
            );
            if let Some(stop) = &audio_stop {
                stop.store(true, Ordering::Release);
            }
        }
    };
    #[cfg(not(windows))]
    let stop_session_audio = |_secs: f64| {};

    let mut last_frame: Option<Arc<RecFrame>> = None;
    let mut stopping = false;

    loop {
        if !stopping && stop_rx.try_recv().is_ok() {
            stopping = true;
            stop_session_secs = Some(session_start.elapsed().as_secs_f64());
            recording_done.store(true, Ordering::Release);
            stop_session_audio(stop_session_secs.unwrap_or(0.0));
            if let Some(secs) = stop_session_secs {
                let target_frames = (secs * fps_f).floor() as u64;
                let debt_frames = target_frames.saturating_sub(written);
                if debt_frames > fps as u64 {
                    capture_log(&format!(
                        "WARN: encoder {:.1}s behind wall-clock CFR at stop ({written}/{target_frames} frames) — draining queued slots before save",
                        debt_frames as f64 / fps_f
                    ));
                }
            }
            capture_log(&format!(
                "Recording stop @ {:.2}s ({} frames encoded, draining CFR queue)",
                stop_session_secs.unwrap_or(0.0),
                written
            ));
        }

        let frame_result = if stopping && slot_done.load(Ordering::Acquire) {
            frame_rx.try_recv().map_err(|_| RecvTimeoutError::Timeout)
        } else {
            frame_rx.recv_timeout(Duration::from_millis(50))
        };

        match frame_result {
            Ok(frame) => {
                let is_hold = last_frame
                    .as_ref()
                    .is_some_and(|prev| rec_frame_is_hold(prev.as_ref(), frame.as_ref()));
                if !write_recording_frame(
                    &mut stdin,
                    frame.as_ref(),
                    width,
                    height,
                    cinematic,
                    &mut stamp_scratch,
                )? {
                    continue;
                }
                crate::capture::recording_encoder_queue_note_consumed();
                if is_hold {
                    hold_frames += 1;
                }
                last_frame = Some(frame);
                written += 1;

                if last_stats.elapsed() >= Duration::from_secs(5) {
                    let elapsed = session_start.elapsed().as_secs_f64();
                    let gpu_total = recording_gpu_publish_count();
                    let gpu_fps = gpu_total as f64 / elapsed.max(0.1);
                    let hold_pct = if written > 0 {
                        hold_frames as f64 / written as f64 * 100.0
                    } else {
                        0.0
                    };
                    let (wgc_5s, cap_renders_5s, glide_5s, avg_render_us, avg_read_us, avg_handler_us) =
                        crate::capture::recording_pipeline_window_stats();
                    let enc_backlog = crate::capture::recording_encoder_queue_depth();
                    log_rec_live_stats(
                        state.clone(),
                        elapsed,
                        written,
                        hold_frames,
                        hold_pct,
                        gpu_fps,
                        fps,
                        wgc_5s,
                        cap_renders_5s,
                        glide_5s,
                        avg_render_us,
                        avg_read_us,
                        avg_handler_us,
                        enc_backlog,
                        "encoded",
                    );
                    last_stats = Instant::now();
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if stopping && slot_done.load(Ordering::Acquire) {
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => {
                stop_session_secs = Some(session_start.elapsed().as_secs_f64());
                stop_session_audio(stop_session_secs.unwrap_or(0.0));
                break;
            }
        }
    }

    let _ = slot_thread.join();
    frame_sender.lock().take();
    save_progress::report(16, "finalizing");

    let target_frames = stop_session_secs
        .map(|secs| (secs * fps_f).floor() as u64)
        .unwrap_or(written.max(1));

    while let Ok(frame) = frame_rx.try_recv() {
        let is_hold = last_frame
            .as_ref()
            .is_some_and(|prev| rec_frame_is_hold(prev.as_ref(), frame.as_ref()));
        if !write_recording_frame(
            &mut stdin,
            frame.as_ref(),
            width,
            height,
            cinematic,
            &mut stamp_scratch,
        )? {
            continue;
        }
        crate::capture::recording_encoder_queue_note_consumed();
        if is_hold {
            hold_frames += 1;
        }
        last_frame = Some(frame);
        written += 1;
        if target_frames > 0 && written % 500 == 0 {
            let pct = 12 + ((written.min(target_frames) as f64 / target_frames as f64) * 8.0) as u8;
            save_progress::report(pct.min(20), "finalizing");
        }
    }

    // Pad CFR tail with the last frame so wall-clock duration matches without a stretch remux.
    if let (Some(secs), Some(last)) = (stop_session_secs, last_frame.clone()) {
        let target = (secs * fps_f).floor() as u64;
        let mut padded = 0u64;
        while written < target {
            let slot_t = written as f64 / fps_f;
            let slot_frame = frame_for_cfr_slot(&last, slot_t);
            if !write_recording_frame(
                &mut stdin,
                slot_frame.as_ref(),
                width,
                height,
                cinematic,
                &mut stamp_scratch,
            )? {
                break;
            }
            hold_frames += 1;
            written += 1;
            padded += 1;
        }
        if padded > 0 {
            capture_log(&format!(
                "CFR tail padded {padded} hold frames ({written}/{target})"
            ));
        }
    }

    save_progress::report(20, "finalizing");

    let gpu_samples = recording_gpu_publish_count();

    if let Some(secs) = stop_session_secs {
        let target_frames = (secs * fps_f).floor() as u64;
        let pad = target_frames.saturating_sub(written);
        if pad > 0 {
            capture_log(&format!(
                "WARN: recording ended {pad} frames short of target ({written}/{target_frames})"
            ));
        }
        if hold_frames > 0 {
            let hold_pct = hold_frames as f64 / written as f64 * 100.0;
            capture_log(&format!(
                "Recording CFR: {hold_frames} hold frames ({hold_pct:.0}%, {gpu_samples} GPU samples, {written} total @ {fps}fps)"
            ));
        }
    }

    let encoded_secs = written as f64 / fps_f;
    let session_secs = stop_session_secs.unwrap_or(encoded_secs);

    drop(stdin);
    save_progress::report(22, "finalizing");

    let status = child
        .wait()
        .map_err(|e| format!("wait for FFmpeg: {e}"))?;
    save_progress::report(38, "finalizing");

    if !status.success() {
        let mut err = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            use std::io::Read;
            let _ = stderr.read_to_string(&mut err);
        }
        let _ = std::fs::remove_file(&path);
        return Err(if err.is_empty() {
            format!("FFmpeg exited with {status}")
        } else {
            format!("FFmpeg failed: {}", err.trim())
        });
    }

    if session_secs > encoded_secs + 0.5 && encoded_secs >= 0.5 {
        let factor = session_secs / encoded_secs;
        if factor > 1.02 {
            capture_log(&format!(
                "WARN: timing stretch needed ({encoded_secs:.2}s → {session_secs:.2}s ×{factor:.3})"
            ));
            save_progress::report(42, "timing");
            if let Err(e) =
                stretch_playback_duration(&path, fps, factor, written, encoded_secs)
            {
                capture_log(&format!("WARN: timing stretch failed ({e}); keeping {encoded_secs:.2}s"));
            } else {
                save_progress::report(48, "timing");
            }
        } else {
            capture_log(&format!(
                "Timing gap {encoded_secs:.2}s vs {session_secs:.2}s within 2% — skipping stretch remux"
            ));
        }
    }

    let duration = if session_secs > encoded_secs + 0.5 && (session_secs / encoded_secs) > 1.02 {
        session_secs
    } else {
        encoded_secs
    };
    let wall = session_start.elapsed().as_secs_f64();
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    capture_log(&format!(
        "FFmpeg recorder finished ({written} frames, {gpu_samples} GPU samples, {duration:.2}s playback / {encoded_secs:.2}s encoded / {wall:.2}s wall, {bytes} bytes)"
    ));
    Ok((written, duration))
}

/// Re-time video only so wall-clock session length matches real-world motion speed.
/// Audio stays at real-time session length (no pitch/tempo change).
fn stretch_playback_duration(
    path: &Path,
    fps: u32,
    factor: f64,
    frame_count: u64,
    encoded_secs: f64,
) -> Result<(), String> {
    if factor <= 1.01 {
        return Ok(());
    }
    let ffmpeg = find_ffmpeg()?;
    let temp = path.with_extension("timing.tmp.mp4");
    let factor_s = format!("{factor:.6}");
    let fps_s = fps.max(1).to_string();
    let enc = CACHED_ENCODER
        .get()
        .cloned()
        .unwrap_or_else(|| "libx264".to_string());

    // Small gaps: clone-pad the tail (faster than a full setpts+fps remux).
    let vf = if factor <= 1.08 {
        let pad_secs = (encoded_secs * factor - encoded_secs).max(0.0);
        format!("tpad=stop_mode=clone:stop_duration={pad_secs:.3}")
    } else {
        format!(
            "trim=end_frame={frame_count},setpts=PTS-STARTPTS*{factor_s},fps={fps_s}:round=near"
        )
    };

    let mut cmd = ffmpeg_command(&ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "warning", "-y", "-i"]).arg(path);
    cmd.args(["-vf", &vf, "-an", "-c:v", &enc]);
    match enc.as_str() {
        "libx264" => {
            cmd.args(["-preset", "ultrafast", "-crf", "18"]);
        }
        "h264_amf" => {
            cmd.args(["-quality", "speed", "-b:v", "12M", "-maxrate", "12M", "-bufsize", "24M"]);
        }
        _ => {
            cmd.args(["-preset", "veryfast", "-b:v", "12M", "-maxrate", "12M", "-bufsize", "24M"]);
        }
    }
    cmd.args([
        "-fps_mode",
        "cfr",
        "-r",
        &fps_s,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-t",
        &format!("{:.3}", encoded_secs * factor),
    ]);
    cmd.arg(&temp).stdout(Stdio::null()).stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| format!("failed to run stretch ffmpeg: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(&temp);
        return Err(format!("stretch remux failed: {err}"));
    }
    std::fs::rename(&temp, path).map_err(|e| format!("replace recording after stretch: {e}"))?;
    Ok(())
}

#[cfg(windows)]
fn has_audio_sidecar(pcm_path: &Path) -> bool {
    std::fs::metadata(pcm_path)
        .map(|m| m.len() > audio::BYTES_PER_FRAME as u64)
        .unwrap_or(false)
}

#[cfg(windows)]
fn mux_pcm_audio(video_path: &Path, pcm_path: &Path, duration_secs: f64) -> Result<(), String> {
    let ffmpeg = find_ffmpeg()?;
    let temp = video_path.with_extension("mux.tmp.mp4");
    let rate = audio::SAMPLE_RATE.to_string();

    // The PCM was captured at the audio device's clock, which drifts slightly
    // from the CPU/wall clock that drives the video. Compute how long the audio
    // really is and, if it diverges from the video timeline, time-scale it with
    // a pitch-preserving tempo filter so A/V stays locked from start to finish.
    let pcm_bytes = std::fs::metadata(pcm_path).map(|m| m.len()).unwrap_or(0);
    let audio_secs = if pcm_bytes > 0 {
        (pcm_bytes / audio::BYTES_PER_FRAME as u64) as f64 / audio::SAMPLE_RATE as f64
    } else {
        0.0
    };
    let tempo = if duration_secs > 0.25 && audio_secs > 0.25 {
        let ratio = audio_secs / duration_secs;
        if (ratio - 1.0).abs() <= 0.001 {
            // Already locked — nothing to do.
            None
        } else if (0.5..=2.0).contains(&ratio) {
            // atempo's single-instance range is [0.5, 2.0]. Always correct within
            // it so we never ship grossly desynced audio. A large value here means
            // the capture rate was wrong (e.g. a device whose native rate isn't
            // 48 kHz) — log loudly so it's obvious in bug reports.
            if (ratio - 1.0).abs() > 0.05 {
                capture_log(&format!(
                    "WARN: large audio/video divergence ({audio_secs:.2}s vs {duration_secs:.2}s) — correcting tempo {ratio:.5} (check capture sample rate)"
                ));
            } else {
                capture_log(&format!(
                    "Audio drift correction: {audio_secs:.3}s captured → {duration_secs:.3}s video (atempo {ratio:.5})"
                ));
            }
            Some(ratio)
        } else {
            capture_log(&format!(
                "WARN: audio/video divergence beyond atempo range ({audio_secs:.2}s vs {duration_secs:.2}s) — muxing without tempo correction"
            ));
            None
        }
    } else {
        None
    };

    let mut cmd = ffmpeg_command(&ffmpeg);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "warning",
        "-y",
        "-i",
    ])
    .arg(video_path)
    .args([
        "-f",
        "s16le",
        "-ar",
        &rate,
        "-ac",
        "2",
        "-i",
    ])
    .arg(pcm_path)
    .args([
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
    ]);
    if let Some(ratio) = tempo {
        cmd.args(["-filter:a", &format!("atempo={ratio:.6}")]);
    }
    if duration_secs > 0.1 {
        cmd.args(["-t", &format!("{duration_secs:.3}")]);
    }
    cmd.arg(&temp).stdout(Stdio::null()).stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| format!("failed to run mux ffmpeg: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(&temp);
        return Err(format!("audio mux failed: {err}"));
    }
    std::fs::rename(&temp, video_path).map_err(|e| format!("replace recording after mux: {e}"))?;
    capture_log(&format!(
        "Audio muxed from sidecar PCM ({duration_secs:.2}s)"
    ));
    Ok(())
}

fn spawn_ffmpeg(
    path: &Path,
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
) -> Result<Child, String> {
    let ffmpeg = find_ffmpeg()?;
    let preferred = CACHED_ENCODER
        .get()
        .cloned()
        .unwrap_or_else(|| select_encoder());
    let enc = resolve_encoder_for_recording(&ffmpeg, &preferred, width, height, fps);
    match spawn_ffmpeg_with_encoder(&ffmpeg, &enc, path, width, height, fps, bitrate_kbps) {
        Ok(child) => Ok(child),
        Err(e) if enc != "libx264" => {
            capture_log(&format!(
                "WARN: FFmpeg failed to start with {enc} ({e}); retrying libx264"
            ));
            spawn_ffmpeg_with_encoder(&ffmpeg, "libx264", path, width, height, fps, bitrate_kbps)
        }
        Err(e) => Err(e),
    }
}

fn encoder_queue_capacity(fps: u32, width: u32, height: u32) -> usize {
    // Buffer enough CFR slots for a full session so the wall-clock scheduler never
    // falls behind the encoder (which would compress motion and speed up playback).
    let fps_u = normalize_recording_fps(fps) as usize;
    let session_slots = fps_u.saturating_mul(120);
    let load = crate::geometry::pixel_load(width, height, normalize_recording_fps(fps));
    let tier_floor = if load >= 3840 * 2160 * 55 {
        360
    } else if load >= 3840 * 2160 * 28 {
        480
    } else if load >= 2560 * 1440 * 55 {
        600
    } else if normalize_recording_fps(fps) >= 60 {
        480
    } else {
        240
    };
    session_slots.max(tier_floor)
}

/// Probe at the target CFR — hardware encoders must sustain 60fps at recording sizes.
fn encoder_probe_fps() -> u32 {
    60
}

fn encoder_probe_sizes() -> [(u32, u32); 6] {
    [
        (1280, 720),
        (720, 1280),
        (1920, 1080),
        (1080, 1920),
        (2560, 1440),
        (3840, 2160),
    ]
}

fn select_encoder() -> String {
    let ffmpeg = match find_ffmpeg() {
        Ok(f) => f,
        Err(_) => return "libx264".to_string(),
    };
    for enc in ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"] {
        if test_encoder(&ffmpeg, enc) {
            return enc.to_string();
        }
        if enc != "libx264" {
            capture_log(&format!(
                "FFmpeg encoder probe skipped {enc} (not available at 60fps recording sizes)"
            ));
        }
    }
    "libx264".to_string()
}

fn test_encoder(ffmpeg: &str, enc: &str) -> bool {
    let fps = encoder_probe_fps();
    encoder_probe_sizes()
        .into_iter()
        .all(|(w, h)| test_encoder_at_size(ffmpeg, enc, w, h, fps))
}

fn test_encoder_at_size(ffmpeg: &str, enc: &str, width: u32, height: u32, fps: u32) -> bool {
    let size = format!("{width}x{height}");
    let fps_s = fps.max(1).to_string();
    let bytes = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    let black = vec![0u8; bytes];
    let mut child = match ffmpeg_command(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgra",
            "-s",
            &size,
            "-r",
            &fps_s,
            "-i",
            "pipe:0",
            "-frames:v",
            "1",
            "-c:v",
            enc,
            "-pix_fmt",
            "yuv420p",
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    if child.stdin.take().and_then(|mut s| s.write_all(&black).ok()).is_none() {
        let _ = child.kill();
        return false;
    }
    match child.wait_with_output() {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

fn resolve_encoder_for_recording(
    ffmpeg: &str,
    preferred: &str,
    width: u32,
    height: u32,
    fps: u32,
) -> String {
    if preferred == "libx264" {
        return preferred.to_string();
    }
    if test_encoder_at_size(ffmpeg, preferred, width, height, fps) {
        return preferred.to_string();
    }
    capture_log(&format!(
        "WARN: {preferred} failed at {width}x{height} @ {fps}fps; falling back"
    ));
    for enc in ["h264_nvenc", "h264_amf", "h264_qsv"] {
        if enc == preferred {
            continue;
        }
        if test_encoder_at_size(ffmpeg, enc, width, height, fps) {
            capture_log(&format!("Using alternate hardware encoder: {enc}"));
            return enc.to_string();
        }
    }
    "libx264".to_string()
}

fn x264_preset(width: u32, height: u32, fps: u32) -> &'static str {
    let load = crate::geometry::pixel_load(width, height, fps);
    if load >= 3840 * 2160 * 55 || load >= 3840 * 2160 * 28 {
        "ultrafast"
    } else if load >= 2560 * 1440 * 55 {
        "ultrafast"
    } else if load >= 1920 * 1080 * 55 || fps >= 55 {
        "veryfast"
    } else {
        "fast"
    }
}

fn nvenc_preset(width: u32, height: u32, fps: u32) -> &'static str {
    let load = crate::geometry::pixel_load(width, height, fps);
    if load >= 3840 * 2160 * 55 {
        "p1"
    } else if load >= 3840 * 2160 * 28 || load >= 2560 * 1440 * 55 {
        "p2"
    } else if load >= 1920 * 1080 * 55 {
        "p3"
    } else {
        "p4"
    }
}

fn qsv_preset(width: u32, height: u32, fps: u32) -> &'static str {
    let load = crate::geometry::pixel_load(width, height, fps);
    if load >= 3840 * 2160 * 28 || load >= 2560 * 1440 * 55 || fps >= 55 {
        "veryfast"
    } else {
        "fast"
    }
}

fn x264_crf(width: u32, height: u32) -> &'static str {
    if width * height >= 3840 * 2160 {
        "20"
    } else if width * height >= 2560 * 1440 {
        "19"
    } else if width <= 720 {
        "20"
    } else {
        "18"
    }
}

fn spawn_ffmpeg_with_encoder(
    ffmpeg: &str,
    enc: &str,
    path: &Path,
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
) -> Result<Child, String> {
    let out = path.to_string_lossy();
    let size = format!("{width}x{height}");
    let fps_s = fps.max(1).to_string();
    let timescale = (fps.saturating_mul(1_000)).max(1_000).to_string();
    let bitrate = format!("{}k", bitrate_kbps.max(500));
    let bufsize = format!("{}k", bitrate_kbps.saturating_mul(2).max(1000));
    let gop = fps.saturating_mul(2).max(30).to_string();
    let crf = x264_crf(width, height);

    let mut cmd = ffmpeg_command(ffmpeg);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "warning",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgra",
        "-s",
        &size,
        "-framerate",
        &fps_s,
        "-i",
        "pipe:0",
    ]);

    cmd.args(["-c:v", enc]);

    match enc {
        "libx264" => {
            cmd.args([
                "-preset",
                x264_preset(width, height, fps),
                "-tune",
                "zerolatency",
                "-crf",
                crf,
                "-g",
                &gop,
                "-x264-params",
                "nal-hrd=cbr:force-cfr=1",
            ]);
        }
        "h264_amf" => {
            cmd.args([
                "-usage",
                "ultralowlatency",
                "-quality",
                "speed",
                "-b:v",
                &bitrate,
                "-maxrate",
                &bitrate,
                "-bufsize",
                &bufsize,
                "-g",
                &gop,
            ]);
        }
        "h264_nvenc" => {
            let mut nvenc_args = vec![
                "-preset",
                nvenc_preset(width, height, fps),
                "-tune",
                "ll",
                "-zerolatency",
                "1",
                "-b:v",
                &bitrate,
                "-maxrate",
                &bitrate,
                "-bufsize",
                &bufsize,
                "-g",
                &gop,
                "-bf",
                "0",
            ];
            if width * height >= 3840 * 2160 {
                nvenc_args.extend(["-spatial-aq", "0", "-temporal-aq", "0", "-rc-lookahead", "0"]);
            }
            cmd.args(nvenc_args);
        }
        _ => {
            cmd.args([
                "-preset",
                qsv_preset(width, height, fps),
                "-tune",
                "ll",
                "-b:v",
                &bitrate,
                "-maxrate",
                &bitrate,
                "-bufsize",
                &bufsize,
                "-g",
                &gop,
                "-bf",
                "0",
            ]);
        }
    }

    cmd.args([
        "-fps_mode",
        "cfr",
        "-r",
        &fps_s,
        "-video_track_timescale",
        &timescale,
        "-pix_fmt",
        "yuv420p",
    ]);
    cmd.args(["-an"]);
    cmd.args(["-movflags", "+faststart"]);
    cmd.arg(out.as_ref());
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());

    cmd.spawn()
        .map(|child| {
            capture_log(&format!("Recording with FFmpeg encoder: {enc}"));
            child
        })
        .map_err(|e| format!("failed to start FFmpeg ({enc}): {e}"))
}
