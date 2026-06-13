//! Live stream pipeline: GPU frame readback → FFmpeg HW H.264 → RTMP publish.

use crate::rtmp_publish::{RtmpPublisher, RtmpTarget};
use crate::state::SharedState;
use std::io::Write;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct StreamConfig {
    pub server_url: String,
    pub stream_key: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
}

pub struct StreamPipeline {
    frame_tx: Sender<Vec<u8>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    error: Arc<parking_lot::Mutex<Option<String>>>,
    bytes_sent: Arc<AtomicU64>,
    frames_sent: Arc<AtomicU64>,
    connected: Arc<AtomicBool>,
}

impl StreamPipeline {
    pub fn start(config: StreamConfig, state: Option<SharedState>) -> Result<Self, String> {
        let target = RtmpTarget::from_url(&config.server_url, &config.stream_key)?;
        let ffmpeg = spawn_ffmpeg_encoder(
            config.width,
            config.height,
            config.fps,
            config.bitrate_kbps,
        )?;

        let publisher = RtmpPublisher::start(
            target,
            config.width,
            config.height,
            config.fps,
            config.bitrate_kbps,
        )?;

        let (frame_tx, frame_rx) = mpsc::channel::<Vec<u8>>();
        let stop = Arc::new(AtomicBool::new(false));
        let error = Arc::new(parking_lot::Mutex::new(None));
        let bytes_sent = Arc::new(AtomicU64::new(0));
        let frames_sent = Arc::new(AtomicU64::new(0));
        let connected = Arc::new(AtomicBool::new(true));

        let stop_t = stop.clone();
        let error_t = error.clone();
        let bytes_sent_t = bytes_sent.clone();
        let frames_sent_t = frames_sent.clone();
        let connected_t = connected.clone();

        let thread = thread::Builder::new()
            .name("stream-pipeline".into())
            .spawn(move || {
                if let Err(e) = run_pipeline(
                    ffmpeg,
                    publisher,
                    frame_rx,
                    state,
                    &stop_t,
                    &error_t,
                    &bytes_sent_t,
                    &frames_sent_t,
                    &connected_t,
                ) {
                    *error_t.lock() = Some(e);
                    connected_t.store(false, Ordering::SeqCst);
                }
            })
            .map_err(|e| format!("stream thread: {e}"))?;

        Ok(Self {
            frame_tx,
            stop,
            thread: Some(thread),
            error,
            bytes_sent,
            frames_sent,
            connected,
        })
    }

    pub fn push_frame(&self, bgra: Vec<u8>) {
        let _ = self.frame_tx.send(bgra);
    }

    pub fn stats(&self) -> (u64, u64, bool, Option<String>) {
        (
            self.bytes_sent.load(Ordering::Relaxed),
            self.frames_sent.load(Ordering::Relaxed),
            self.connected.load(Ordering::Relaxed),
            self.error.lock().clone(),
        )
    }
}

impl Drop for StreamPipeline {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        drop(self.frame_tx.clone());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

struct FfmpegEncoder {
    child: Child,
    stdin: ChildStdin,
}

fn spawn_ffmpeg_encoder(width: u32, height: u32, fps: u32, bitrate_kbps: u32) -> Result<FfmpegEncoder, String> {
    let ffmpeg = find_ffmpeg()?;
    let bitrate = format!("{}k", bitrate_kbps.max(500));
    let bufsize = format!("{}k", bitrate_kbps.saturating_mul(2).max(1000));
    let gop = fps.saturating_mul(2).max(30);

    let encoders = ["h264_nvenc", "h264_amf", "h264_qsv", "libx264"];
    let mut last_err = String::new();

    for enc in encoders {
        let mut cmd = Command::new(&ffmpeg);
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgra",
            "-s",
            &format!("{width}x{height}"),
            "-r",
            &fps.to_string(),
            "-i",
            "pipe:0",
            "-an",
            "-c:v",
            enc,
            "-preset",
            if enc == "libx264" { "veryfast" } else { "p4" },
            "-tune",
            "ll",
            "-profile:v",
            "high",
            "-b:v",
            &bitrate,
            "-maxrate",
            &bitrate,
            "-bufsize",
            &bufsize,
            "-g",
            &gop.to_string(),
            "-keyint_min",
            &gop.to_string(),
            "-sc_threshold",
            "0",
            "-bf",
            "0",
            "-pix_fmt",
            "yuv420p",
            "-f",
            "h264",
            "pipe:1",
        ]);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        match cmd.spawn() {
            Ok(mut child) => {
                let stdin = child.stdin.take().ok_or_else(|| "ffmpeg stdin unavailable".to_string())?;
                return Ok(FfmpegEncoder { child, stdin });
            }
            Err(e) => {
                last_err = format!("{enc}: {e}");
            }
        }
    }

    Err(format!(
        "failed to start FFmpeg encoder ({last_err}). Install FFmpeg and ensure it is on PATH."
    ))
}

fn find_ffmpeg() -> Result<String, String> {
    for name in ["ffmpeg", "ffmpeg.exe"] {
        if Command::new(name)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Ok(name.to_string());
        }
    }
    Err(
        "FFmpeg not found. Install FFmpeg (https://ffmpeg.org) and add it to your PATH to enable live streaming."
            .into(),
    )
}

fn run_pipeline(
    mut ffmpeg: FfmpegEncoder,
    publisher: RtmpPublisher,
    frame_rx: Receiver<Vec<u8>>,
    shared_state: Option<SharedState>,
    stop: &AtomicBool,
    error: &parking_lot::Mutex<Option<String>>,
    bytes_sent: &AtomicU64,
    frames_sent: &AtomicU64,
    connected: &AtomicBool,
) -> Result<(), String> {
    let mut stdout = ffmpeg
        .child
        .stdout
        .take()
        .ok_or_else(|| "ffmpeg stdout unavailable".to_string())?;

    let start = Instant::now();
    let mut h264_buf = Vec::with_capacity(256 * 1024);
    let mut read_buf = [0u8; 65536];

    let (h264_tx, h264_rx) = mpsc::channel::<Vec<u8>>();
    let reader_stop = Arc::new(AtomicBool::new(false));
    let reader_stop_t = reader_stop.clone();
    let reader = thread::spawn(move || {
        while !reader_stop_t.load(Ordering::SeqCst) {
            match stdout.read(&mut read_buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = h264_tx.send(read_buf[..n].to_vec());
                }
                Err(_) => thread::sleep(Duration::from_millis(2)),
            }
        }
    });

    while !stop.load(Ordering::SeqCst) {
        while let Ok(chunk) = h264_rx.try_recv() {
            h264_buf.extend_from_slice(&chunk);
        }

        match frame_rx.recv_timeout(Duration::from_millis(5)) {
            Ok(frame) => {
                ffmpeg
                    .stdin
                    .write_all(&frame)
                    .map_err(|e| format!("ffmpeg stdin write: {e}"))?;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) if !publisher.is_running() => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        while let Some((au, rest)) = take_access_unit(&h264_buf) {
            h264_buf = rest;
            let ts = start.elapsed().as_millis() as u32;
            let is_key = crate::flv::split_annex_b(&au)
                .iter()
                .any(|nal| nal.first().map(|b| b & 0x1f) == Some(5));
            publisher.push_video(au, ts, is_key);
            let (sent, frames) = publisher.stats();
            bytes_sent.store(sent, Ordering::Relaxed);
            frames_sent.store(frames, Ordering::Relaxed);
            if let Some(ref st) = shared_state {
                let mut s = st.lock();
                s.stream_stats.bytes_sent = sent;
                s.stream_stats.frames_sent = frames;
                s.stream_stats.connected = publisher.is_running();
            }
            if let Some(err) = publisher.last_error() {
                connected.store(false, Ordering::SeqCst);
                if let Some(ref st) = shared_state {
                    let mut s = st.lock();
                    s.stream_stats.connected = false;
                    s.stream_stats.error = Some(err.clone());
                }
                reader_stop.store(true, Ordering::SeqCst);
                let _ = reader.join();
                return Err(err);
            }
        }

        if !publisher.is_running() {
            connected.store(false, Ordering::SeqCst);
            if let Some(err) = publisher.last_error() {
                reader_stop.store(true, Ordering::SeqCst);
                let _ = reader.join();
                return Err(err);
            }
            break;
        }
    }

    reader_stop.store(true, Ordering::SeqCst);
    let _ = reader.join();
    let _ = ffmpeg.stdin.flush();
    drop(ffmpeg.stdin);
    let _ = ffmpeg.child.wait();
    connected.store(false, Ordering::SeqCst);
    if let Some(ref st) = shared_state {
        let mut s = st.lock();
        s.stream_stats.connected = false;
    }
    Ok(())
}

/// Take one Annex-B access unit from the front of `buf`, returning (unit, remainder).
fn take_access_unit(buf: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    if buf.len() < 5 {
        return None;
    }
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 < buf.len() {
        if buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 1 {
            starts.push(i);
            i += 3;
        } else if i + 4 < buf.len() && buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 0 && buf[i + 3] == 1 {
            starts.push(i);
            i += 4;
        } else {
            i += 1;
        }
    }
    if starts.len() < 2 {
        return None;
    }
    let end = starts[1];
    let unit = buf[..end].to_vec();
    let rest = buf[end..].to_vec();
    Some((unit, rest))
}

use std::io::Read;
