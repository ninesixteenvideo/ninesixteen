//! Game-mode webcam capture (Windows / MSMF via nokhwa).
//!
//! Capture resolution = min(recording quality tier, hardware maximum), never above
//! the user's recording setting. CPU cover-fit composite into the recording buffer.

use crate::geometry::{cover_src_crop, normalize_quality, DestRect, QUALITY_1080, QUALITY_720};
use crate::state::{Orientation, WebcamDeviceInfo};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Webcam capture never exceeds 1080p even when recording 1440p/4K landscape.
pub const WEBCAM_CAPTURE_MAX_TIER: u32 = QUALITY_1080;

#[derive(Clone)]
pub struct WebcamFrame {
    pub width: u32,
    pub height: u32,
    pub bgra: Arc<Vec<u8>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DeviceCaps {
    width: u32,
    height: u32,
    tier: u32,
}

struct WebcamSlot {
    latest: Option<WebcamFrame>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    active_device: Option<String>,
    active_quality: u32,
}

impl WebcamSlot {
    fn empty() -> Self {
        Self {
            latest: None,
            stop: Arc::new(AtomicBool::new(true)),
            thread: None,
            active_device: None,
            active_quality: 0,
        }
    }
}

/// Recording short-edge tier the webcam should target (720 or 1080).
pub fn webcam_recording_tier(quality: u32, orientation: Orientation) -> u32 {
    let q = normalize_quality(quality, orientation);
    q.min(WEBCAM_CAPTURE_MAX_TIER)
}

/// Map pixel dimensions to a capture tier (480 / 720 / 1080).
pub fn tier_from_resolution(width: u32, height: u32) -> u32 {
    let short = width.min(height);
    if short >= QUALITY_1080 {
        QUALITY_1080
    } else if short >= QUALITY_720 {
        QUALITY_720
    } else {
        480
    }
}

/// Target capture tier = min(recording tier, optional hardware tier).
pub fn effective_webcam_tier(recording_tier: u32, hardware_tier: Option<u32>) -> u32 {
    let recording_tier = recording_tier.min(WEBCAM_CAPTURE_MAX_TIER);
    match hardware_tier {
        Some(hw) => recording_tier.min(hw),
        None => recording_tier,
    }
}

pub fn webcam_target_resolution(tier: u32) -> (u32, u32) {
    if tier >= QUALITY_1080 {
        (1920, 1080)
    } else if tier >= QUALITY_720 {
        (1280, 720)
    } else {
        (640, 480)
    }
}

static WEBCAM: OnceLock<Mutex<WebcamSlot>> = OnceLock::new();
static CAPS_CACHE: OnceLock<Mutex<HashMap<String, DeviceCaps>>> = OnceLock::new();
static PROBE_BUSY: AtomicBool = AtomicBool::new(false);

fn slot() -> &'static Mutex<WebcamSlot> {
    WEBCAM.get_or_init(|| Mutex::new(WebcamSlot::empty()))
}

fn caps_cache() -> &'static Mutex<HashMap<String, DeviceCaps>> {
    CAPS_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn device_key(device_id: Option<&str>) -> String {
    device_id.unwrap_or("0").to_string()
}

fn cached_caps(device_id: Option<&str>) -> Option<DeviceCaps> {
    caps_cache().lock().get(&device_key(device_id)).copied()
}

fn store_caps(device_id: Option<&str>, width: u32, height: u32) {
    let tier = tier_from_resolution(width, height);
    caps_cache().lock().insert(
        device_key(device_id),
        DeviceCaps {
            width,
            height,
            tier,
        },
    );
}

#[cfg(windows)]
mod imp {
    use super::*;
    use image::ImageReader;
    use nokhwa::buffer::Buffer;
    use nokhwa::pixel_format::RgbFormat;
    use nokhwa::utils::{
        nv12_to_rgb, ApiBackend, CameraFormat, CameraIndex, FrameFormat, RequestedFormat,
        RequestedFormatType, Resolution,
    };
    use nokhwa::{query, Camera};
    use std::io::Cursor;

    #[derive(Clone, Copy, Debug)]
    enum StreamFormat {
        Mjpeg,
        Yuyv,
        Nv12,
    }

    struct FormatAttempt {
        requested: RequestedFormatType,
        label: &'static str,
        width: u32,
        height: u32,
    }

    /// Serialize MSMF open/close between the live stream and background probes.
    static WEBCAM_IO: OnceLock<Mutex<()>> = OnceLock::new();

    fn io_lock() -> parking_lot::MutexGuard<'static, ()> {
        WEBCAM_IO
            .get_or_init(|| Mutex::new(()))
            .lock()
    }

    fn camera_active() -> bool {
        let s = slot().lock();
        s.thread.is_some() && !s.stop.load(Ordering::Relaxed)
    }

    fn parse_index(device_id: Option<&str>) -> CameraIndex {
        device_id
            .and_then(|id| id.parse::<u32>().ok())
            .map(CameraIndex::Index)
            .unwrap_or(CameraIndex::Index(0))
    }

    pub fn list_devices() -> Vec<WebcamDeviceInfo> {
        let Ok(cams) = query(ApiBackend::MediaFoundation) else {
            return Vec::new();
        };
        let cache = caps_cache().lock();
        let devices: Vec<WebcamDeviceInfo> = cams
            .into_iter()
            .enumerate()
            .map(|(i, info)| {
                let id = i.to_string();
                let caps = cache.get(&id).copied();
                WebcamDeviceInfo {
                    name: info.human_name().to_string(),
                    max_width: caps.map(|c| c.width),
                    max_height: caps.map(|c| c.height),
                    id,
                }
            })
            .collect();
        drop(cache);
        for d in &devices {
            schedule_capability_probe(Some(&d.id));
        }
        devices
    }

    pub fn schedule_capability_probe(device_id: Option<&str>) {
        if cached_caps(device_id).is_some() {
            return;
        }
        if camera_active() {
            return;
        }
        if PROBE_BUSY.swap(true, Ordering::AcqRel) {
            return;
        }
        let key = device_key(device_id);
        std::thread::Builder::new()
            .name("webcam-probe".into())
            .spawn(move || {
                let _guard = io_lock();
                if cached_caps(Some(&key)).is_some() {
                    PROBE_BUSY.store(false, Ordering::Release);
                    return;
                }
                let index = parse_index(Some(&key));
                let recording_tier = WEBCAM_CAPTURE_MAX_TIER;
                if let Some((mut camera, format, label, w, h)) =
                    find_best_stream(&index, recording_tier, recording_tier)
                {
                    let _ = camera.stop_stream();
                    store_caps(Some(&key), w, h);
                    crate::log::capture_log(&format!(
                        "Game webcam capability probe: {key} max {w}x{h} ({label}, tier {})",
                        tier_from_resolution(w, h)
                    ));
                    let _ = format;
                }
                PROBE_BUSY.store(false, Ordering::Release);
            })
            .ok();
    }

    fn avg_luma(bgra: &[u8]) -> u32 {
        let pixels = bgra.len() / 4;
        if pixels == 0 {
            return 0;
        }
        let sum: u64 = bgra
            .chunks_exact(4)
            .map(|px| (px[0] as u64 + px[1] as u64 + px[2] as u64) / 3)
            .sum();
        (sum / pixels as u64) as u32
    }

    fn frame_luma_ok(bgra: &[u8]) -> bool {
        avg_luma(bgra) >= 8
    }

    fn rgb_to_bgra(rgb: &[u8], width: u32, height: u32) -> Vec<u8> {
        let pixels = (width as usize).saturating_mul(height as usize);
        let mut bgra = vec![0u8; pixels.saturating_mul(4)];
        for i in 0..pixels.min(rgb.len() / 3) {
            let src = i * 3;
            let dst = i * 4;
            bgra[dst] = rgb[src + 2];
            bgra[dst + 1] = rgb[src + 1];
            bgra[dst + 2] = rgb[src];
            bgra[dst + 3] = 255;
        }
        bgra
    }

    fn decode_mjpeg(data: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
        if data.len() < 2 || data[0] != 0xFF || data[1] != 0xD8 {
            return None;
        }
        let img = ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .ok()?
            .decode()
            .ok()?;
        let rgb = img.to_rgb8();
        let w = rgb.width();
        let h = rgb.height();
        Some((w, h, rgb_to_bgra(rgb.as_raw(), w, h)))
    }

    fn decode_yuyv_full(data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
        let w = width as usize;
        let h = height as usize;
        if w == 0 || h == 0 {
            return None;
        }
        let min_bytes = w * h * 2;
        if data.len() < min_bytes {
            return None;
        }
        let stride = if data.len() % h == 0 {
            (data.len() / h).max(w * 2)
        } else {
            w * 2
        };
        let mut bgra = vec![0u8; w * h * 4];
        for row in 0..h {
            let row_off = row * stride;
            if row_off + w * 2 > data.len() {
                return None;
            }
            let row_data = &data[row_off..row_off + w * 2];
            for x in (0..w).step_by(2) {
                let base = x * 2;
                if base + 3 >= row_data.len() {
                    break;
                }
                let y0 = row_data[base] as f64;
                let u = row_data[base + 1] as f64 - 128.0;
                let y1 = row_data[base + 2] as f64;
                let v = row_data[base + 3] as f64 - 128.0;
                for (px, y) in [(x, y0), (x + 1, y1)] {
                    if px >= w {
                        continue;
                    }
                    let r = (y + 1.402 * v).clamp(0.0, 255.0) as u8;
                    let g = (y - 0.344_136 * u - 0.714_136 * v).clamp(0.0, 255.0) as u8;
                    let b = (y + 1.772 * u).clamp(0.0, 255.0) as u8;
                    let dst = (row * w + px) * 4;
                    bgra[dst] = b;
                    bgra[dst + 1] = g;
                    bgra[dst + 2] = r;
                    bgra[dst + 3] = 255;
                }
            }
        }
        Some(bgra)
    }

    fn decode_nv12(data: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
        let res = Resolution::new(width, height);
        let expected = (width as usize) * (height as usize) * 3 / 2;
        if data.len() < expected {
            return None;
        }
        let rgb = nv12_to_rgb(res, &data[..expected], true).ok()?;
        Some(rgb_to_bgra(&rgb, width, height))
    }

    fn stream_format_from_camera(camera: &Camera) -> StreamFormat {
        match camera.frame_format() {
            FrameFormat::MJPEG => StreamFormat::Mjpeg,
            FrameFormat::NV12 => StreamFormat::Nv12,
            _ => StreamFormat::Yuyv,
        }
    }

    fn decode_frame(frame: &Buffer, format: StreamFormat) -> Result<(u32, u32, Vec<u8>), String> {
        let res = frame.resolution();
        let w = res.width();
        let h = res.height();
        let data = frame.buffer();

        let decoded = match format {
            StreamFormat::Mjpeg => {
                decode_mjpeg(data).ok_or_else(|| String::from("MJPEG decode failed"))?
            }
            StreamFormat::Yuyv => {
                let bgra = decode_yuyv_full(data, w, h)
                    .ok_or_else(|| format!("YUYV decode failed ({w}x{h}, {} bytes)", data.len()))?;
                (w, h, bgra)
            }
            StreamFormat::Nv12 => {
                let bgra = decode_nv12(data, w, h)
                    .ok_or_else(|| format!("NV12 decode failed ({w}x{h}, {} bytes)", data.len()))?;
                (w, h, bgra)
            }
        };

        if !frame_luma_ok(&decoded.2) {
            return Err(format!(
                "webcam frame too dark ({w}x{h}, luma {})",
                avg_luma(&decoded.2)
            ));
        }
        Ok(decoded)
    }

    fn resolution_meets_target(actual_w: u32, actual_h: u32, target_w: u32, target_h: u32) -> bool {
        let actual = actual_w as u64 * actual_h as u64;
        let target = target_w as u64 * target_h as u64;
        if target == 0 {
            return false;
        }
        // Reject "closest" downgrades (e.g. 640×480 when 720p was requested).
        actual * 100 >= target * 85
    }

    fn publish_frame(width: u32, height: u32, bgra: Vec<u8>, tag: &str, frames_ok: u64) {
        let luma = avg_luma(&bgra);
        slot().lock().latest = Some(WebcamFrame {
            width,
            height,
            bgra: Arc::new(bgra),
        });
        if frames_ok == 0 {
            crate::log::capture_log(&format!(
                "Game webcam ready ({width}x{height}, {tag}, luma {luma})"
            ));
        }
    }

    fn warm_validate(
        camera: &mut Camera,
        format: StreamFormat,
        tag: &str,
        target_w: u32,
        target_h: u32,
    ) -> bool {
        let mut good = 0u32;
        for _ in 0..60 {
            let Ok(frame) = camera.frame() else {
                std::thread::sleep(Duration::from_millis(33));
                continue;
            };
            let (w, h) = (camera.resolution().width_x, camera.resolution().height_y);
            if !resolution_meets_target(w, h, target_w, target_h) {
                return false;
            }
            match decode_frame(&frame, format) {
                Ok((width, height, bgra)) => {
                    good += 1;
                    publish_frame(width, height, bgra, tag, 0);
                    if good >= 3 {
                        return true;
                    }
                }
                Err(_) => {
                    good = 0;
                }
            }
            std::thread::sleep(Duration::from_millis(16));
        }
        false
    }

    fn push_attempt(
        attempts: &mut Vec<FormatAttempt>,
        width: u32,
        height: u32,
        fmt: FrameFormat,
        exact: bool,
        label: &'static str,
    ) {
        let requested = if exact {
            RequestedFormatType::Exact(CameraFormat::new_from(width, height, fmt, 30))
        } else {
            RequestedFormatType::Closest(CameraFormat::new_from(width, height, fmt, 30))
        };
        attempts.push(FormatAttempt {
            requested,
            label,
            width,
            height,
        });
    }

    fn push_resolution_formats(attempts: &mut Vec<FormatAttempt>, width: u32, height: u32) {
        match (width, height) {
            (1920, 1080) => {
                push_attempt(attempts, width, height, FrameFormat::MJPEG, true, "1080p MJPEG");
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::MJPEG,
                    false,
                    "1080p MJPEG closest",
                );
                push_attempt(attempts, width, height, FrameFormat::YUYV, true, "1080p YUYV");
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::YUYV,
                    false,
                    "1080p YUYV closest",
                );
                push_attempt(attempts, width, height, FrameFormat::NV12, true, "1080p NV12");
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::NV12,
                    false,
                    "1080p NV12 closest",
                );
            }
            (1280, 720) => {
                push_attempt(attempts, width, height, FrameFormat::MJPEG, true, "720p MJPEG");
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::MJPEG,
                    false,
                    "720p MJPEG closest",
                );
                push_attempt(attempts, width, height, FrameFormat::YUYV, true, "720p YUYV");
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::YUYV,
                    false,
                    "720p YUYV closest",
                );
                push_attempt(attempts, width, height, FrameFormat::NV12, true, "720p NV12");
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::NV12,
                    false,
                    "720p NV12 closest",
                );
            }
            _ => {
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::MJPEG,
                    true,
                    "640x480 MJPEG",
                );
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::MJPEG,
                    false,
                    "640x480 MJPEG closest",
                );
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::YUYV,
                    true,
                    "640x480 YUYV",
                );
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::YUYV,
                    false,
                    "640x480 YUYV closest",
                );
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::NV12,
                    true,
                    "640x480 NV12",
                );
                push_attempt(
                    attempts,
                    width,
                    height,
                    FrameFormat::NV12,
                    false,
                    "640x480 NV12 closest",
                );
            }
        }
    }

    fn negotiation_attempts(effective_tier: u32) -> Vec<FormatAttempt> {
        let mut attempts = Vec::new();
        if effective_tier >= QUALITY_1080 {
            push_resolution_formats(&mut attempts, 1920, 1080);
        }
        if effective_tier >= QUALITY_720 {
            push_resolution_formats(&mut attempts, 1280, 720);
        }
        push_resolution_formats(&mut attempts, 640, 480);
        attempts
    }

    fn try_attempt(
        index: &CameraIndex,
        attempt: &FormatAttempt,
    ) -> Option<(Camera, StreamFormat, &'static str, u32, u32)> {
        let requested = RequestedFormat::new::<RgbFormat>(attempt.requested);
        let Ok(mut camera) = Camera::new(index.clone(), requested) else {
            return None;
        };
        if camera.open_stream().is_err() {
            return None;
        }
        let format = stream_format_from_camera(&camera);
        if !warm_validate(
            &mut camera,
            format,
            attempt.label,
            attempt.width,
            attempt.height,
        ) {
            let _ = camera.stop_stream();
            return None;
        }
        let (w, h) = (camera.resolution().width_x, camera.resolution().height_y);
        Some((camera, format, attempt.label, w, h))
    }

    fn find_best_stream(
        index: &CameraIndex,
        recording_tier: u32,
        effective_tier: u32,
    ) -> Option<(Camera, StreamFormat, &'static str, u32, u32)> {
        let attempts = negotiation_attempts(effective_tier);
        let (target_w, target_h) = webcam_target_resolution(effective_tier);
        for attempt in &attempts {
            if let Some(result) = try_attempt(index, attempt) {
                let (camera, format, label, w, h) = result;
                crate::log::capture_log(&format!(
                    "Game webcam opened {label} → {w}x{h} {format:?} (target {target_w}x{target_h}, recording tier {recording_tier})"
                ));
                return Some((camera, format, label, w, h));
            }
        }
        crate::log::capture_log(&format!(
            "WARN: game webcam — no mode matched target {target_w}x{target_h} (effective tier {effective_tier})"
        ));
        None
    }

    pub fn start(
        device_id: Option<&str>,
        _target_fps: u32,
        quality: u32,
        orientation: Orientation,
    ) -> Result<(), String> {
        let device_key = device_id.map(str::to_string);
        let recording_tier = webcam_recording_tier(quality, orientation);
        let hw_tier = cached_caps(device_id.as_deref()).map(|c| c.tier);
        let effective_tier = effective_webcam_tier(recording_tier, hw_tier);
        {
            let s = slot().lock();
            if s.thread.is_some()
                && !s.stop.load(Ordering::Relaxed)
                && s.active_device == device_key
                && s.active_quality == effective_tier
                && s.latest.is_some()
            {
                return Ok(());
            }
        }

        schedule_capability_probe(device_id.as_deref());

        stop();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_bg = stop.clone();
        let device_id = device_key.clone();
        let (target_w, target_h) = webcam_target_resolution(effective_tier);
        crate::log::capture_log(&format!(
            "Game webcam capture target {target_w}x{target_h} (recording tier {recording_tier}{})",
            hw_tier
                .map(|t| format!(", hardware max tier {t}"))
                .unwrap_or_default()
        ));

        let thread = std::thread::Builder::new()
            .name("game-webcam".into())
            .spawn(move || {
                let _guard = io_lock();
                let index = parse_index(device_id.as_deref());
                let Some((mut camera, format, label, w, h)) =
                    find_best_stream(&index, recording_tier, effective_tier)
                else {
                    crate::log::capture_log("WARN: game webcam — no usable camera stream");
                    return;
                };
                store_caps(device_id.as_deref(), w, h);
                let mut frames_ok = 0u64;
                let mut decode_failures = 0u32;
                loop {
                    if stop_bg.load(Ordering::Relaxed) {
                        break;
                    }
                    match camera.frame() {
                        Ok(frame) => match decode_frame(&frame, format) {
                            Ok((width, height, bgra)) => {
                                decode_failures = 0;
                                publish_frame(width, height, bgra, label, frames_ok);
                                frames_ok += 1;
                            }
                            Err(e) => {
                                decode_failures = decode_failures.saturating_add(1);
                                if decode_failures == 1 || decode_failures % 120 == 0 {
                                    crate::log::capture_log(&format!(
                                        "WARN: game webcam decode ({decode_failures}x): {e}"
                                    ));
                                }
                            }
                        },
                        Err(_) => std::thread::sleep(Duration::from_millis(8)),
                    }
                }
                let _ = camera.stop_stream();
            })
            .map_err(|e| format!("spawn game-webcam: {e}"))?;

        let mut s = slot().lock();
        s.stop = stop;
        s.thread = Some(thread);
        s.active_device = device_key;
        s.active_quality = effective_tier;
        Ok(())
    }

    pub fn start_for_recording(
        device_id: Option<&str>,
        target_fps: u32,
        quality: u32,
        orientation: Orientation,
        enabled: bool,
    ) {
        if !enabled {
            return;
        }
        schedule_capability_probe(device_id);
        match start(device_id, target_fps, quality, orientation) {
            Ok(()) => {}
            Err(e) => crate::log::capture_log(&format!("WARN: game webcam unavailable ({e})")),
        }
    }

    pub fn stop() {
        let thread = {
            let mut s = slot().lock();
            s.active_device = None;
            s.active_quality = 0;
            s.stop.store(true, Ordering::Relaxed);
            s.thread.take()
        };
        if let Some(t) = thread {
            let _ = t.join();
        }
        slot().lock().latest = None;
    }

    pub fn latest_frame() -> Option<WebcamFrame> {
        slot().lock().latest.clone()
    }

    pub fn is_ready() -> bool {
        slot().lock().latest.is_some()
    }

    pub fn await_ready(timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if is_ready() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(16));
        }
        is_ready()
    }

    fn fill_rect(out: &mut [u8], out_w: u32, out_h: u32, rect: &DestRect, b: u8, g: u8, r: u8) {
        let x0 = rect.x.round().max(0.0) as u32;
        let y0 = rect.y.round().max(0.0) as u32;
        let x1 = (rect.x + rect.w).round().min(out_w as f64) as u32;
        let y1 = (rect.y + rect.h).round().min(out_h as f64) as u32;
        if x1 <= x0 || y1 <= y0 {
            return;
        }
        let stride = out_w as usize * 4;
        for y in y0..y1 {
            let row = y as usize * stride;
            for x in x0..x1 {
                let i = row + x as usize * 4;
                if i + 3 < out.len() {
                    out[i] = b;
                    out[i + 1] = g;
                    out[i + 2] = r;
                    out[i + 3] = 255;
                }
            }
        }
    }

    fn blit_cover(
        out: &mut [u8],
        out_w: u32,
        out_h: u32,
        bounds: &DestRect,
        frame: &WebcamFrame,
    ) {
        let dx = bounds.x.round() as i32;
        let dy = bounds.y.round() as i32;
        let dw = bounds.w.round().max(1.0) as u32;
        let dh = bounds.h.round().max(1.0) as u32;
        if out_w == 0 || out_h == 0 || dw == 0 || dh == 0 {
            return;
        }

        let src_w = frame.width.max(1);
        let src_h = frame.height.max(1);
        let (crop_x, crop_y, crop_w, crop_h) = cover_src_crop(src_w, src_h, bounds);
        let src = frame.bgra.as_ref();
        let src_row = (src_w as usize) * 4;
        let out_stride = out_w as usize * 4;

        for row in 0..dh {
            let dst_y = dy + row as i32;
            if dst_y < 0 || dst_y as u32 >= out_h {
                continue;
            }
            let sy = crop_y + (row as f64 + 0.5) * crop_h / dh as f64;
            let sy = sy.floor().clamp(0.0, src_h as f64 - 1.0) as u32;
            let src_row_off = (sy as usize) * src_row;
            let dst_row_off = dst_y as u32 as usize * out_stride;
            for col in 0..dw {
                let dst_x = dx + col as i32;
                if dst_x < 0 || dst_x as u32 >= out_w {
                    continue;
                }
                let sx = crop_x + (col as f64 + 0.5) * crop_w / dw as f64;
                let sx = sx.floor().clamp(0.0, src_w as f64 - 1.0) as u32;
                let src_idx = src_row_off + (sx as usize) * 4;
                let dst_idx = dst_row_off + dst_x as u32 as usize * 4;
                if src_idx + 3 < src.len() && dst_idx + 3 < out.len() {
                    out[dst_idx..dst_idx + 4].copy_from_slice(&src[src_idx..src_idx + 4]);
                }
            }
        }
    }

    pub fn stamp_into_bgra(
        out: &mut [u8],
        out_w: u32,
        out_h: u32,
        dest: &DestRect,
        frame: &WebcamFrame,
    ) {
        let expected = (out_w as usize) * (out_h as usize) * 4;
        if out.len() < expected {
            return;
        }
        fill_rect(out, out_w, out_h, dest, 0, 0, 0);
        blit_cover(out, out_w, out_h, dest, frame);
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn stamp_writes_non_black_pixels() {
            let mut out = vec![0u8; 720 * 1280 * 4];
            let frame = WebcamFrame {
                width: 4,
                height: 4,
                bgra: Arc::new(vec![255, 128, 64, 255].repeat(16)),
            };
            let dest = DestRect {
                x: 0.0,
                y: 0.0,
                w: 720.0,
                h: 358.0,
            };
            stamp_into_bgra(&mut out, 720, 1280, &dest, &frame);
            let strip = &out[0..(720 * 358 * 4)];
            assert!(strip.iter().any(|&b| b > 0), "strip should contain webcam pixels");
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    pub fn list_devices() -> Vec<WebcamDeviceInfo> {
        Vec::new()
    }

    pub fn schedule_capability_probe(_device_id: Option<&str>) {}

    pub fn start(
        _device_id: Option<&str>,
        _target_fps: u32,
        _quality: u32,
        _orientation: Orientation,
    ) -> Result<(), String> {
        Err("Webcam split is only available on Windows".into())
    }

    pub fn start_for_recording(
        _device_id: Option<&str>,
        _target_fps: u32,
        _quality: u32,
        _orientation: Orientation,
        _enabled: bool,
    ) {
    }

    pub fn stop() {}

    pub fn latest_frame() -> Option<WebcamFrame> {
        None
    }

    pub fn is_ready() -> bool {
        false
    }

    pub fn await_ready(_timeout: Duration) -> bool {
        false
    }

    pub fn stamp_into_bgra(
        _out: &mut [u8],
        _out_w: u32,
        _out_h: u32,
        _dest: &DestRect,
        _frame: &WebcamFrame,
    ) {
    }
}

pub use imp::{
    await_ready, is_ready, latest_frame, list_devices, schedule_capability_probe, stamp_into_bgra,
    start, start_for_recording, stop,
};

#[cfg(test)]
mod tier_tests {
    use super::*;
    use crate::state::Orientation;

    #[test]
    fn recording_tier_caps_at_1080_for_4k() {
        assert_eq!(
            webcam_recording_tier(2160, Orientation::Landscape),
            QUALITY_1080
        );
    }

    #[test]
    fn effective_tier_never_exceeds_recording() {
        assert_eq!(
            effective_webcam_tier(QUALITY_720, Some(QUALITY_1080)),
            QUALITY_720
        );
    }

    #[test]
    fn effective_tier_never_exceeds_hardware() {
        assert_eq!(
            effective_webcam_tier(QUALITY_1080, Some(QUALITY_720)),
            QUALITY_720
        );
    }

    #[test]
    fn resolution_meets_target_rejects_vga_for_720() {
        let meets = |aw, ah, tw, th| {
            let actual = aw as u64 * ah as u64;
            let target = tw as u64 * th as u64;
            actual * 100 >= target * 85
        };
        assert!(!meets(640, 480, 1280, 720));
        assert!(meets(1280, 720, 1280, 720));
    }
}
