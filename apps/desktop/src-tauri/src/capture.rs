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
    use crate::file_record::{FileRecorder, publish_capture_frame};
    use crate::recordings::new_recording_path;
    use crate::state::Viewport;
    use crate::stream::{StreamConfig, StreamPipeline};
    use parking_lot::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    static LAST_PREVIEW_RENDER_MS: AtomicU64 = AtomicU64::new(0);

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
        let (out_w, out_h, fps) = {
            let st = state.lock();
            let (w, h) = output_dims(viewport_orientation(), st.recording_settings.quality);
            (w, h, st.recording_settings.fps.max(1))
        };
        state.lock().current_dims = (out_w, out_h);

        {
            let mut bridge = gpu_bridge().lock();
            if let Some(device) = bridge.device.clone() {
                ensure_gpu_scaler(&device, &state, &mut bridge)
                    .map_err(CaptureError::Other)?;
            } else {
                bridge.scaler = None;
            }
        }

        if state.lock().camera_enabled {
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
        let (out_w, out_h) = scaler.dimensions();
        let layout = frame_layout(&vp, src_w, src_h, out_w, out_h);
        scaler.render_cached(&ctx, src_w, src_h, &layout).ok()?;
        let bgra = scaler.read_bgra(&ctx).ok()?;
        remember_vp(bridge, &vp);
        Some(bgra)
    }

    fn paced_output_loop(state: SharedState, stop: Arc<AtomicBool>) {
        let mut next_tick = Instant::now();
        let mut last_bgra: Option<Vec<u8>> = None;

        while !stop.load(Ordering::Relaxed) {
            let (recording, streaming, camera, fps_setting) = {
                let st = state.lock();
                (
                    st.recording,
                    st.streaming,
                    st.camera_enabled,
                    st.recording_settings.fps.max(1),
                )
            };
            if !recording && !streaming && !camera {
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
            if streaming || camera {
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
            dispatch_preview_outputs(bgra, streaming, camera);
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

    fn preview_render_interval_ms(streaming: bool, fps: u32) -> u64 {
        if streaming {
            1000 / fps.max(1) as u64
        } else {
            1000 / 30
        }
    }

    fn dispatch_preview_outputs(bgra: Vec<u8>, streaming: bool, camera: bool) {
        if camera {
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
        let (streaming, camera) = {
            let st = state.lock();
            (st.streaming, st.camera_enabled)
        };
        dispatch_preview_outputs(bgra, streaming, camera);
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
        let fps = st.recording_settings.fps.max(1);
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
            let active = {
                let st = self.state.lock();
                st.recording || st.streaming || st.camera_enabled
            };
            if !active {
                capture_control.stop();
                return Ok(());
            }

            let src_w = frame.width();
            let src_h = frame.height();
            let mut bridge = gpu_bridge().lock();
            bridge.device = Some(frame.device().clone());
            bridge.context = Some(frame.device_context().clone());
            ensure_gpu_scaler(frame.device(), &self.state, &mut bridge)
                .map_err(|e| format!("GPU scaler init: {e}"))?;
            bridge.src_w = src_w;
            bridge.src_h = src_h;
            bridge.ready = true;

            if let Err(e) = bridge
                .scaler
                .as_mut()
                .unwrap()
                .ingest_monitor_frame(
                    frame.device_context(),
                    frame.device(),
                    frame.as_raw_texture(),
                    src_w,
                    src_h,
                )
            {
                log_gpu_scale_warn(&format!("WARN: monitor ingest skipped: {e}"));
            } else {
                bridge.last_wgc_ms.store(now_ms(), Ordering::Relaxed);
                WGC_FRAMES_WINDOW.fetch_add(1, Ordering::Relaxed);

                let (recording, streaming, camera, fps) = {
                    let st = self.state.lock();
                    (
                        st.recording,
                        st.streaming,
                        st.camera_enabled,
                        st.recording_settings.fps.max(1),
                    )
                };

                if recording {
                    let vp = shared_viewport().lock().viewport;
                    if viewport_changed_on_bridge(&bridge, &vp) {
                        if let Some(bgra) = render_with_bridge(&mut bridge, &self.state) {
                            if streaming {
                                if let Some(stream) = stream_sink().lock().as_ref() {
                                    stream.push_frame(bgra.clone());
                                }
                            }
                            publish_capture_frame(Arc::new(bgra));
                            REC_CAPTURE_RENDERS_WINDOW.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                } else if streaming || camera {
                    let interval = preview_render_interval_ms(streaming, fps);
                    let now = now_ms();
                    let last = LAST_PREVIEW_RENDER_MS.load(Ordering::Relaxed);
                    if now.saturating_sub(last) >= interval {
                        LAST_PREVIEW_RENDER_MS.store(now, Ordering::Relaxed);
                        if let Some(bgra) = render_with_bridge(&mut bridge, &self.state) {
                            dispatch_preview_outputs(bgra, streaming, camera);
                        }
                    }
                }
            }

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
        capture_log("Arming file recorder");
        Ok(())
    }

    fn begin_capture(
        state: SharedState,
        record_path: Option<PathBuf>,
        stream: Option<StreamPipeline>,
    ) -> Result<(), CaptureError> {
        *stream_sink().lock() = stream;
        let settings_snapshot = {
            let st = state.lock();
            st.recording_settings
        };

        let viewport = shared_viewport().lock().viewport;
        let (out_w, out_h) = output_dims(viewport.orientation, settings_snapshot.quality);
        let fps = settings_snapshot.fps.max(1);
        let record_bitrate = broadcast_bitrate(out_w, out_h, fps);
        let bitrate_kbps = (record_bitrate / 1000).max(500);

        if let Some(ref path) = record_path {
            open_recorder(path, out_w, out_h, fps, bitrate_kbps, state.clone())?;
            capture_log(&format!(
                "Recording to {} ({}x{} @ {}fps)",
                path.display(),
                out_w,
                out_h,
                fps
            ));
        }

        let cursor = if settings_snapshot.capture_cursor {
            CursorCaptureSettings::WithCursor
        } else {
            CursorCaptureSettings::WithoutCursor
        };
        let monitor = Monitor::primary().map_err(|e| CaptureError::Other(format!("no primary monitor: {e:?}")))?;

        let min_interval = std::time::Duration::from_nanos(1_000_000_000 / fps.max(1) as u64);
        let flags = Flags {
            state: state.clone(),
            out_w,
            out_h,
        };
        let settings = Settings::new(
            monitor,
            cursor,
            DrawBorderSettings::WithoutBorder,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Custom(min_interval),
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            flags,
        );

        match Handler::start_free_threaded(settings) {
            Ok(control) => {
                *control_slot().lock() = Some(control);
                start_paced_output(state);
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

    pub fn start_camera(state: SharedState) -> Result<(), CaptureError> {
        if capture_already_running() {
            return attach_camera(state);
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

        if let Err(e) = begin_capture(state.clone(), None, None) {
            camera::stop_camera();
            state.lock().camera_enabled = false;
            return Err(e);
        }
        Ok(())
    }

    pub fn attach_camera(state: SharedState) -> Result<(), CaptureError> {
        if !capture_already_running() {
            return start_camera(state);
        }
        {
            let st = state.lock();
            if st.camera_enabled {
                return Ok(());
            }
        }
        let settings = {
            let st = state.lock();
            st.recording_settings
        };
        let viewport = shared_viewport().lock().viewport;
        let (out_w, out_h) = output_dims(viewport.orientation, settings.quality);
        camera::start_camera(out_w, out_h, settings.fps.max(1)).map_err(CaptureError::Other)?;
        {
            let mut st = state.lock();
            st.camera_enabled = true;
            st.camera_connected = false;
        }
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
        }

        if capture_already_running() {
            sync_output_dimensions(state.clone())?;
        }

        if let Err(e) = begin_capture(state.clone(), Some(path), None) {
            let mut st = state.lock();
            st.current_path = None;
            return Err(e);
        }

        state.lock().recording = true;
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
            crate::save_progress::report(overall.min(99), "encrypting");
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
        camera_connected()
    }

    pub fn is_capture_running() -> bool {
        capture_already_running()
    }

    /// WGC frames and capture-thread recording renders since the last call (then reset).
    pub fn recording_pipeline_window_stats() -> (u64, u64) {
        (
            WGC_FRAMES_WINDOW.swap(0, Ordering::Relaxed),
            REC_CAPTURE_RENDERS_WINDOW.swap(0, Ordering::Relaxed),
        )
    }
}

#[cfg(windows)]
pub use imp::{
    attach_camera, attach_recording, attach_stream, dispatch_recording_outputs, is_capture_running,
    poll_camera_connected, recording_pipeline_window_stats, render_output_frame,
    start_both, start_camera, start_recording, start_streaming, stop_camera, stop_recording,
    stop_streaming, sync_output_dimensions, viewport_changed_since_last_render,
};

#[cfg(windows)]
pub fn render_recording_frame(state: &SharedState) -> Option<Vec<u8>> {
    imp::render_output_frame(state)
}

#[cfg(not(windows))]
pub fn viewport_changed_since_last_render() -> bool {
    true
}

#[cfg(not(windows))]
pub fn recording_pipeline_window_stats() -> (u64, u64) {
    (0, 0)
}

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

