//! GPU screen capture pipeline (Windows Graphics Capture).
//!
//! WGC â†’ GPU crop+scale â†’ hardware HEVC MP4 (record) + FFmpeg H.264 RTMP (stream).

use crate::state::{SharedState, SharedViewport};
use std::path::PathBuf;
use std::sync::OnceLock;

#[cfg(windows)]
static SHARED_VIEWPORT: OnceLock<SharedViewport> = OnceLock::new();

#[cfg(windows)]
pub fn bind_viewport(viewport: SharedViewport) {
    let _ = SHARED_VIEWPORT.set(viewport);
}

#[cfg(not(windows))]
pub fn bind_viewport(_viewport: SharedViewport) {}

#[derive(Debug)]
pub enum CaptureError {
    Unsupported,
    Other(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::Unsupported => write!(f, "capture not supported on this platform"),
            CaptureError::Other(s) => write!(f, "{s}"),
        }
    }
}

impl std::error::Error for CaptureError {}

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::geometry::{frame_layout, output_dims};
    use crate::gpu_scale::GpuScaler;
    use crate::state::Orientation;
    use crate::camera::{self, camera_connected, camera_sink};
    use crate::file_record::{effective_recording_fps, FileRecorder, publish_capture_frame};
    use crate::recordings::new_recording_path;
    use crate::state::Viewport;
    use crate::stream::{StreamConfig, StreamPipeline};
    use parking_lot::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
    use std::sync::{Arc, OnceLock};
    use std::thread::JoinHandle;
    use std::time::{Duration, Instant};

    use crate::log::capture_log;

    use tauri::Emitter;

    struct SaveProgressGuard;

    impl Drop for SaveProgressGuard {
        fn drop(&mut self) {
            crate::save_progress::end_timing();
            crate::save_progress::set_reporter(None);
        }
    }

    use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11DeviceContext};

    use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::monitor::Monitor;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    };

    type HandlerError = Box<dyn std::error::Error + Send + Sync>;
    type Control = CaptureControl<Handler, HandlerError>;

    static CONTROL: OnceLock<Mutex<Option<Control>>> = OnceLock::new();
    static STREAM_SINK: OnceLock<Arc<Mutex<Option<StreamPipeline>>>> = OnceLock::new();
    static FILE_RECORDER: OnceLock<Mutex<Option<Arc<FileRecorder>>>> = OnceLock::new();
    static LAST_CAPTURE_FRAME_MS: AtomicU64 = AtomicU64::new(0);
    static GPU_SCALE_LOG_MS: AtomicU64 = AtomicU64::new(0);
    static WGC_FRAMES_WINDOW: AtomicU64 = AtomicU64::new(0);
    static REC_CAPTURE_RENDERS_WINDOW: AtomicU64 = AtomicU64::new(0);
    static REC_GLIDE_RENDERS_WINDOW: AtomicU64 = AtomicU64::new(0);
    static PROF_WGC_HANDLERS: AtomicU64 = AtomicU64::new(0);
    static PROF_RENDER_US: AtomicU64 = AtomicU64::new(0);
    static PROF_READ_US: AtomicU64 = AtomicU64::new(0);
    static PROF_HANDLER_US: AtomicU64 = AtomicU64::new(0);
    static ENC_QUEUE_DEPTH: AtomicU64 = AtomicU64::new(0);
    static LAST_PREVIEW_RENDER_MS: AtomicU64 = AtomicU64::new(0);
    static FIRST_REC_FRAME_LOGGED: AtomicBool = AtomicBool::new(false);

    struct RecordingGlidePulse {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    impl RecordingGlidePulse {
        fn empty() -> Self {
            Self {
                stop: Arc::new(AtomicBool::new(true)),
                thread: None,
            }
        }
    }

    static REC_GLIDE_PULSE: OnceLock<Mutex<RecordingGlidePulse>> = OnceLock::new();

    fn glide_pulse_slot() -> &'static Mutex<RecordingGlidePulse> {
        REC_GLIDE_PULSE.get_or_init(|| Mutex::new(RecordingGlidePulse::empty()))
    }

    #[cfg(windows)]
    fn boost_glide_thread_priority() {
        use windows::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL,
        };
        unsafe {
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
        }
    }

    #[cfg(not(windows))]
    fn boost_glide_thread_priority() {}

    /// Re-crop the cached monitor texture when pan/zoom moves between WGC frames.
    /// Runs on a dedicated pulse thread; D3D work is serialized through `gpu_bridge`.
    fn recording_glide_loop(state: SharedState, stop: Arc<AtomicBool>, period: Duration) {
        boost_glide_thread_priority();
        while !stop.load(Ordering::Relaxed) {
            let tick = Instant::now();

            if !state.lock().recording {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }

            if viewport_changed_since_last_render() {
                if let Some(mut bridge) = gpu_bridge().try_lock() {
                    if bridge.ready {
                        if let Some(bgra) = render_from_cache(&mut bridge, &state, None, true) {
                            publish_capture_frame(bgra);
                            REC_CAPTURE_RENDERS_WINDOW.fetch_add(1, Ordering::Relaxed);
                            REC_GLIDE_RENDERS_WINDOW.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
            }

            let wait = period.saturating_sub(tick.elapsed());
            if wait > Duration::ZERO {
                std::thread::sleep(wait);
            } else {
                std::thread::yield_now();
            }
        }
    }

    fn start_recording_glide_pulse(state: SharedState, fps: u32) {
        stop_recording_glide_pulse();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = stop.clone();
        let period = Duration::from_nanos(1_000_000_000 / fps.max(1) as u64);
        let handle = std::thread::Builder::new()
            .name("rec-glide".into())
            .spawn(move || recording_glide_loop(state, stop_flag, period))
            .ok();
        if let Some(handle) = handle {
            *glide_pulse_slot().lock() = RecordingGlidePulse {
                stop,
                thread: Some(handle),
            };
            capture_log(&format!(
                "Recording viewport-glide pulse @ {fps}Hz (re-crop on pan/zoom between WGC frames)"
            ));
        }
    }

    fn stop_recording_glide_pulse() {
        let mut slot = glide_pulse_slot().lock();
        slot.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = slot.thread.take() {
            let _ = handle.join();
        }
        *slot = RecordingGlidePulse::empty();
    }

    struct PacedOutput {
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    impl PacedOutput {
        fn empty() -> Self {
            Self {
                stop: Arc::new(AtomicBool::new(true)),
                thread: None,
            }
        }
    }

    static PACED_OUTPUT: OnceLock<Mutex<PacedOutput>> = OnceLock::new();

    fn paced_output_slot() -> &'static Mutex<PacedOutput> {
        PACED_OUTPUT.get_or_init(|| Mutex::new(PacedOutput::empty()))
    }

    fn wait_until(deadline: Instant) {
        loop {
            let now = Instant::now();
            if now >= deadline {
                return;
            }
            let remaining = deadline - now;
            if remaining > Duration::from_millis(2) {
                std::thread::sleep(remaining - Duration::from_millis(1));
            } else {
                std::hint::spin_loop();
            }
        }
    }

    fn shared_viewport() -> &'static SharedViewport {
        SHARED_VIEWPORT
            .get()
            .expect("viewport not bound — call capture::bind_viewport at startup")
    }

    fn viewport_orientation() -> Orientation {
        shared_viewport().lock().viewport.orientation
    }

    fn capture_output_dims(state: &SharedState) -> (u32, u32) {
        let st = state.lock();
        output_dims(viewport_orientation(), st.recording_settings.quality)
    }

    fn ensure_gpu_scaler(
        device: &ID3D11Device,
        state: &SharedState,
        bridge: &mut GpuBridge,
    ) -> Result<(), String> {
        let (out_w, out_h) = capture_output_dims(state);
        let needs_new = match bridge.scaler.as_ref() {
            Some(s) => s.dimensions() != (out_w, out_h),
            None => true,
        };
        if needs_new {
            bridge.scaler = Some(GpuScaler::new(device, out_w, out_h)?);
            capture_log(&format!("GPU scaler → {out_w}×{out_h}"));
        }
        Ok(())
    }

    /// Keep the GPU scaler + virtual camera aligned with recording settings while capture runs.
    pub fn sync_output_dimensions(state: SharedState) -> Result<(), CaptureError> {
        let (out_w, out_h, fps, camera_on) = {
            let mut st = state.lock();
            let (w, h) = output_dims(viewport_orientation(), st.recording_settings.quality);
            st.current_dims = (w, h);
            (w, h, st.recording_settings.fps.max(1), st.camera_enabled)
        };

        {
            let mut bridge = gpu_bridge().lock();
            if let Some(device) = bridge.device.clone() {
                ensure_gpu_scaler(&device, &state, &mut bridge)
                    .map_err(CaptureError::Other)?;
            } else {
                bridge.scaler = None;
            }
        }

        if camera_on {
            camera::stop_camera();
            camera::start_camera(out_w, out_h, fps).map_err(CaptureError::Other)?;
        }
        Ok(())
    }

    pub fn render_output_frame(state: &SharedState) -> Option<Vec<u8>> {
        let mut bridge = gpu_bridge().lock();
        render_with_bridge(&mut bridge, state)
    }

    fn render_with_bridge(bridge: &mut GpuBridge, state: &SharedState) -> Option<Vec<u8>> {
        render_from_cache(bridge, state, None, false)
    }

    fn flush_gpu_readback_pipeline() {
        let mut bridge = gpu_bridge().lock();
        if let (Some(ctx), Some(scaler)) = (bridge.context.clone(), bridge.scaler.as_mut()) {
            if let Some(bgra) = scaler.flush_pipelined_readback(&ctx) {
                publish_capture_frame(bgra);
            }
            scaler.reset_readback_pipeline();
        }
    }

    pub fn recording_viewport_context() -> (crate::state::Viewport, u32, u32) {
        let vs = shared_viewport().lock();
        let (sw, sh) = vs
            .monitor
            .as_ref()
            .map(|m| (m.width, m.height))
            .unwrap_or((1920, 1080));
        (vs.viewport, sw, sh)
    }

    fn wgc_cursor_settings(state: &SharedState) -> CursorCaptureSettings {
        let st = state.lock();
        if !st.recording_settings.capture_cursor {
            return CursorCaptureSettings::WithoutCursor;
        }
        if st.recording_settings.cinematic_cursor {
            CursorCaptureSettings::WithoutCursor
        } else {
            CursorCaptureSettings::WithCursor
        }
    }

    /// Crop the monitor into output pixels. When `live_tex` is set (WGC hot path), copy
    /// from the fresh frame once; otherwise re-crop the cached `src_copy` (viewport glide).
    /// Pipelined readback is used only for glide re-crops — WGC always reads synchronously
    /// so the cursor is not delayed by one frame (which causes visible skip/stutter).
    fn render_from_cache(
        bridge: &mut GpuBridge,
        state: &SharedState,
        live_tex: Option<&windows::Win32::Graphics::Direct3D11::ID3D11Texture2D>,
        pipelined: bool,
    ) -> Option<Vec<u8>> {
        if !bridge.ready {
            return None;
        }
        let vp = shared_viewport().lock().viewport;
        let ctx = bridge.context.clone()?;
        let device = bridge.device.clone()?;
        let src_w = bridge.src_w;
        let src_h = bridge.src_h;
        ensure_gpu_scaler(&device, state, bridge).ok()?;
        let scaler = bridge.scaler.as_mut()?;
        let layout = frame_layout(&vp, src_w, src_h, scaler.dimensions().0, scaler.dimensions().1);

        // Glide-only pipelining: pan/zoom re-crops overlap readback; WGC needs same-frame cursor.
        let use_pipeline = pipelined && live_tex.is_none();

        if use_pipeline {
            let prev = scaler.take_pipelined_readback(&ctx);

            let draw = scaler.render_cached(&ctx, src_w, src_h, &layout);
            draw.ok()?;
            scaler.queue_readback(&ctx);

            if let Some(bgra) = prev {
                remember_vp(bridge, &vp);
                return Some(bgra);
            }
            return None;
        }

        let t_render = Instant::now();
        let draw = if let Some(tex) = live_tex {
            scaler.render(&ctx, &device, tex, src_w, src_h, &layout)
        } else {
            scaler.render_cached(&ctx, src_w, src_h, &layout)
        };
        draw.ok()?;
        let render_us = t_render.elapsed().as_micros() as u64;

        let t_read = Instant::now();
        let bgra = scaler.read_bgra(&ctx).ok()?;
        if live_tex.is_some() {
            PROF_RENDER_US.fetch_add(render_us, Ordering::Relaxed);
            PROF_READ_US.fetch_add(t_read.elapsed().as_micros() as u64, Ordering::Relaxed);
        }

        remember_vp(bridge, &vp);
        Some(bgra)
    }

    fn paced_output_loop(state: SharedState, stop: Arc<AtomicBool>) {
        let mut next_tick = Instant::now();
        let mut last_bgra: Option<Vec<u8>> = None;

        while !stop.load(Ordering::Relaxed) {
            let (recording, streaming, feed_cam, fps_setting) = {
                let st = state.lock();
                // NOTE: compute feed_cam from the guard we already hold. Calling
                // should_feed_virtual_camera(&state) here would re-lock `state` on
                // the same thread — parking_lot is non-reentrant, so that self-
                // deadlocks while holding `state`, freezing the whole app (the
                // AppHangB1 766f hang at recording start).
                let feed_cam = st.camera_enabled
                    && !st.recording
                    && !st.recording_armed
                    && crate::camera::camera_connected();
                (
                    st.recording,
                    st.streaming,
                    feed_cam,
                    st.recording_settings.fps.max(1),
                )
            };
            if !recording && !streaming && !feed_cam {
                std::thread::sleep(Duration::from_millis(10));
                next_tick = Instant::now();
                last_bgra = None;
                continue;
            }

            let target_fps = if streaming {
                fps_setting
            } else {
                fps_setting.min(30).max(1)
            };
            let period = Duration::from_nanos(1_000_000_000 / target_fps as u64);

            // While recording, the file-recorder thread renders at CFR from the GPU cache.
            if recording {
                std::thread::sleep(period);
                continue;
            }

            // Camera/stream preview renders on the WGC thread (same D3D context as ingest).
            if streaming || feed_cam {
                std::thread::sleep(Duration::from_millis(50));
                continue;
            }

            wait_until(next_tick);

            let bgra = match render_output_frame(&state) {
                Some(b) => b,
                None => match last_bgra.clone() {
                    Some(b) => b,
                    None => {
                        next_tick += period;
                        continue;
                    }
                },
            };
            last_bgra = Some(bgra.clone());
            dispatch_preview_outputs(bgra, streaming, &state);
            LAST_CAPTURE_FRAME_MS.store(now_ms(), Ordering::Relaxed);

            next_tick += period;
            if next_tick + period * 3 < Instant::now() {
                next_tick = Instant::now() + period;
            }
        }
    }

    fn start_paced_output(state: SharedState) {
        stop_paced_output();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = stop.clone();
        let handle = std::thread::Builder::new()
            .name("paced-output".into())
            .spawn(move || paced_output_loop(state, stop_flag))
            .ok();
        if let Some(handle) = handle {
            *paced_output_slot().lock() = PacedOutput {
                stop,
                thread: Some(handle),
            };
        }
    }

    fn stop_paced_output() {
        let mut slot = paced_output_slot().lock();
        slot.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = slot.thread.take() {
            let _ = handle.join();
        }
        *slot = PacedOutput::empty();
    }

    struct GpuBridge {
        scaler: Option<GpuScaler>,
        device: Option<ID3D11Device>,
        context: Option<ID3D11DeviceContext>,
        src_w: u32,
        src_h: u32,
        ready: bool,
        last_wgc_ms: AtomicU64,
        last_vp_x: f64,
        last_vp_y: f64,
        last_vp_zoom: f64,
    }

    impl Default for GpuBridge {
        fn default() -> Self {
            Self {
                scaler: None,
                device: None,
                context: None,
                src_w: 0,
                src_h: 0,
                ready: false,
                last_wgc_ms: AtomicU64::new(0),
                last_vp_x: 0.0,
                last_vp_y: 0.0,
                last_vp_zoom: 1.0,
            }
        }
    }

    static GPU_BRIDGE: OnceLock<Mutex<GpuBridge>> = OnceLock::new();

    fn gpu_bridge() -> &'static Mutex<GpuBridge> {
        GPU_BRIDGE.get_or_init(|| Mutex::new(GpuBridge::default()))
    }

    fn clear_gpu_bridge() {
        *gpu_bridge().lock() = GpuBridge::default();
    }

    fn remember_vp(bridge: &mut GpuBridge, vp: &Viewport) {
        bridge.last_vp_x = vp.x;
        bridge.last_vp_y = vp.y;
        bridge.last_vp_zoom = vp.zoom;
    }

    fn viewport_changed_on_bridge(bridge: &GpuBridge, vp: &Viewport) -> bool {
        (vp.x - bridge.last_vp_x).abs() > 0.5
            || (vp.y - bridge.last_vp_y).abs() > 0.5
            || (vp.zoom - bridge.last_vp_zoom).abs() > 0.002
    }

    /// True when pan/zoom moved since the last recording render (skip redundant GPU readbacks).
    pub fn viewport_changed_since_last_render() -> bool {
        let bridge = gpu_bridge().lock();
        let vp = shared_viewport().lock().viewport;
        viewport_changed_on_bridge(&bridge, &vp)
    }

    fn preview_render_interval_ms(streaming: bool, camera_connected: bool, fps: u32) -> u64 {
        if streaming {
            1000 / fps.max(1) as u64
        } else if !camera_connected {
            500
        } else {
            1000 / 24
        }
    }

    fn should_feed_virtual_camera(state: &SharedState) -> bool {
        let st = state.lock();
        st.camera_enabled
            && !st.recording
            && !st.recording_armed
            && crate::camera::camera_connected()
    }

    fn wgc_should_run(state: &SharedState) -> bool {
        let st = state.lock();
        if st.recording || st.streaming {
            return true;
        }
        if st.recording_armed {
            return false;
        }
        st.camera_enabled && crate::camera::camera_connected()
    }

    fn dispatch_preview_outputs(bgra: Vec<u8>, streaming: bool, state: &SharedState) {
        if should_feed_virtual_camera(state) {
            if let Some(cam) = camera_sink().lock().as_mut() {
                cam.send_bgra(&bgra);
            }
        }
        if streaming {
            if let Some(stream) = stream_sink().lock().as_ref() {
                stream.push_frame(bgra);
            }
        }
    }

    pub fn dispatch_recording_outputs(bgra: Vec<u8>, state: &SharedState) {
        let streaming = state.lock().streaming;
        dispatch_preview_outputs(bgra, streaming, state);
    }

    fn log_gpu_scale_warn(msg: &str) {
        let now = now_ms();
        if now.saturating_sub(GPU_SCALE_LOG_MS.load(Ordering::Relaxed)) > 5000 {
            GPU_SCALE_LOG_MS.store(now, Ordering::Relaxed);
            capture_log(msg);
        }
    }

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn recorder_slot() -> &'static Mutex<Option<Arc<FileRecorder>>> {
        FILE_RECORDER.get_or_init(|| Mutex::new(None))
    }

    fn active_recorder() -> Option<Arc<FileRecorder>> {
        recorder_slot().lock().clone()
    }

    fn open_recorder(
        path: &std::path::Path,
        out_w: u32,
        out_h: u32,
        fps: u32,
        bitrate_kbps: u32,
        state: SharedState,
    ) -> Result<(), CaptureError> {
        if recorder_slot().lock().is_some() {
            return Err(CaptureError::Other("recorder already active".into()));
        }
        let rec = FileRecorder::start(path, out_w, out_h, fps, bitrate_kbps, state)
            .map_err(CaptureError::Other)?;
        *recorder_slot().lock() = Some(rec);
        Ok(())
    }

    fn close_recorder() -> Result<(u64, u64, f64), CaptureError> {
        stop_recording_glide_pulse();
        flush_gpu_readback_pipeline();
        let rec = recorder_slot().lock().take();
        let Some(rec) = rec else {
            return Ok((0, 0, 0.0));
        };
        match rec.finish() {
            Ok((written, bytes, duration)) => {
                capture_log(&format!(
                    "Recording closed: {written} frames muxed, {duration:.2}s, {bytes} bytes"
                ));
                Ok((written, bytes, duration))
            }
            Err(e) => Err(CaptureError::Other(e)),
        }
    }

    fn recording_dims(state: &SharedState) -> (u32, u32, u32, u32) {
        let st = state.lock();
        let (out_w, out_h) =
            output_dims(viewport_orientation(), st.recording_settings.quality);
        let requested = st.recording_settings.fps.max(1);
        let fps = effective_recording_fps(requested, out_w, out_h);
        let bitrate_kbps = (broadcast_bitrate(out_w, out_h, fps) / 1000).max(500);
        (out_w, out_h, fps, bitrate_kbps)
    }

    fn control_slot() -> &'static Mutex<Option<Control>> {
        CONTROL.get_or_init(|| Mutex::new(None))
    }

    fn stream_sink() -> &'static Arc<Mutex<Option<StreamPipeline>>> {
        STREAM_SINK.get_or_init(|| Arc::new(Mutex::new(None)))
    }

    fn broadcast_bitrate(w: u32, h: u32, fps: u32) -> u32 {
        let fps = fps.max(1);
        let bps = match (w, h, fps) {
            (720, 1280, 30) => 8_000_000,
            (720, 1280, 60) => 12_000_000,
            (1080, 1920, 30) => 15_000_000,
            (1080, 1920, 60) => 25_000_000,
            (1920, 1080, 30) => 15_000_000,
            (1920, 1080, 60) => 25_000_000,
            _ => {
                let bpp = if w <= 720 { 0.18 } else { 0.16 };
                ((w as u64 * h as u64 * fps as u64) as f64 * bpp)
                    .clamp(6_000_000.0, 30_000_000.0) as u32
            }
        };
        bps
    }

    pub struct Flags {
        state: SharedState,
        out_w: u32,
        out_h: u32,
    }

    struct Handler {
        state: SharedState,
        out_w: u32,
        out_h: u32,
    }

    impl GraphicsCaptureApiHandler for Handler {
        type Flags = Flags;
        type Error = HandlerError;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            let f = ctx.flags;
            Ok(Self {
                state: f.state,
                out_w: f.out_w,
                out_h: f.out_h,
            })
        }

        fn on_frame_arrived(
            &mut self,
            frame: &mut Frame,
            capture_control: InternalCaptureControl,
        ) -> Result<(), Self::Error> {
            if !wgc_should_run(&self.state) {
                capture_control.stop();
                return Ok(());
            }

            let t_handler = Instant::now();
            let src_w = frame.width();
            let src_h = frame.height();

            let (recording, streaming, feed_cam, fps) = {
                let st = self.state.lock();
                let feed_cam = st.camera_enabled
                    && !st.recording
                    && !st.recording_armed
                    && crate::camera::camera_connected();
                (
                    st.recording,
                    st.streaming,
                    feed_cam,
                    st.recording_settings.fps.max(1),
                )
            };

            if !recording && !streaming && !feed_cam {
                return Ok(());
            }

            if !recording && (streaming || feed_cam) {
                let interval = preview_render_interval_ms(streaming, feed_cam, fps);
                let now = now_ms();
                let last = LAST_PREVIEW_RENDER_MS.load(Ordering::Relaxed);
                if now.saturating_sub(last) >= interval {
                    LAST_PREVIEW_RENDER_MS.store(now, Ordering::Relaxed);
                } else {
                    return Ok(());
                }
            }

            let mut bridge = gpu_bridge().lock();
            bridge.device = Some(frame.device().clone());
            bridge.context = Some(frame.device_context().clone());
            ensure_gpu_scaler(frame.device(), &self.state, &mut bridge)
                .map_err(|e| format!("GPU scaler init: {e}"))?;
            bridge.src_w = src_w;
            bridge.src_h = src_h;
            bridge.ready = true;

            bridge.last_wgc_ms.store(now_ms(), Ordering::Relaxed);
            WGC_FRAMES_WINDOW.fetch_add(1, Ordering::Relaxed);

            let src_tex = frame.as_raw_texture();
            let live = Some(src_tex);

            if recording {
                if let Some(bgra) = render_from_cache(&mut bridge, &self.state, live, true) {
                    if streaming {
                        if let Some(stream) = stream_sink().lock().as_ref() {
                            stream.push_frame(bgra.clone());
                        }
                    }
                    publish_capture_frame(bgra);
                    REC_CAPTURE_RENDERS_WINDOW.fetch_add(1, Ordering::Relaxed);
                    if !FIRST_REC_FRAME_LOGGED.swap(true, Ordering::Relaxed) {
                        capture_log("First recording frame published to encoder");
                    }
                }
            } else if streaming || feed_cam {
                if let Some(bgra) = render_from_cache(&mut bridge, &self.state, live, false) {
                    dispatch_preview_outputs(bgra, streaming, &self.state);
                }
            }

            PROF_HANDLER_US.fetch_add(t_handler.elapsed().as_micros() as u64, Ordering::Relaxed);
            PROF_WGC_HANDLERS.fetch_add(1, Ordering::Relaxed);

            Ok(())
        }

        fn on_closed(&mut self) -> Result<(), Self::Error> {
            Ok(())
        }
    }

    impl Drop for Handler {
        fn drop(&mut self) {
            let (recording, streaming, camera) = {
                let st = self.state.lock();
                (st.recording, st.streaming, st.camera_enabled)
            };
            // Explicit stop_recording / stop_streaming / stop_camera finalize while the session
            // stays alive; only clean up here when that side of the session has ended.
            if !recording {
                let _ = close_recorder();
            }
            if !streaming {
                stream_sink().lock().take();
            }
            if !camera {
                camera::stop_camera();
            }
            capture_log("Capture handler stopped");
        }
    }

    fn stream_config(state: &SharedState) -> Result<StreamConfig, CaptureError> {
        let st = state.lock();
        let (out_w, out_h) =
            output_dims(viewport_orientation(), st.recording_settings.quality);
        Ok(StreamConfig {
            server_url: st.stream_settings.server_url.clone(),
            stream_key: st.stream_settings.stream_key.clone(),
            width: out_w,
            height: out_h,
            fps: st.recording_settings.fps.max(1),
            bitrate_kbps: st.stream_settings.bitrate_kbps,
        })
    }

    pub fn attach_stream(state: SharedState) -> Result<(), CaptureError> {
        if !capture_already_running() {
            return start_streaming(state);
        }
        {
            let st = state.lock();
            if st.streaming {
                return Ok(());
            }
            if !st.recording {
                return Err(CaptureError::Other("capture is not recording".into()));
            }
            if st.stream_settings.stream_key.trim().is_empty() {
                return Err(CaptureError::Other("stream key is required".into()));
            }
        }
        let pipeline =
            StreamPipeline::start(stream_config(&state)?, Some(state.clone())).map_err(CaptureError::Other)?;
        *stream_sink().lock() = Some(pipeline);
        {
            let mut st = state.lock();
            st.streaming = true;
            st.stream_start = Some(Instant::now());
            st.stream_stats.connected = true;
            st.stream_stats.error = None;
        }
        Ok(())
    }

    pub fn attach_recording(state: SharedState) -> Result<(), CaptureError> {
        if !capture_already_running() {
            return start_recording(state);
        }
        {
            let st = state.lock();
            if st.recording {
                return Ok(());
            }
            if !st.streaming && !st.camera_enabled {
                return Err(CaptureError::Other("capture is not active".into()));
            }
        }
        let viewport = shared_viewport().lock().viewport;
        let path = new_recording_path(viewport.orientation);
        sync_output_dimensions(state.clone())?;
        let (out_w, out_h, fps, bitrate_kbps) = recording_dims(&state);
        open_recorder(&path, out_w, out_h, fps, bitrate_kbps, state.clone())?;
        {
            let mut st = state.lock();
            st.recording = true;
            st.current_path = Some(path);
            st.current_dims = (out_w, out_h);
        }
        refresh_capture_session(state.clone())?;
        capture_log("Arming file recorder");
        Ok(())
    }

    fn begin_capture(
        state: SharedState,
        record_path: Option<PathBuf>,
        stream: Option<StreamPipeline>,
    ) -> Result<(), CaptureError> {
        let has_stream = stream.is_some();
        *stream_sink().lock() = stream;
        let settings_snapshot = {
            let st = state.lock();
            st.recording_settings
        };

        let viewport = shared_viewport().lock().viewport;
        let (out_w, out_h) = output_dims(viewport.orientation, settings_snapshot.quality);
        let requested_fps = settings_snapshot.fps.max(1);
        let record_fps = effective_recording_fps(requested_fps, out_w, out_h);
        let recording_active = state.lock().recording;
        let wgc_fps = if record_path.is_some() || has_stream || recording_active {
            requested_fps
        } else {
            // Camera-only idle: lower WGC rate until recording — saves GPU + WebView breathing room.
            requested_fps.min(20).max(10)
        };
        let record_bitrate = broadcast_bitrate(out_w, out_h, record_fps);
        let bitrate_kbps = (record_bitrate / 1000).max(500);

        if let Some(ref path) = record_path {
            FIRST_REC_FRAME_LOGGED.store(false, Ordering::Relaxed);
            open_recorder(path, out_w, out_h, record_fps, bitrate_kbps, state.clone())?;
            if record_fps != requested_fps {
                capture_log(&format!(
                    "Recording CFR capped at {record_fps}fps (requested {requested_fps}fps) for reliable A/V sync at {}x{}",
                    out_w, out_h
                ));
            }
            capture_log(&format!(
                "Recording to {} ({}x{} @ {}fps)",
                path.display(),
                out_w,
                out_h,
                record_fps
            ));
        }

        let cursor = wgc_cursor_settings(&state);
        if record_path.is_some() && settings_snapshot.capture_cursor && settings_snapshot.cinematic_cursor {
            capture_log("Cinematic cursor armed (WGC without system pointer; stamped per CFR slot)");
        }
        let monitor = Monitor::primary().map_err(|e| CaptureError::Other(format!("no primary monitor: {e:?}")))?;

        let min_interval = std::time::Duration::from_nanos(1_000_000_000 / wgc_fps as u64);
        let recording_with_cursor = settings_snapshot.capture_cursor
            && settings_snapshot.cinematic_cursor
            && (record_path.is_some() || has_stream || recording_active);
        let dirty = if recording_with_cursor {
            DirtyRegionSettings::ReportAndRender
        } else {
            DirtyRegionSettings::Default
        };

        let build_settings = |dirty: DirtyRegionSettings| {
            Settings::new(
                monitor,
                cursor,
                DrawBorderSettings::WithoutBorder,
                SecondaryWindowSettings::Default,
                MinimumUpdateIntervalSettings::Custom(min_interval),
                dirty,
                ColorFormat::Bgra8,
                Flags {
                    state: state.clone(),
                    out_w,
                    out_h,
                },
            )
        };

        let start_result = Handler::start_free_threaded(build_settings(dirty)).or_else(|e| {
            if dirty == DirtyRegionSettings::Default {
                Err(e)
            } else {
                capture_log(
                    "WGC dirty-region mode unavailable on this system; using default capture",
                );
                Handler::start_free_threaded(build_settings(DirtyRegionSettings::Default))
            }
        });

        match start_result {
            Ok(control) => {
                *control_slot().lock() = Some(control);
                start_paced_output(state.clone());
                if record_path.is_some() || state.lock().recording {
                    let glide_fps = if record_path.is_some() {
                        record_fps
                    } else {
                        effective_recording_fps(
                            state.lock().recording_settings.fps.max(1),
                            out_w,
                            out_h,
                        )
                    };
                    start_recording_glide_pulse(state, glide_fps);
                }
                Ok(())
            }
            Err(e) => {
                if record_path.is_some() {
                    let _ = close_recorder();
                }
                Err(CaptureError::Other(format!("capture start failed: {e:?}")))
            }
        }
    }

    fn capture_already_running() -> bool {
        control_slot().lock().is_some()
    }

    /// Restart WGC if the session died while control is still registered.
    fn refresh_capture_session(state: SharedState) -> Result<(), CaptureError> {
        if capture_already_running() {
            stop_capture();
        }
        begin_capture(state, None, None)
    }

    pub fn register_virtual_camera(state: SharedState) -> Result<(), CaptureError> {
        if camera_sink().lock().is_some() {
            state.lock().camera_enabled = true;
            return Ok(());
        }

        let settings = {
            let st = state.lock();
            st.recording_settings
        };
        let viewport = shared_viewport().lock().viewport;

        let (out_w, out_h) = output_dims(viewport.orientation, settings.quality);
        let fps = settings.fps.max(1);
        camera::start_camera(out_w, out_h, fps).map_err(CaptureError::Other)?;

        {
            let mut st = state.lock();
            st.camera_enabled = true;
            st.camera_connected = false;
            st.current_dims = (out_w, out_h);
        }
        Ok(())
    }

    static CAM_CONNECTED_STREAK: AtomicU8 = AtomicU8::new(0);

    /// Start/stop WGC based on demand — recording, streaming, or a connected virtual camera client.
    pub fn ensure_capture_session(state: SharedState) {
        let (recording, streaming, armed, camera_on, connected) = {
            let mut st = state.lock();
            if st.camera_enabled {
                st.camera_connected = crate::camera::camera_connected();
            }
            (
                st.recording,
                st.streaming,
                st.recording_armed,
                st.camera_enabled,
                st.camera_connected,
            )
        };

        let need = if recording || streaming {
            CAM_CONNECTED_STREAK.store(0, Ordering::Relaxed);
            true
        } else if armed {
            CAM_CONNECTED_STREAK.store(0, Ordering::Relaxed);
            false
        } else if camera_on && connected {
            // Debounce: ignore brief is_connected blips when softcam first registers
            // (e.g. OBS auto-reconnecting while the WebView is still starting).
            CAM_CONNECTED_STREAK.fetch_add(1, Ordering::Relaxed) + 1 >= 2
        } else {
            CAM_CONNECTED_STREAK.store(0, Ordering::Relaxed);
            false
        };

        if need {
            if !capture_already_running() {
                capture_log("Starting screen capture");
                if let Err(e) = begin_capture(state.clone(), None, None) {
                    capture_log(&format!("Capture start failed: {e}"));
                }
            }
        } else if capture_already_running() && !recording && !streaming {
            capture_log("Stopping idle screen capture");
            stop_capture();
        }
    }

    pub fn start_camera(state: SharedState) -> Result<(), CaptureError> {
        register_virtual_camera(state.clone())?;
        ensure_capture_session(state);
        Ok(())
    }

    pub fn attach_camera(state: SharedState) -> Result<(), CaptureError> {
        register_virtual_camera(state.clone())?;
        ensure_capture_session(state);
        Ok(())
    }

    pub fn stop_camera(state: SharedState) {
        let (was_recording, was_streaming) = {
            let st = state.lock();
            (st.recording, st.streaming)
        };
        camera::stop_camera();
        {
            let mut st = state.lock();
            st.camera_enabled = false;
            st.camera_connected = false;
            if !was_recording && !was_streaming {
                stop_capture();
            }
        }
    }

    pub fn start_recording(state: SharedState) -> Result<(), CaptureError> {
        crate::ffmpeg_util::require_ffmpeg().map_err(CaptureError::Other)?;
        crate::file_record::warmup_encoder();

        if capture_already_running() {
            return attach_recording(state);
        }

        let settings_snapshot = {
            let st = state.lock();
            st.recording_settings
        };
        let viewport = shared_viewport().lock().viewport;

        let (out_w, out_h) = output_dims(viewport.orientation, settings_snapshot.quality);
        let path = new_recording_path(viewport.orientation);

        {
            let mut st = state.lock();
            st.current_path = Some(path.clone());
            st.current_dims = (out_w, out_h);
            st.recording = true;
            crate::cursor::sync_follow_gate_from_state(&st);
            crate::click_audio::sync_click_gate_from_state(&st);
        }

        if capture_already_running() {
            sync_output_dimensions(state.clone())?;
        }

        if let Err(e) = begin_capture(state.clone(), Some(path), None) {
            let mut st = state.lock();
            st.recording = false;
            st.current_path = None;
            crate::cursor::sync_follow_gate_from_state(&st);
            crate::click_audio::sync_click_gate_from_state(&st);
            return Err(e);
        }

        Ok(())
    }

    pub fn start_streaming(state: SharedState) -> Result<(), CaptureError> {
        if capture_already_running() {
            return attach_stream(state);
        }

        let (settings, stream_settings) = {
            let st = state.lock();
            (st.recording_settings, st.stream_settings.clone())
        };
        let viewport = shared_viewport().lock().viewport;

        let (out_w, out_h) = output_dims(viewport.orientation, settings.quality);
        let stream = StreamPipeline::start(
            StreamConfig {
                server_url: stream_settings.server_url,
                stream_key: stream_settings.stream_key,
                width: out_w,
                height: out_h,
                fps: settings.fps.max(1),
                bitrate_kbps: stream_settings.bitrate_kbps,
            },
            Some(state.clone()),
        )
        .map_err(CaptureError::Other)?;

        {
            let mut st = state.lock();
            st.streaming = true;
            st.stream_start = Some(Instant::now());
            st.current_dims = (out_w, out_h);
            st.stream_stats.connected = true;
            st.stream_stats.error = None;
        }

        if let Err(e) = begin_capture(state.clone(), None, Some(stream)) {
            state.lock().streaming = false;
            return Err(e);
        }
        Ok(())
    }

    pub fn start_both(state: SharedState) -> Result<(), CaptureError> {
        if capture_already_running() {
            let st = state.lock();
            if st.recording && st.streaming {
                return Ok(());
            }
            drop(st);
            if !state.lock().recording {
                attach_recording(state.clone())?;
            }
            if !state.lock().streaming {
                attach_stream(state)?;
            }
            return Ok(());
        }
        {
            let st = state.lock();
            if st.stream_settings.stream_key.trim().is_empty() {
                return Err(CaptureError::Other("stream key is required".into()));
            }
        }

        let (settings, stream_settings) = {
            let st = state.lock();
            (st.recording_settings, st.stream_settings.clone())
        };
        let viewport = shared_viewport().lock().viewport;

        let (out_w, out_h) = output_dims(viewport.orientation, settings.quality);
        let path = new_recording_path(viewport.orientation);
        let stream_start = Instant::now();
        let stream = StreamPipeline::start(
            StreamConfig {
                server_url: stream_settings.server_url,
                stream_key: stream_settings.stream_key,
                width: out_w,
                height: out_h,
                fps: settings.fps.max(1),
                bitrate_kbps: stream_settings.bitrate_kbps,
            },
            Some(state.clone()),
        )
        .map_err(CaptureError::Other)?;

        {
            let mut st = state.lock();
            st.recording = true;
            st.streaming = true;
            st.current_path = Some(path.clone());
            st.stream_start = Some(stream_start);
            st.current_dims = (out_w, out_h);
            st.stream_stats.connected = true;
            st.stream_stats.error = None;
        }

        if let Err(e) = begin_capture(state.clone(), Some(path), Some(stream)) {
            let mut st = state.lock();
            st.recording = false;
            st.streaming = false;
            st.current_path = None;
            st.session_start = None;
            st.current_start = None;
            return Err(e);
        }
        Ok(())
    }

    fn stop_capture() {
        stop_recording_glide_pulse();
        stop_paced_output();
        if let Some(control) = control_slot().lock().take() {
            // Join the capture thread first so the handler can flush frames, then finalize in Drop.
            let _ = control.stop();
        }
        clear_gpu_bridge();
    }

    pub fn stop_recording(
        state: SharedState,
        app: Option<tauri::AppHandle>,
    ) -> Result<Option<crate::state::RecordingInfo>, CaptureError> {
        let _progress_guard = app.as_ref().map(|handle| {
            let handle = handle.clone();
            crate::save_progress::begin_timing();
            crate::save_progress::set_reporter(Some(std::sync::Arc::new(
                move |percent, phase| {
                    let _ = handle.emit(
                        "recording:save-progress",
                        serde_json::json!({ "percent": percent, "phase": phase }),
                    );
                },
            )));
            SaveProgressGuard
        });

        let (was_streaming, was_camera) = {
            let st = state.lock();
            (st.streaming, st.camera_enabled)
        };
        if !state.lock().recording {
            return Ok(None);
        }

        let (path, dims, orientation) = {
            let st = state.lock();
            if !st.recording {
                return Ok(None);
            }
            (
                st.current_path.clone(),
                st.current_dims,
                viewport_orientation(),
            )
        };

        let path = match path {
            Some(p) => p,
            None => return Ok(None),
        };

        {
            let mut st = state.lock();
            st.recording = false;
        }

        crate::save_progress::report(8, "starting");
        let (frames, size_bytes, duration) = close_recorder()?;

        if !was_streaming && !was_camera {
            stop_capture();
        }

        {
            let mut st = state.lock();
            st.current_path = None;
            st.session_start = None;
            st.current_start = None;
            crate::cursor::sync_follow_gate_from_state(&st);
            crate::click_audio::sync_click_gate_from_state(&st);
        }

        if frames == 0 || size_bytes < 512 {
            let _ = std::fs::remove_file(&path);
            return Err(CaptureError::Other(format!(
                "Recording produced no video ({frames} frames, {size_bytes} bytes). See ~/Videos/ninesixteen/ninesixteen.log"
            )));
        }

        let stem = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let filename = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();

        // Encrypt the finished MP4 at rest and drop the plaintext so nothing
        // playable is ever left in the recordings folder (export decrypts it).
        let ns_path = path.with_extension("ns");
        crate::save_progress::report(65, "encrypting");
        let stored = match crate::crypto::encrypt_file_with_progress(&path, &ns_path, |pct| {
            let overall = 65u8.saturating_add((pct as u16 * 34 / 100) as u8);
            let mapped = overall.min(99);
            // Throttle encrypt ticks to whole percent steps the UI can follow.
            if pct >= 100 || pct == 0 || pct % 4 == 0 {
                crate::save_progress::report(mapped, "encrypting");
            }
        }) {
            Ok(()) => {
                let _ = std::fs::remove_file(&path);
                ns_path
            }
            Err(e) => {
                crate::log::capture_log(&format!("Failed to encrypt recording: {e}"));
                path.clone()
            }
        };
        crate::save_progress::report(100, "encrypting");

        let info = crate::state::RecordingInfo {
            id: stem,
            filename,
            path: stored.to_string_lossy().into_owned(),
            created_at: chrono::Local::now().timestamp_millis(),
            duration,
            size_bytes,
            width: dims.0,
            height: dims.1,
            orientation,
        };
        crate::recordings::save_metadata(&info);
        ensure_capture_session(state.clone());
        Ok(Some(info))
    }

    pub fn stop_streaming(state: SharedState) {
        let was_recording = state.lock().recording;
        stream_sink().lock().take();
        {
            let mut st = state.lock();
            st.streaming = false;
            st.stream_start = None;
            st.stream_stats.connected = false;
            if !was_recording && !st.camera_enabled {
                stop_capture();
            }
        }
    }

    pub fn poll_camera_connected() -> bool {
        let connected = camera_connected();
        connected
    }

    pub fn is_capture_running() -> bool {
        capture_already_running()
    }

    /// WGC frames, recording renders, glide re-crops, and handler timing since last call (then reset).
    pub fn recording_pipeline_window_stats() -> (u64, u64, u64, u64, u64, u64) {
        let wgc = WGC_FRAMES_WINDOW.swap(0, Ordering::Relaxed);
        let cap = REC_CAPTURE_RENDERS_WINDOW.swap(0, Ordering::Relaxed);
        let glide = REC_GLIDE_RENDERS_WINDOW.swap(0, Ordering::Relaxed);
        let handlers = PROF_WGC_HANDLERS.swap(0, Ordering::Relaxed);
        let render_us = PROF_RENDER_US.swap(0, Ordering::Relaxed);
        let read_us = PROF_READ_US.swap(0, Ordering::Relaxed);
        let handler_us = PROF_HANDLER_US.swap(0, Ordering::Relaxed);
        let div = handlers.max(1);
        (
            wgc,
            cap,
            glide,
            render_us / div,
            read_us / div,
            handler_us / div,
        )
    }

    pub fn recording_encoder_queue_depth() -> u64 {
        ENC_QUEUE_DEPTH.load(Ordering::Relaxed)
    }

    pub fn recording_encoder_queue_note_sent() {
        ENC_QUEUE_DEPTH.fetch_add(1, Ordering::Relaxed);
    }

    pub fn recording_encoder_queue_note_consumed() {
        ENC_QUEUE_DEPTH.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn recording_encoder_queue_reset() {
        ENC_QUEUE_DEPTH.store(0, Ordering::Relaxed);
    }

    /// Snapshot which capture-pipeline locks are currently held (watchdog aid).
    /// `try_lock` here only briefly contends; it never blocks.
    pub fn debug_lock_report() -> String {
        let tag = |held: bool| if held { "HELD" } else { "free" };
        let gpu = gpu_bridge().try_lock().is_none();
        let ctrl = control_slot().try_lock().is_none();
        let rec = recorder_slot().try_lock().is_none();
        let paced = paced_output_slot().try_lock().is_none();
        let stream = stream_sink().try_lock().is_none();
        let cam = camera::camera_sink().try_lock().is_none();
        format!(
            "gpu_bridge={} control={} recorder={} paced={} stream={} camera_sink={}",
            tag(gpu),
            tag(ctrl),
            tag(rec),
            tag(paced),
            tag(stream),
            tag(cam)
        )
    }
}

#[cfg(windows)]
pub fn recording_viewport_context() -> (crate::state::Viewport, u32, u32) {
    imp::recording_viewport_context()
}

#[cfg(not(windows))]
pub fn recording_viewport_context() -> (crate::state::Viewport, u32, u32) {
    (crate::state::Viewport::default(), 1920, 1080)
}

#[cfg(windows)]
pub use imp::{
    attach_camera, attach_recording, attach_stream, debug_lock_report, dispatch_recording_outputs,
    ensure_capture_session, is_capture_running, poll_camera_connected, recording_encoder_queue_depth,
    recording_encoder_queue_note_consumed, recording_encoder_queue_note_sent,
    recording_encoder_queue_reset, recording_pipeline_window_stats, register_virtual_camera,
    render_output_frame, start_both, start_camera, start_recording,
    start_streaming, stop_camera, stop_recording, stop_streaming, sync_output_dimensions,
    viewport_changed_since_last_render,
};

#[cfg(not(windows))]
pub fn debug_lock_report() -> String {
    String::from("n/a")
}

#[cfg(windows)]
pub fn render_recording_frame(state: &SharedState) -> Option<Vec<u8>> {
    imp::render_output_frame(state)
}

#[cfg(not(windows))]
pub fn viewport_changed_since_last_render() -> bool {
    true
}

#[cfg(not(windows))]
pub fn recording_pipeline_window_stats() -> (u64, u64, u64, u64, u64, u64) {
    (0, 0, 0, 0, 0, 0)
}

#[cfg(not(windows))]
pub fn recording_encoder_queue_depth() -> u64 {
    0
}

#[cfg(not(windows))]
pub fn recording_encoder_queue_note_sent() {}

#[cfg(not(windows))]
pub fn recording_encoder_queue_note_consumed() {}

#[cfg(not(windows))]
pub fn recording_encoder_queue_reset() {}

#[cfg(not(windows))]
pub fn sync_output_dimensions(_state: SharedState) -> Result<(), CaptureError> {
    Ok(())
}

#[cfg(not(windows))]
pub fn render_recording_frame(_state: &SharedState) -> Option<Vec<u8>> {
    None
}

#[cfg(not(windows))]
pub fn dispatch_recording_outputs(_bgra: Vec<u8>, _state: &SharedState) {}

#[cfg(not(windows))]
pub fn start_recording(_state: SharedState) -> Result<(), CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(not(windows))]
pub fn start_streaming(_state: SharedState) -> Result<(), CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(not(windows))]
pub fn attach_stream(_state: SharedState) -> Result<(), CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(not(windows))]
pub fn attach_recording(_state: SharedState) -> Result<(), CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(not(windows))]
pub fn start_camera(_state: SharedState) -> Result<(), CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(not(windows))]
pub fn stop_camera(_state: SharedState) {}

#[cfg(not(windows))]
pub fn poll_camera_connected() -> bool {
    false
}

#[cfg(not(windows))]
pub fn start_both(_state: SharedState) -> Result<(), CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(not(windows))]
pub fn stop_recording(
    _state: SharedState,
    _app: Option<tauri::AppHandle>,
) -> Result<Option<crate::state::RecordingInfo>, CaptureError> {
    Ok(None)
}

#[cfg(not(windows))]
pub fn stop_streaming(_state: SharedState) {}

#[cfg(not(windows))]
pub fn is_capture_running() -> bool {
    false
}

