//! Promo recording — dual-track capture (demo + inner take) merged on stop.

use crate::ffmpeg_util::{ffmpeg_command, find_ffmpeg};
use crate::geometry::{output_dims, promo_inner_start_zoom};
use crate::log::capture_log;
use crate::save_progress;
use crate::state::{Orientation, PromoMode};
use parking_lot::Mutex;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, OnceLock};
use std::thread::JoinHandle;
use std::time::Duration;

const PROMO_QUALITY: u32 = 720;
const PROMO_FPS: u32 = 60;
/// Retro hand-off from demo act → inner act (only on stop).
const TRANSITION_SECS: f64 = 1.5;
/// Full-screen slate between acts — must exceed TRANSITION_SECS.
const SLATE_SECS: f64 = 2.0;

static INNER_WRITER: OnceLock<Mutex<Option<PromoInnerWriter>>> = OnceLock::new();

struct PromoInnerWriter {
    stop_tx: mpsc::SyncSender<()>,
    frame_tx: mpsc::SyncSender<InnerFrame>,
    path: PathBuf,
    worker: JoinHandle<Result<(u64, f64), String>>,
}

fn inner_slot() -> &'static Mutex<Option<PromoInnerWriter>> {
    INNER_WRITER.get_or_init(|| Mutex::new(None))
}

pub fn promo_output_dims(mode: PromoMode) -> (u32, u32) {
    let orientation = match mode {
        PromoMode::Portrait => Orientation::Portrait,
        PromoMode::Landscape => Orientation::Landscape,
    };
    output_dims(orientation, PROMO_QUALITY)
}

pub fn promo_bitrate_kbps(mode: PromoMode) -> u32 {
    match mode {
        PromoMode::Portrait => 12_000,
        PromoMode::Landscape => 12_000,
    }
}

pub fn publish_inner_frame(bgra: Vec<u8>, width: u32, height: u32) {
    let slot = inner_slot().lock();
    let Some(writer) = slot.as_ref() else {
        return;
    };
    let _ = writer.frame_tx.try_send(InnerFrame { bgra, width, height });
}

struct InnerFrame {
    bgra: Vec<u8>,
    width: u32,
    height: u32,
}

impl PromoInnerWriter {
    fn start(
        path: PathBuf,
        width: u32,
        height: u32,
        fps: u32,
        bitrate_kbps: u32,
    ) -> Result<Self, String> {
        let (frame_tx, frame_rx) = mpsc::sync_channel::<InnerFrame>(64);
        let (stop_tx, stop_rx) = mpsc::sync_channel(1);
        let path_worker = path.clone();
        let worker = std::thread::Builder::new()
            .name("promo-inner-enc".into())
            .spawn(move || run_inner_encoder(path_worker, width, height, fps, bitrate_kbps, frame_rx, stop_rx))
            .map_err(|e| format!("spawn inner promo encoder: {e}"))?;
        Ok(Self {
            stop_tx,
            frame_tx,
            path,
            worker,
        })
    }

    fn finish(self) -> Result<(u64, f64), String> {
        let _ = self.stop_tx.send(());
        match self.worker.join() {
            Ok(r) => r,
            Err(_) => Err("inner promo encoder panicked".into()),
        }
    }
}

fn run_inner_encoder(
    path: PathBuf,
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
    frame_rx: mpsc::Receiver<InnerFrame>,
    stop_rx: mpsc::Receiver<()>,
) -> Result<(u64, f64), String> {
    let mut child = spawn_promo_ffmpeg(&path, width, height, fps, bitrate_kbps)?;
    let Some(mut stdin) = child.stdin.take() else {
        return Err("inner promo FFmpeg stdin unavailable".into());
    };
    let expected = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    let mut written = 0u64;
    loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }
        match frame_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(frame) => {
                if frame.bgra.len() != expected {
                    continue;
                }
                stdin
                    .write_all(&frame.bgra)
                    .map_err(|e| format!("inner promo write: {e}"))?;
                written += 1;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    drop(stdin);
    let status = child.wait().map_err(|e| format!("inner promo wait: {e}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&path);
        return Err("inner promo FFmpeg failed".into());
    }
    let duration = written as f64 / fps.max(1) as f64;
    capture_log(&format!(
        "Promo inner track finished ({written} frames, {duration:.2}s)"
    ));
    Ok((written, duration))
}

fn spawn_promo_ffmpeg(
    path: &Path,
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
) -> Result<Child, String> {
    let ffmpeg = find_ffmpeg()?;
    let mut cmd = ffmpeg_command(&ffmpeg);
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
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-b:v",
        &format!("{}k", bitrate_kbps),
        "-movflags",
        "+faststart",
        "-y",
    ]);
    cmd.arg(path);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::piped());
    cmd.spawn()
        .map_err(|e| format!("spawn inner promo FFmpeg: {e}"))
}

pub fn start_inner_recorder(mode: PromoMode, path: PathBuf) -> Result<(), String> {
    if inner_slot().lock().is_some() {
        return Err("inner promo recorder already active".into());
    }
    let (w, h) = promo_output_dims(mode);
    let bitrate = promo_bitrate_kbps(mode);
    let writer = PromoInnerWriter::start(path.clone(), w, h, PROMO_FPS, bitrate)?;
    capture_log(&format!(
        "Promo inner recorder → {} ({}x{} @ {}fps)",
        path.display(),
        w,
        h,
        PROMO_FPS
    ));
    *inner_slot().lock() = Some(writer);
    Ok(())
}

pub fn finish_inner_recorder() -> Result<Option<(PathBuf, u64, f64)>, String> {
    let writer = inner_slot().lock().take();
    let Some(writer) = writer else {
        return Ok(None);
    };
    let path = writer.path.clone();
    let (frames, duration) = writer.finish()?;
    if frames == 0 {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    }
    Ok(Some((path, frames, duration)))
}

pub fn inner_recording_active() -> bool {
    inner_slot().lock().is_some()
}

static COMPOSITE_LOG: AtomicU64 = AtomicU64::new(0);

struct CompositeDims {
    out_w: u32,
    out_h: u32,
    usage_dur: f64,
    inner_dur: f64,
    xfade_offset: f64,
}

fn composite_dims(
    usage_mp4: &Path,
    inner_mp4: &Path,
    usage_hint: Option<f64>,
    inner_hint: Option<f64>,
    output_dims_hint: Option<(u32, u32)>,
) -> Result<CompositeDims, String> {
    let usage_dur = usage_hint
        .filter(|d| *d >= 0.25)
        .or_else(|| probe_duration(usage_mp4))
        .unwrap_or(0.0);
    if usage_dur < 0.25 {
        return Err(format!(
            "promo usage track too short ({usage_dur:.2}s, path={})",
            usage_mp4.display()
        ));
    }
    let inner_dur = inner_hint
        .filter(|d| *d >= 0.2)
        .or_else(|| probe_duration(inner_mp4))
        .unwrap_or(0.0);
    if inner_dur < 0.2 {
        return Err(format!(
            "promo inner track too short ({inner_dur:.2}s, path={})",
            inner_mp4.display()
        ));
    }
    let (out_w, out_h) = output_dims_hint
        .filter(|(w, h)| *w > 0 && *h > 0)
        .or_else(|| probe_video_size(usage_mp4))
        .or_else(|| probe_video_size(inner_mp4))
        .unwrap_or((1280, 720));
    let xfade_offset = (usage_dur + SLATE_SECS - TRANSITION_SECS).max(0.0);
    Ok(CompositeDims {
        out_w,
        out_h,
        usage_dur,
        inner_dur,
        xfade_offset,
    })
}

/// Demo act → retro slate → pixelize hand-off → inner act. Only runs on stop.
pub fn composite_promo_final(
    usage_mp4: &Path,
    inner_mp4: Option<&Path>,
    out_mp4: &Path,
    usage_has_audio: bool,
    inner_started_at: Option<f64>,
    usage_duration_hint: Option<f64>,
    inner_duration_hint: Option<f64>,
    output_dims_hint: Option<(u32, u32)>,
) -> Result<(), String> {
    let inner = match inner_mp4 {
        Some(p) => p,
        None => {
            capture_log("Promo composite: no inner take — exporting demo only");
            return copy_or_reencode(usage_mp4, out_mp4);
        }
    };

    let dims = match composite_dims(
        usage_mp4,
        inner,
        usage_duration_hint,
        inner_duration_hint,
        output_dims_hint,
    ) {
        Ok(d) => d,
        Err(e) => {
            capture_log(&format!("Promo composite: {e} — exporting demo only"));
            return copy_or_reencode(usage_mp4, out_mp4);
        }
    };

    if let Some(t) = inner_started_at {
        capture_log(&format!(
            "Promo composite: inner began at {t:.2}s; hand-off at stop (demo {:.2}s, inner {:.2}s)",
            dims.usage_dur, dims.inner_dur
        ));
    }

    save_progress::report(15, "compositing");

    let attempts: &[(&str, fn(&Path, &Path, &Path, &CompositeDims, bool) -> Result<Output, String>)] = &[
        ("retro pixelize", run_composite_retro),
        ("fade hand-off", run_composite_fade),
        ("hard concat", run_composite_concat),
    ];

    for (name, run) in attempts {
        capture_log(&format!("Promo composite trying {name}…"));
        match run(usage_mp4, inner, out_mp4, &dims, usage_has_audio) {
            Ok(out) if out.status.success() => {
                save_progress::report(55, "compositing");
                capture_log(&format!(
                    "Promo composite OK ({name}) → {} (demo {:.1}s + slate {SLATE_SECS}s + inner {:.1}s)",
                    out_mp4.display(),
                    dims.usage_dur,
                    dims.inner_dur
                ));
                return Ok(());
            }
            Ok(out) => {
                let err = String::from_utf8_lossy(&out.stderr);
                log_composite_err(&format!("{name} failed: {err}"));
            }
            Err(e) => log_composite_err(&format!("{name} error: {e}")),
        }
        let _ = std::fs::remove_file(out_mp4);
    }

    Err("promo composite failed (all strategies)".into())
}

fn log_composite_err(msg: &str) {
    if COMPOSITE_LOG.fetch_add(1, Ordering::Relaxed) < 6 {
        capture_log(msg);
    }
}

fn run_composite_retro(
    usage: &Path,
    inner: &Path,
    out: &Path,
    d: &CompositeDims,
    usage_has_audio: bool,
) -> Result<Output, String> {
    let ffmpeg = find_ffmpeg()?;
    let (iw, ih) = probe_video_size(inner).unwrap_or((d.out_w, d.out_h));
    let inner_scale = scale_filter(iw, ih, d.out_w, d.out_h);
    let slate = retro_slate_filter(d.out_w, d.out_h, SLATE_SECS, true);

    let (uw, uh) = probe_video_size(usage).unwrap_or((d.out_w, d.out_h));
    let usage_scale = scale_filter(uw, uh, d.out_w, d.out_h);
    let filter = format!(
        "[0:v]fps=60,format=yuv420p,{usage_scale}setsar=1,settb=AVTB[v0];\
         {slate};\
         [v0][slate]concat=n=2:v=1:a=0,fps=60,settb=AVTB[act1];\
         [1:v]fps=60,format=yuv420p,{inner_scale}setsar=1,settb=AVTB[v1];\
         [act1][v1]xfade=transition=pixelize:duration={TRANSITION_SECS}:offset={}[outv]",
        d.xfade_offset
    );
    run_ffmpeg_filter(&ffmpeg, usage, inner, out, &filter, usage_has_audio, d.usage_dur)
}

fn run_composite_fade(
    usage: &Path,
    inner: &Path,
    out: &Path,
    d: &CompositeDims,
    usage_has_audio: bool,
) -> Result<Output, String> {
    let ffmpeg = find_ffmpeg()?;
    let (iw, ih) = probe_video_size(inner).unwrap_or((d.out_w, d.out_h));
    let inner_scale = scale_filter(iw, ih, d.out_w, d.out_h);
    let slate = retro_slate_filter(d.out_w, d.out_h, SLATE_SECS, false);

    let (uw, uh) = probe_video_size(usage).unwrap_or((d.out_w, d.out_h));
    let usage_scale = scale_filter(uw, uh, d.out_w, d.out_h);
    let filter = format!(
        "[0:v]fps=60,format=yuv420p,{usage_scale}setsar=1,settb=AVTB[v0];\
         {slate};\
         [v0][slate]concat=n=2:v=1:a=0,fps=60,settb=AVTB[act1];\
         [1:v]fps=60,format=yuv420p,{inner_scale}setsar=1,settb=AVTB[v1];\
         [act1][v1]xfade=transition=fadeblack:duration={TRANSITION_SECS}:offset={}[outv]",
        d.xfade_offset
    );
    run_ffmpeg_filter(&ffmpeg, usage, inner, out, &filter, usage_has_audio, d.usage_dur)
}

fn run_composite_concat(
    usage: &Path,
    inner: &Path,
    out: &Path,
    d: &CompositeDims,
    usage_has_audio: bool,
) -> Result<Output, String> {
    let ffmpeg = find_ffmpeg()?;
    let (iw, ih) = probe_video_size(inner).unwrap_or((d.out_w, d.out_h));
    let inner_scale = scale_filter(iw, ih, d.out_w, d.out_h);
    let slate = retro_slate_filter(d.out_w, d.out_h, SLATE_SECS, false);

    let (uw, uh) = probe_video_size(usage).unwrap_or((d.out_w, d.out_h));
    let usage_scale = scale_filter(uw, uh, d.out_w, d.out_h);
    let filter = format!(
        "[0:v]fps=60,format=yuv420p,{usage_scale}setsar=1[v0];\
         {slate};\
         [v0][slate]concat=n=2:v=1:a=0[act1];\
         [1:v]fps=60,format=yuv420p,{inner_scale}setsar=1[v1];\
         [act1][v1]concat=n=2:v=1:a=0[outv]"
    );
    run_ffmpeg_filter(&ffmpeg, usage, inner, out, &filter, usage_has_audio, d.usage_dur)
}

fn scale_filter(iw: u32, ih: u32, ow: u32, oh: u32) -> String {
    if iw != ow || ih != oh {
        format!("scale={ow}:{oh}:flags=lanczos,")
    } else {
        String::new()
    }
}

fn retro_slate_filter(w: u32, h: u32, dur: f64, with_text: bool) -> String {
    let font_main = ((w.min(h) as f64) * 0.067).round().max(28.0) as u32;
    let font_icon = ((font_main as f64) * 0.75).round().max(22.0) as u32;
    let bars = format!(
        "drawbox=x=0:y=0:w=iw:h=4:color=0xFF6B35@0.9:t=fill,\
         drawbox=x=0:y=ih-4:w=iw:h=4:color=0xFF6B35@0.9:t=fill"
    );
    let text = if with_text {
        format!(
            ",drawtext=text='FINAL TAKE':fontcolor=0xF2EDE4:fontsize={font_main}:\
         borderw=2:bordercolor=0x000000@0.6:x=(w-text_w)/2:y=(h-text_h)/2-32,\
         drawtext=text='▶':fontcolor=0xFF6B35:fontsize={font_icon}:\
         x=(w-text_w)/2:y=(h-text_h)/2+36"
        )
    } else {
        String::new()
    };
    format!(
        "color=c=0x0e0d0b:s={w}x{h}:d={dur},{bars}{text},\
         format=yuv420p,fps=60,settb=AVTB[slate]"
    )
}

fn run_ffmpeg_filter(
    ffmpeg: &str,
    usage: &Path,
    inner: &Path,
    out: &Path,
    filter: &str,
    usage_has_audio: bool,
    usage_dur: f64,
) -> Result<Output, String> {
    let mut cmd = ffmpeg_command(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-y"]);
    cmd.args(["-i", &usage.to_string_lossy()]);
    cmd.args(["-i", &inner.to_string_lossy()]);

    if usage_has_audio {
        let audio_fade = (usage_dur - TRANSITION_SECS * 0.5).max(0.0);
        let audio_filter = format!(
            "{filter};\
             [0:a]afade=t=out:st={audio_fade}:d={TRANSITION_SECS}[outa]",
        );
        cmd.args(["-filter_complex", &audio_filter]);
        cmd.args(["-map", "[outv]", "-map", "[outa]"]);
        cmd.args(["-c:a", "aac", "-b:a", "192k"]);
    } else {
        cmd.args(["-filter_complex", filter]);
        cmd.args(["-map", "[outv]"]);
    }

    cmd.args([
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ]);
    cmd.arg(out);
    cmd.output()
        .map_err(|e| format!("promo composite ffmpeg: {e}"))
}

fn copy_or_reencode(usage_mp4: &Path, out_mp4: &Path) -> Result<(), String> {
    std::fs::copy(usage_mp4, out_mp4).map_err(|e| format!("copy usage promo: {e}"))?;
    Ok(())
}

fn probe_video_size(path: &Path) -> Option<(u32, u32)> {
    let ffmpeg = find_ffmpeg().ok()?;
    let out = ffmpeg_command(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "info",
            "-i",
            &path.to_string_lossy(),
            "-f",
            "null",
            "-",
        ])
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    let mut best: Option<(u32, u32)> = None;
    for line in stderr.lines() {
        if !line.contains("Video:") {
            continue;
        }
        for segment in line.split(',') {
            if let Some((w, h)) = parse_wxh_segment(segment.trim()) {
                if w >= 64 && h >= 64 {
                    best = Some((w, h));
                }
            }
        }
    }
    best
}

fn parse_wxh_segment(s: &str) -> Option<(u32, u32)> {
    let xpos = s.find('x')?;
    let w: u32 = s[..xpos].trim().parse().ok()?;
    let h_str: String = s[xpos + 1..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let h: u32 = h_str.parse().ok()?;
    if w > 0 && h > 0 {
        Some((w, h))
    } else {
        None
    }
}

pub fn probe_duration_public(path: &Path) -> Option<f64> {
    probe_duration(path)
}

fn probe_duration(path: &Path) -> Option<f64> {
    let ffmpeg = find_ffmpeg().ok()?;
    let out = ffmpeg_command(&ffmpeg)
        .args([
            "-hide_banner",
            // Duration is only printed at info level — `-loglevel error` hides it.
            "-loglevel",
            "info",
            "-i",
            &path.to_string_lossy(),
            "-f",
            "null",
            "-",
        ])
        .output()
        .ok()?;
    let stderr = String::from_utf8_lossy(&out.stderr);
    for line in stderr.lines() {
        if let Some(idx) = line.find("Duration:") {
            let part = line[idx + 9..].trim();
            if let Some(end) = part.find(',') {
                return parse_duration(&part[..end].trim());
            }
        }
    }
    None
}

fn parse_duration(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let sec: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

pub fn init_inner_viewport(mode: PromoMode, center_x: f64, center_y: f64) -> crate::state::Viewport {
    let orientation = match mode {
        PromoMode::Portrait => Orientation::Portrait,
        PromoMode::Landscape => Orientation::Landscape,
    };
    let zoom = promo_inner_start_zoom(orientation);
    crate::state::Viewport {
        x: center_x,
        y: center_y,
        zoom,
        rotation: 0.0,
        orientation,
    }
}
