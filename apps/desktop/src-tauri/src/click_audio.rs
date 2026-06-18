//! Mouse-click SFX mixed into the recording audio track on button-down edges.

use crate::audio::{BYTES_PER_FRAME, CHANNELS, SAMPLE_RATE};
use crate::ffmpeg_util::{ffmpeg_command, find_ffmpeg};
use crate::log::capture_log;
use crate::state::AppState;
use parking_lot::{Mutex, RwLock};
use std::io::Write;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

const CLICK_MP3: &[u8] = include_bytes!("../resources/sfx/mouse-click.mp3");

static CLICK_CAPTURE: AtomicBool = AtomicBool::new(false);
static CLICK_TIMES: OnceLock<Mutex<Vec<f64>>> = OnceLock::new();
static CLICK_PCM: OnceLock<RwLock<Vec<i16>>> = OnceLock::new();
static CLICK_MIX_VOLUME: OnceLock<Mutex<f32>> = OnceLock::new();

fn click_times() -> &'static Mutex<Vec<f64>> {
    CLICK_TIMES.get_or_init(|| Mutex::new(Vec::new()))
}

fn mix_volume() -> &'static Mutex<f32> {
    CLICK_MIX_VOLUME.get_or_init(|| Mutex::new(1.0))
}

fn decode_click_pcm() -> Result<Vec<i16>, String> {
    let ffmpeg = find_ffmpeg()?;
    let mut cmd = ffmpeg_command(&ffmpeg);
    cmd.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-f",
        "s16le",
        "-ar",
        &SAMPLE_RATE.to_string(),
        "-ac",
        &CHANNELS.to_string(),
        "pipe:1",
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg for click decode: {e}"))?;
    {
        let stdin = child.stdin.as_mut().ok_or("click decode: no stdin")?;
        stdin
            .write_all(CLICK_MP3)
            .map_err(|e| format!("click decode stdin: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("click decode wait: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("click decode failed: {err}"));
    }
    let bytes = output.stdout;
    if bytes.len() < 4 {
        return Err("click decode produced no samples".into());
    }
    let mut samples = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        samples.push(i16::from_le_bytes([chunk[0], chunk[1]]));
    }
    Ok(samples)
}

fn click_samples() -> Result<&'static RwLock<Vec<i16>>, String> {
    if CLICK_PCM.get().is_none() {
        let pcm = decode_click_pcm()?;
        capture_log(&format!(
            "Mouse click SFX decoded ({} samples @ {}Hz)",
            pcm.len() / CHANNELS as usize,
            SAMPLE_RATE
        ));
        let _ = CLICK_PCM.set(RwLock::new(pcm));
    }
    CLICK_PCM.get().ok_or_else(|| "click PCM init failed".into())
}

fn clamp_volume(volume: f32) -> f32 {
    volume.clamp(0.0, 2.0)
}

pub fn sync_click_gate_from_state(st: &AppState) {
    let on = st.recording && st.recording_settings.mouse_click_audio;
    CLICK_CAPTURE.store(on, Ordering::Release);
}

pub fn reset_session(volume: f32) {
    click_times().lock().clear();
    *mix_volume().lock() = clamp_volume(volume);
}

pub fn record_click(t_secs: f64) {
    if !CLICK_CAPTURE.load(Ordering::Acquire) {
        return;
    }
    click_times().lock().push(t_secs.max(0.0));
}

pub fn has_recorded_clicks() -> bool {
    !click_times().lock().is_empty()
}

fn mix_clicks_into_buffer(buf: &mut Vec<u8>, duration_secs: f64) -> Result<(), String> {
    let times = click_times().lock().clone();
    if times.is_empty() {
        return Ok(());
    }
    let click = click_samples()?.read();
    if click.is_empty() {
        return Ok(());
    }
    let gain = *mix_volume().lock();

    let total_frames = (duration_secs * SAMPLE_RATE as f64).ceil() as usize;
    let needed_bytes = total_frames.saturating_mul(BYTES_PER_FRAME);
    if buf.len() < needed_bytes {
        buf.resize(needed_bytes, 0);
    }

    for t in times {
        let start_frame = (t * SAMPLE_RATE as f64).round() as usize;
        let start_byte = start_frame.saturating_mul(BYTES_PER_FRAME);
        for (i, &sample) in click.iter().enumerate() {
            let idx = start_byte + i * 2;
            if idx + 1 >= buf.len() {
                break;
            }
            let existing = i16::from_le_bytes([buf[idx], buf[idx + 1]]);
            let mixed = (existing as f32 + sample as f32 * gain)
                .clamp(i16::MIN as f32, i16::MAX as f32) as i16;
            let bytes = mixed.to_le_bytes();
            buf[idx] = bytes[0];
            buf[idx + 1] = bytes[1];
        }
    }
    Ok(())
}

/// Mix recorded click timestamps into an existing PCM sidecar (or create silence).
pub fn apply_to_pcm_sidecar(pcm_path: &Path, duration_secs: f64) -> Result<(), String> {
    if !has_recorded_clicks() {
        return Ok(());
    }
    let mut buf = if pcm_path.exists() {
        std::fs::read(pcm_path).map_err(|e| format!("read pcm for click mix: {e}"))?
    } else {
        Vec::new()
    };
    mix_clicks_into_buffer(&mut buf, duration_secs)?;
    std::fs::write(pcm_path, &buf).map_err(|e| format!("write pcm after click mix: {e}"))?;
    capture_log(&format!(
        "Mixed {} mouse click(s) into audio ({:.2}s @ {:.2}x)",
        click_times().lock().len(),
        duration_secs,
        *mix_volume().lock()
    ));
    Ok(())
}

#[cfg(windows)]
pub fn preview(volume: f32) -> Result<(), String> {
    let vol = clamp_volume(volume);
    std::thread::Builder::new()
        .name("click-preview".into())
        .spawn(move || {
            if let Err(e) = preview_blocking(vol) {
                capture_log(&format!("WARN: mouse click preview failed: {e}"));
            }
        })
        .map_err(|e| format!("spawn click preview thread: {e}"))?;
    Ok(())
}

#[cfg(windows)]
fn preview_blocking(volume: f32) -> Result<(), String> {
    use std::time::Duration;
    use wasapi::*;

    let _ = initialize_mta();

    let pcm = click_samples()?.read().clone();
    if pcm.is_empty() {
        return Ok(());
    }
    let scaled: Vec<f32> = pcm
        .iter()
        .map(|&s| (s as f32 / i16::MAX as f32) * volume)
        .collect();
    let total_frames = scaled.len() / CHANNELS as usize;

    let device = get_default_device(&Direction::Render).map_err(|e| e.to_string())?;
    let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        SAMPLE_RATE as usize,
        CHANNELS as usize,
        None,
    );
    let needs_convert = !matches!(
        client.is_supported(&format, &ShareMode::Shared),
        Ok(None)
    );
    let blockalign = format.get_blockalign();
    let (def_time, _) = client.get_periods().map_err(|e| e.to_string())?;
    client
        .initialize_client(
            &format,
            def_time,
            &Direction::Render,
            &ShareMode::Shared,
            needs_convert,
        )
        .map_err(|e| e.to_string())?;
    let _event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let render = client.get_audiorenderclient().map_err(|e| e.to_string())?;
    client.start_stream().map_err(|e| e.to_string())?;

    let mut pos = 0usize;
    while pos < total_frames {
        let space = client
            .get_available_space_in_frames()
            .map_err(|e| e.to_string())? as usize;
        if space == 0 {
            std::thread::sleep(Duration::from_millis(2));
            continue;
        }
        let to_write = space.min(total_frames - pos);
        let mut data = vec![0u8; to_write * blockalign as usize];
        for (frame, chunk) in data.chunks_exact_mut(blockalign as usize).enumerate() {
            let l = scaled[(pos + frame) * 2];
            let r = scaled[(pos + frame) * 2 + 1];
            let lb = l.to_le_bytes();
            let rb = r.to_le_bytes();
            chunk[0..4].copy_from_slice(&lb);
            chunk[4..8].copy_from_slice(&rb);
        }
        render
            .write_to_device(to_write, &data, None)
            .map_err(|e| e.to_string())?;
        pos += to_write;
    }

    std::thread::sleep(Duration::from_millis(120));
    let _ = client.stop_stream();
    Ok(())
}

#[cfg(not(windows))]
pub fn preview(_volume: f32) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn sync_click_gate_from_state(_st: &AppState) {}
#[cfg(not(windows))]
pub fn reset_session(_volume: f32) {}
#[cfg(not(windows))]
pub fn record_click(_t_secs: f64) {}
#[cfg(not(windows))]
pub fn has_recorded_clicks() -> bool {
    false
}
#[cfg(not(windows))]
pub fn apply_to_pcm_sidecar(_pcm_path: &Path, _duration_secs: f64) -> Result<(), String> {
    Ok(())
}
