//! Local MP4 recording via FFmpeg raw BGRA ingest (bypasses Media Foundation).
//!
//! CFR is anchored to wall clock. A GPU thread refreshes the latest crop; a slot
//! scheduler enqueues one sample per 1/fps second on wall time; the encoder drains
//! that queue to FFmpeg (may block) without shifting timeline positions.

use crate::capture::{render_recording_frame};
use crate::ffmpeg_util::find_ffmpeg;
use crate::log::capture_log;
use crate::state::SharedState;
#[cfg(windows)]
use crate::audio::{self, RecordingAudio};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::sync::mpsc::{Receiver, SyncSender, RecvTimeoutError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use parking_lot::Mutex;

static CACHED_ENCODER: OnceLock<String> = OnceLock::new();

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
        let (frames, duration) = match worker.join() {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err("recorder thread panicked".into()),
        };
        #[cfg(windows)]
        if let Some(audio) = audio {
            if let Err(e) = audio.stop() {
                capture_log(&format!("WARN: audio stop: {e}"));
            }
        }
        #[cfg(windows)]
        {
            let pcm_path = path.with_extension("pcm");
            if has_audio_sidecar(&pcm_path) {
                if let Err(e) = mux_pcm_audio(&path, &pcm_path, duration) {
                    capture_log(&format!("WARN: audio mux failed ({e}"));
                }
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

fn wait_until_or_stop(deadline: Instant, stop_rx: &Receiver<()>) -> bool {
    loop {
        if stop_rx.try_recv().is_ok() {
            return true;
        }
        let now = Instant::now();
        if now >= deadline {
            return false;
        }
        let remaining = deadline - now;
        if remaining > Duration::from_millis(2) {
            std::thread::sleep(Duration::from_millis(1));
        } else {
            std::hint::spin_loop();
        }
    }
}

fn write_arc_frame(stdin: &mut impl Write, bgra: &Arc<Vec<u8>>) -> Result<(), String> {
    stdin
        .write_all(bgra.as_slice())
        .map_err(|e| format!("write frame to FFmpeg: {e}"))
}

struct GpuFeeder {
    latest: Arc<Mutex<Option<Arc<Vec<u8>>>>>,
    generation: Arc<AtomicU64>,
    renders: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

impl GpuFeeder {
    fn start(state: SharedState) -> Self {
        let latest = Arc::new(Mutex::new(None));
        let generation = Arc::new(AtomicU64::new(0));
        let renders = Arc::new(AtomicU64::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let latest_t = latest.clone();
        let generation_t = generation.clone();
        let renders_t = renders.clone();
        let stop_t = stop.clone();
        let thread = std::thread::Builder::new()
            .name("rec-gpu-feed".into())
            .spawn(move || {
                while !stop_t.load(Ordering::Relaxed) {
                    if let Some(b) = render_recording_frame(&state) {
                        *latest_t.lock() = Some(Arc::new(b));
                        generation_t.fetch_add(1, Ordering::Relaxed);
                        renders_t.fetch_add(1, Ordering::Relaxed);
                    }
                    std::thread::sleep(Duration::from_millis(1));
                }
            })
            .expect("spawn rec-gpu-feed");
        Self {
            latest,
            generation,
            renders,
            stop,
            thread,
        }
    }

    fn snapshot(&self) -> Option<Arc<Vec<u8>>> {
        self.latest.lock().clone()
    }

    fn stop(self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.thread.join();
    }
}

fn slot_scheduler_loop(
    tx: mpsc::Sender<Arc<Vec<u8>>>,
    session_start: Instant,
    fps_f: f64,
    latest: Arc<Mutex<Option<Arc<Vec<u8>>>>>,
    recording_done: Arc<AtomicBool>,
) {
    let mut pushed = 0u64;
    let mut last: Option<Arc<Vec<u8>>> = None;

    let mut push_one = |pushed: &mut u64| -> bool {
        let frame = latest.lock().clone().or_else(|| last.clone());
        let Some(arc) = frame else {
            return false;
        };
        if tx.send(arc.clone()).is_err() {
            return true;
        }
        last = Some(arc);
        *pushed += 1;
        false
    };

    while !recording_done.load(Ordering::Acquire) {
        let elapsed = session_start.elapsed().as_secs_f64();
        let due = (elapsed * fps_f).floor() as u64;
        if pushed >= due {
            std::thread::sleep(Duration::from_millis(1));
            continue;
        }

        let slot_deadline =
            session_start + Duration::from_secs_f64((pushed + 1) as f64 / fps_f);
        if Instant::now() < slot_deadline {
            std::thread::sleep(Duration::from_millis(1));
            continue;
        }

        if push_one(&mut pushed) {
            return;
        }
    }

    let final_due = (session_start.elapsed().as_secs_f64() * fps_f).floor() as u64;
    while pushed < final_due {
        if push_one(&mut pushed) {
            return;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
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

    let session_start = Instant::now();
    {
        let mut st = state.lock();
        st.session_start = Some(session_start);
        st.current_start = Some(session_start);
    }
    if has_audio {
        #[cfg(windows)]
        if let Some(tx) = session_tx {
            let _ = tx.send(session_start);
        }
    }

    let fps_f = fps.max(1) as f64;
    let mut written = 0u64;
    let mut hold_frames = 0u64;
    let mut last_arc: Option<Arc<Vec<u8>>> = None;
    let mut stop_session_secs: Option<f64> = None;

    let gpu_feed = GpuFeeder::start(state.clone());
    let gpu_renders = gpu_feed.renders.clone();
    let latest = gpu_feed.latest.clone();

    let (frame_tx, frame_rx) = mpsc::channel::<Arc<Vec<u8>>>();
    let recording_done = Arc::new(AtomicBool::new(false));
    let recording_done_slot = recording_done.clone();

    let slot_thread = std::thread::Builder::new()
        .name("rec-slot-sched".into())
        .spawn(move || {
            slot_scheduler_loop(
                frame_tx,
                session_start,
                fps_f,
                latest,
                recording_done_slot,
            );
        })
        .map_err(|e| format!("spawn slot scheduler: {e}"))?;

    loop {
        if stop_rx.try_recv().is_ok() {
            stop_session_secs = Some(session_start.elapsed().as_secs_f64());
            recording_done.store(true, Ordering::Release);
            capture_log(&format!(
                "Recording stop @ {:.2}s ({} frames encoded)",
                stop_session_secs.unwrap_or(0.0),
                written
            ));
            break;
        }

        match frame_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(arc) => {
                if last_arc
                    .as_ref()
                    .is_some_and(|prev| Arc::ptr_eq(prev, &arc))
                {
                    hold_frames += 1;
                }
                write_arc_frame(&mut stdin, &arc)?;
                last_arc = Some(arc);
                written += 1;
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => {
                stop_session_secs = Some(session_start.elapsed().as_secs_f64());
                break;
            }
        }
    }

    let _ = slot_thread.join();
    while let Ok(arc) = frame_rx.recv() {
        if last_arc
            .as_ref()
            .is_some_and(|prev| Arc::ptr_eq(prev, &arc))
        {
            hold_frames += 1;
        }
        write_arc_frame(&mut stdin, &arc)?;
        last_arc = Some(arc);
        written += 1;
    }

    gpu_feed.stop();
    let gpu_samples = gpu_renders.load(Ordering::Relaxed);

    if let Some(secs) = stop_session_secs {
        #[cfg(windows)]
        if has_audio {
            session_target.store(
                (secs * audio::SAMPLE_RATE as f64).round() as u64,
                Ordering::Release,
            );
            if let Some(stop) = &audio_stop {
                stop.store(true, Ordering::Release);
            }
        }

        let target_frames = (secs * fps_f).floor() as u64;
        let pad = target_frames.saturating_sub(written);
        if pad > 0 {
            capture_log(&format!(
                "WARN: recording ended {pad} frames short of target ({written}/{target_frames})"
            ));
        }
        if hold_frames > 0 {
            capture_log(&format!(
                "Recording CFR: {hold_frames} hold frames ({gpu_samples} GPU samples, {written} total @ {fps}fps)"
            ));
        }
    }

    let encoded_secs = written as f64 / fps_f;
    let session_secs = stop_session_secs.unwrap_or(encoded_secs);

    drop(stdin);

    let status = child
        .wait()
        .map_err(|e| format!("wait for FFmpeg: {e}"))?;

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

    if session_secs > encoded_secs + 0.15 && encoded_secs >= 0.5 {
        let factor = session_secs / encoded_secs;
        capture_log(&format!(
            "WARN: timing stretch needed ({encoded_secs:.2}s → {session_secs:.2}s ×{factor:.3})"
        ));
        if let Err(e) =
            stretch_playback_duration(&path, fps, factor, written, encoded_secs)
        {
            capture_log(&format!("WARN: timing stretch failed ({e}); keeping {encoded_secs:.2}s"));
        }
    }

    let duration = if session_secs > encoded_secs + 0.15 {
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
    if factor <= 1.001 {
        return Ok(());
    }
    let ffmpeg = find_ffmpeg()?;
    let temp = path.with_extension("timing.tmp.mp4");
    let factor_s = format!("{factor:.6}");
    let fps_s = fps.max(1).to_string();
    // Trim to captured frames, stretch PTS, then emit CFR duplicates for the full session.
    let vf = format!(
        "trim=end_frame={frame_count},setpts=PTS-STARTPTS*{factor_s},fps={fps_s}:round=near"
    );

    let mut cmd = Command::new(&ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "warning", "-y", "-i"]).arg(path);
    cmd.args(["-vf", &vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]);
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
    let mut cmd = Command::new(&ffmpeg);
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
    let enc = CACHED_ENCODER
        .get()
        .cloned()
        .unwrap_or_else(|| select_encoder());
    spawn_ffmpeg_with_encoder(&ffmpeg, &enc, path, width, height, fps, bitrate_kbps)
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
    }
    "libx264".to_string()
}

fn test_encoder(ffmpeg: &str, enc: &str) -> bool {
    Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=16x16:d=0.04",
            "-frames:v",
            "1",
            "-c:v",
            enc,
            "-f",
            "null",
            "-",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
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

    let mut cmd = Command::new(ffmpeg);
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
            cmd.args(["-preset", "veryfast", "-crf", "18", "-g", &gop]);
        }
        "h264_amf" => {
            cmd.args([
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
        _ => {
            cmd.args([
                "-preset",
                if enc == "h264_nvenc" { "p4" } else { "veryfast" },
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
