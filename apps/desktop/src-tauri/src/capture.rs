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
    use crate::file_record::{
        recording_fps, set_rec_frame_context, FileRecorder, publish_capture_surface,
        recording_uses_hw_encode,
    };
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
    static PROF_ENCODE_US: AtomicU64 = AtomicU64::new(0);
    static ENC_QUEUE_DEPTH: AtomicU64 = AtomicU64::new(0);
    static LAST_WGC_HANDLER_END_MS: AtomicU64 = AtomicU64::new(0);
    /// Skip glide re-crop when WGC just finished — avoids gpu_bridge lock ping-pong.
    const GLIDE_AFTER_WGC_GUARD_MS: u64 = 10;
    static RECORDING_DEGRADED: AtomicBool = AtomicBool::new(false);
    static CAPTURE_BAD_WINDOWS: AtomicU64 = AtomicU64::new(0);
    static LAST_WGC_RESTART_MS: AtomicU64 = AtomicU64::new(0);
    static COMPLETED_SEGMENTS: AtomicU64 = AtomicU64::new(0);
    /// Auto-start a fresh file every 30 minutes during long sessions.
    const MAX_SEGMENT_SECS: f64 = 30.0 * 60.0;
    const CAPTURE_HEALTH_MIN_WGC_PER_5S: u64 = 225; // ~45/s
    const CAPTURE_HEALTH_MAX_HOLD_PCT: f64 = 8.0;
    const CAPTURE_HEALTH_BAD_WINDOWS: u64 = 6; // 6 × 5s = 30s sustained
    const WGC_RESTART_COOLDOWN_MS: u64 = 120_000;
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

    #[cfg(windows)]
    fn boost_capture_thread_priority(recording: bool) {
        use windows::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_HIGHEST,
            THREAD_PRIORITY_ABOVE_NORMAL,
        };
        unsafe {
            let priority = if recording {
                THREAD_PRIORITY_HIGHEST
            } else {
                THREAD_PRIORITY_ABOVE_NORMAL
            };
            let _ = SetThreadPriority(GetCurrentThread(), priority);
        }
    }

    #[cfg(not(windows))]
    fn boost_capture_thread_priority(_recording: bool) {}

    /// System cursor baked into WGC must read back on the same frame (no pipelining).
    fn wgc_needs_sync_cursor(state: &SharedState) -> bool {
        let st = state.lock();
        st.recording_settings.use_wgc_system_cursor()
    }

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

            if viewport_changed_since_last_render()
                && !RECORDING_DEGRADED.load(Ordering::Relaxed)
            {
                let since_wgc = now_ms().saturating_sub(
                    LAST_WGC_HANDLER_END_MS.load(Ordering::Relaxed),
                );
                if since_wgc >= GLIDE_AFTER_WGC_GUARD_MS {
                    if let Some(mut bridge) = gpu_bridge().try_lock() {
                        if bridge.ready {
                            if capture_recording_output(&mut bridge, &state, None, true) {
                                REC_CAPTURE_RENDERS_WINDOW.fetch_add(1, Ordering::Relaxed);
                                REC_GLIDE_RENDERS_WINDOW.fetch_add(1, Ordering::Relaxed);
                            }
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
        let vp = shared_viewport().lock().viewport;
        render_from_cache(&mut bridge, state, vp, None, false)
    }

    fn render_recording_frame(
        bridge: &mut GpuBridge,
        state: &SharedState,
        live_tex: Option<&windows::Win32::Graphics::Direct3D11::ID3D11Texture2D>,
        pipelined: bool,
    ) -> Option<Vec<u8>> {
        let vs = shared_viewport().lock();
        let promo = state.lock().promo_mode.is_some();
        let vp = if promo {
            vs.promo_usage_viewport.unwrap_or(vs.viewport)
        } else {
            vs.viewport
        };
        drop(vs);
        let sync_readback = pipelined && !recording_gpu_cursor(state);
        render_from_cache(bridge, state, vp, live_tex, sync_readback)
    }

    /// Promo session: usage viewport → main recorder; inner viewport → nested track.
    fn capture_promo_outputs(
        bridge: &mut GpuBridge,
        state: &SharedState,
        live_tex: Option<&windows::Win32::Graphics::Direct3D11::ID3D11Texture2D>,
        _pipelined: bool,
    ) -> bool {
        let (usage_vp, inner_vp, inner_active) = {
            let vs = shared_viewport().lock();
            let st = state.lock();
            let usage = vs.promo_usage_viewport.unwrap_or(vs.viewport);
            // Inner take must follow live pan/zoom on `viewport`, not the armed snapshot.
            let inner = if st.promo_inner_active {
                vs.viewport
            } else {
                vs.promo_inner_viewport.unwrap_or(vs.viewport)
            };
            (usage, inner, st.promo_inner_active)
        };

        let mut ok = false;

        // Inner first (sync readback) so both tracks share the same WGC frame.
        if inner_active {
            let (iw, ih, stamp_cursor, src_w, src_h) = {
                let vs = shared_viewport().lock();
                let st = state.lock();
                let (sw, sh) = vs
                    .monitor
                    .as_ref()
                    .map(|m| (m.width, m.height))
                    .unwrap_or((1920, 1080));
                let stamp = st.recording_settings.use_cinematic_cursor();
                let (iw, ih) = st
                    .promo_mode
                    .map(crate::promo::promo_output_dims)
                    .unwrap_or((720, 1280));
                (iw, ih, stamp, sw, sh)
            };
            if let Some(bgra) = render_from_cache(bridge, state, inner_vp, live_tex, false) {
                if stamp_cursor {
                    let mut out = Vec::new();
                    crate::cursor::stamp_into_buffer(
                        &mut out,
                        &bgra,
                        iw,
                        ih,
                        &inner_vp,
                        src_w,
                        src_h,
                        crate::file_record::session_t_secs(),
                    );
                    crate::promo::publish_inner_frame(out, iw, ih);
                } else {
                    crate::promo::publish_inner_frame(bgra, iw, ih);
                }
            }
        }

        if let Some(bgra) = render_from_cache(bridge, state, usage_vp, live_tex, false) {
            crate::file_record::publish_capture_frame(bgra);
            ok = true;
        }

        ok
    }

    fn recording_gpu_cursor(state: &SharedState) -> bool {
        let st = state.lock();
        st.recording_settings.use_cinematic_cursor() && st.promo_mode.is_none()
    }

    /// Publish one recording frame — MF GPU surface (zero-copy) or FFmpeg BGRA pipe.
    fn capture_recording_output(
        bridge: &mut GpuBridge,
        state: &SharedState,
        live_tex: Option<&windows::Win32::Graphics::Direct3D11::ID3D11Texture2D>,
        pipelined: bool,
    ) -> bool {
        if state.lock().promo_mode.is_some() {
            return capture_promo_outputs(bridge, state, live_tex, pipelined);
        }
        if recording_uses_hw_encode() {
            return publish_recording_surface(bridge, state, live_tex, pipelined);
        }
        if let Some(bgra) = render_recording_frame(bridge, state, live_tex, pipelined) {
            publish_recording_pixels(bgra, state);
            return true;
        }
        false
    }

    fn publish_recording_surface(
        bridge: &mut GpuBridge,
        state: &SharedState,
        live_tex: Option<&windows::Win32::Graphics::Direct3D11::ID3D11Texture2D>,
        pipelined: bool,
    ) -> bool {
        if state.lock().promo_mode.is_some() {
            return false;
        }
        let vp = shared_viewport().lock().viewport;
        if !bridge.ready {
            return false;
        }
        let ctx = match bridge.context.clone() {
            Some(c) => c,
            None => return false,
        };
        let device = match bridge.device.clone() {
            Some(d) => d,
            None => return false,
        };
        let src_w = bridge.src_w;
        let src_h = bridge.src_h;
        if ensure_gpu_scaler(&device, state, bridge).is_err() {
            return false;
        }
        let scaler = match bridge.scaler.as_mut() {
            Some(s) => s,
            None => return false,
        };
        let layout = frame_layout(&vp, src_w, src_h, scaler.dimensions().0, scaler.dimensions().1);

        let t_render = Instant::now();
        let draw = if let Some(tex) = live_tex {
            scaler.render(&ctx, &device, tex, src_w, src_h, &layout)
        } else {
            scaler.render_cached(&ctx, src_w, src_h, &layout)
        };
        if draw.is_err() {
            return false;
        }
        let surface = match scaler.snap_encode_surface(&ctx) {
            Ok(s) => s,
            Err(_) => return false,
        };
        PROF_ENCODE_US.fetch_add(t_render.elapsed().as_micros() as u64, Ordering::Relaxed);
        remember_vp(bridge, &vp);
        publish_capture_surface(surface, false);
        let _ = pipelined;
        true
    }

    fn publish_recording_pixels(bgra: Vec<u8>, _state: &SharedState) {
        crate::file_record::publish_capture_frame(bgra);
    }

    fn flush_gpu_readback_pipeline() {
        let mut bridge = gpu_bridge().lock();
        if let (Some(ctx), Some(scaler)) = (bridge.context.clone(), bridge.scaler.as_mut()) {
            if let Some(bgra) = scaler.flush_pipelined_readback(&ctx) {
                crate::file_record::publish_capture_frame(bgra);
            }
            scaler.reset_readback_pipeline();
            scaler.flush_encode_pipeline(&ctx);
        }
    }

    pub fn recording_viewport_context() -> (crate::state::Viewport, u32, u32) {
        let vs = shared_viewport().lock();
        let vp = vs.promo_usage_viewport.unwrap_or(vs.viewport);
        let (sw, sh) = vs
            .monitor
            .as_ref()
            .map(|m| (m.width, m.height))
            .unwrap_or((1920, 1080));
        (vp, sw, sh)
    }

    fn wgc_cursor_settings(state: &SharedState) -> CursorCaptureSettings {
        let st = state.lock();
        if !st.recording_settings.capture_cursor {
            return CursorCaptureSettings::WithoutCursor;
        }
        if st.recording_settings.use_cinematic_cursor() {
            CursorCaptureSettings::WithoutCursor
        } else if st.recording_settings.capture_cursor {
            CursorCaptureSettings::WithCursor
        } else {
            CursorCaptureSettings::WithoutCursor
        }
    }

    /// Crop the monitor into output pixels. When `live_tex` is set (WGC hot path), copy
    /// from the fresh frame once; otherwise re-crop the cached `src_copy` (viewport glide).
    /// Pipelined readback is used only for glide re-crops — WGC always reads synchronously
    /// so the cursor is not delayed by one frame (which causes visible skip/stutter).
    fn render_from_cache(
        bridge: &mut GpuBridge,
        state: &SharedState,
        vp: crate::state::Viewport,
        live_tex: Option<&windows::Win32::Graphics::Direct3D11::ID3D11Texture2D>,
        pipelined: bool,
    ) -> Option<Vec<u8>> {
        if !bridge.ready {
            return None;
        }
        let ctx = bridge.context.clone()?;
        let device = bridge.device.clone()?;
        let src_w = bridge.src_w;
        let src_h = bridge.src_h;
        ensure_gpu_scaler(&device, state, bridge).ok()?;
        let scaler = bridge.scaler.as_mut()?;
        let layout = frame_layout(&vp, src_w, src_h, scaler.dimensions().0, scaler.dimensions().1);

        // Cinematic cursor is stamped on the CPU at CFR encode time — never pipelined
        // readback (one frame behind) and never `cursor_pre_stamped` without pixels.
        let use_pipeline_cached = pipelined && live_tex.is_none();
        let use_pipeline_live = pipelined
            && live_tex.is_some()
            && !wgc_needs_sync_cursor(state)
            && !recording_gpu_cursor(state);

        if use_pipeline_live {
            let prev = scaler.take_pipelined_readback(&ctx);
            let tex = live_tex.unwrap();
            let draw = scaler.render(&ctx, &device, tex, src_w, src_h, &layout);
            draw.ok()?;
            scaler.queue_readback(&ctx);

            if let Some(bgra) = prev {
                remember_vp(bridge, &vp);
                return Some(bgra);
            }
            return None;
        }

        if use_pipeline_cached {
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
        set_rec_frame_context(*vp, bridge.src_w, bridge.src_h);
    }

    fn viewport_changed_on_bridge(bridge: &GpuBridge, vp: &Viewport) -> bool {
        (vp.x - bridge.last_vp_x).abs() > 0.5
            || (vp.y - bridge.last_vp_y).abs() > 0.5
            || (vp.zoom - bridge.last_vp_zoom).abs() > 0.002
    }

    /// True when pan/zoom moved since the last recording render (skip redundant GPU readbacks).
    pub fn viewport_changed_since_last_render() -> bool {
        let bridge = gpu_bridge().lock();
        let vs = shared_viewport().lock();
        if viewport_changed_on_bridge(&bridge, &vs.viewport) {
            return true;
        }
        if let Some(usage) = vs.promo_usage_viewport {
            if (usage.x - bridge.last_vp_x).abs() > 0.5
                || (usage.y - bridge.last_vp_y).abs() > 0.5
                || (usage.zoom - bridge.last_vp_zoom).abs() > 0.002
            {
                return true;
            }
        }
        false
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
        let fps = recording_fps(requested);
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
            (1280, 720, 30) => 8_000_000,
            (1280, 720, 60) => 12_000_000,
            (1080, 1920, 30) => 15_000_000,
            (1080, 1920, 60) => 25_000_000,
            (1920, 1080, 30) => 15_000_000,
            (1920, 1080, 60) => 25_000_000,
            (2560, 1440, 30) => 20_000_000,
            (2560, 1440, 60) => 35_000_000,
            (3840, 2160, 30) => 40_000_000,
            (3840, 2160, 60) => 65_000_000,
            _ => {
                let bpp = if w <= 720 {
                    0.18
                } else if w * h >= 3840 * 2160 {
                    0.10
                } else if w * h >= 2560 * 1440 {
                    0.12
                } else {
                    0.16
                };
                ((w as u64 * h as u64 * fps as u64) as f64 * bpp)
                    .clamp(6_000_000.0, 80_000_000.0) as u32
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
            boost_capture_thread_priority(false);
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

            boost_capture_thread_priority(recording);

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
                let streaming_now = streaming;
                if capture_recording_output(&mut bridge, &self.state, live, true) {
                    if streaming_now && !recording_uses_hw_encode() {
                        if let Some(bgra) = render_recording_frame(&mut bridge, &self.state, live, false) {
                            if let Some(stream) = stream_sink().lock().as_ref() {
                                stream.push_frame(bgra);
                            }
                        }
                    }
                    REC_CAPTURE_RENDERS_WINDOW.fetch_add(1, Ordering::Relaxed);
                    if !FIRST_REC_FRAME_LOGGED.swap(true, Ordering::Relaxed) {
                        capture_log("First recording frame published to encoder");
                    }
                }
            } else if streaming || feed_cam {
                let vp = shared_viewport().lock().viewport;
                if let Some(bgra) = render_from_cache(&mut bridge, &self.state, vp, live, false) {
                    dispatch_preview_outputs(bgra, streaming, &self.state);
                }
            }

            PROF_HANDLER_US.fetch_add(t_handler.elapsed().as_micros() as u64, Ordering::Relaxed);
            PROF_WGC_HANDLERS.fetch_add(1, Ordering::Relaxed);
            LAST_WGC_HANDLER_END_MS.store(now_ms(), Ordering::Relaxed);

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
        let record_fps = recording_fps(requested_fps);
        let recording_active = state.lock().recording;
        let wgc_fps = if record_path.is_some() || has_stream || recording_active {
            record_fps
        } else {
            // Camera-only idle: lower WGC rate until recording — saves GPU + WebView breathing room.
            requested_fps.min(20).max(10)
        };
        let record_bitrate = broadcast_bitrate(out_w, out_h, record_fps);
        let bitrate_kbps = (record_bitrate / 1000).max(500);

        if let Some(ref path) = record_path {
            FIRST_REC_FRAME_LOGGED.store(false, Ordering::Relaxed);
            open_recorder(path, out_w, out_h, record_fps, bitrate_kbps, state.clone())?;
            capture_log(&format!(
                "Recording to {} ({}x{} @ {}fps CFR{})",
                path.display(),
                out_w,
                out_h,
                record_fps,
                if out_w == 3840 && out_h == 2160 {
                    ", 4K landscape"
                } else if out_w == 2560 && out_h == 1440 {
                    ", 1440p landscape"
                } else {
                    ""
                }
            ));
        }

        let cursor = wgc_cursor_settings(&state);
        if record_path.is_some() && settings_snapshot.use_cinematic_cursor() {
            capture_log("Cinematic cursor armed (WGC without system pointer; stamped per CFR slot)");
        }
        let monitor = Monitor::primary().map_err(|e| CaptureError::Other(format!("no primary monitor: {e:?}")))?;

        let min_interval = std::time::Duration::from_nanos(1_000_000_000 / wgc_fps as u64);
        // Always use full-frame WGC during recording. Dirty-region mode can skip frame
        // delivery when Windows under-reports changes (common in fullscreen games), which
        // forces CFR hold frames and visible playback stutter on long sessions.
        let dirty = DirtyRegionSettings::Default;

        let settings = Settings::new(
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
        );

        match Handler::start_free_threaded(settings) {
            Ok(control) => {
                *control_slot().lock() = Some(control);
                start_paced_output(state.clone());
                if record_path.is_some() || state.lock().recording {
                    start_recording_glide_pulse(state, record_fps);
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
        let (recording, streaming, camera_on, connected) = {
            let mut st = state.lock();
            if st.camera_enabled {
                st.camera_connected = crate::camera::camera_connected();
            }
            (
                st.recording,
                st.streaming,
                st.camera_enabled,
                st.camera_connected,
            )
        };

        let need = if recording || streaming {
            CAM_CONNECTED_STREAK.store(0, Ordering::Relaxed);
            true
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

    pub fn start_promo_recording(state: SharedState) -> Result<(), CaptureError> {
        crate::ffmpeg_util::require_ffmpeg().map_err(CaptureError::Other)?;
        crate::file_record::warmup_encoder();

        if capture_already_running() {
            return attach_recording(state);
        }

        let (mode, settings_snapshot) = {
            let st = state.lock();
            let mode = st
                .promo_mode
                .ok_or_else(|| CaptureError::Other("promo mode not set".into()))?;
            (mode, st.recording_settings)
        };
        let orientation = match mode {
            crate::state::PromoMode::Portrait => Orientation::Portrait,
            crate::state::PromoMode::Landscape => Orientation::Landscape,
        };
        let (out_w, out_h) = output_dims(orientation, settings_snapshot.quality);
        let path = new_recording_path(orientation);

        {
            let mut st = state.lock();
            st.current_path = Some(path.clone());
            st.current_dims = (out_w, out_h);
            st.recording = true;
            st.promo_inner_active = false;
            st.promo_inner_path = None;
            st.promo_inner_started_at = None;
            crate::cursor::sync_follow_gate_from_state(&st);
            crate::click_audio::sync_click_gate_from_state(&st);
        }

        if let Err(e) = begin_capture(state.clone(), Some(path), None) {
            let mut st = state.lock();
            st.recording = false;
            st.current_path = None;
            st.promo_mode = None;
            crate::cursor::sync_follow_gate_from_state(&st);
            crate::click_audio::sync_click_gate_from_state(&st);
            return Err(e);
        }

        capture_log(&format!(
            "Promo recording started ({orientation:?} @ {}x{} {}fps)",
            out_w, out_h, settings_snapshot.fps
        ));
        Ok(())
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

        reset_recording_health_state();
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

    pub fn cancel_promo_recording(state: SharedState) -> Result<(), CaptureError> {
        let (was_streaming, was_camera, path) = {
            let st = state.lock();
            if st.promo_mode.is_none() {
                return Ok(());
            }
            (
                st.streaming,
                st.camera_enabled,
                st.current_path.clone(),
            )
        };

        if state.lock().recording {
            {
                let mut st = state.lock();
                st.recording = false;
            }
            let _ = close_recorder();
        }

        crate::promo::finish_inner_recorder().ok();

        if let Some(p) = path {
            let _ = std::fs::remove_file(p);
        }

        if !was_streaming && !was_camera {
            stop_capture();
        }

        {
            let mut st = state.lock();
            st.current_path = None;
            st.session_start = None;
            st.current_start = None;
            st.promo_mode = None;
            st.promo_inner_active = false;
            st.promo_inner_path = None;
            st.promo_inner_started_at = None;
            st.recording_armed = false;
            st.countdown_seconds = 0;
            st.finalizing = false;
            crate::cursor::sync_follow_gate_from_state(&st);
            crate::click_audio::sync_click_gate_from_state(&st);
        }
        {
            let mut vs = shared_viewport().lock();
            vs.promo_usage_viewport = None;
            vs.promo_inner_viewport = None;
        }

        capture_log("Promo session cancelled — usage track discarded");
        Ok(())
    }

    fn reset_recording_health_state() {
        RECORDING_DEGRADED.store(false, Ordering::Relaxed);
        CAPTURE_BAD_WINDOWS.store(0, Ordering::Relaxed);
        COMPLETED_SEGMENTS.store(0, Ordering::Relaxed);
    }

    /// Post-process plaintext MP4 (faststart + thumb + encrypt + sidecar).
    fn finalize_recording_file(
        path: std::path::PathBuf,
        dims: (u32, u32),
        orientation: Orientation,
        frames: u64,
        mut size_bytes: u64,
        duration: f64,
    ) -> Result<crate::state::RecordingInfo, CaptureError> {
        if frames == 0 || size_bytes < 512 {
            let _ = std::fs::remove_file(&path);
            return Err(CaptureError::Other("segment empty".into()));
        }

        if let Err(e) = crate::file_record::apply_faststart(&path) {
            capture_log(&format!("WARN: faststart remux failed ({e}); continuing"));
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

        let _ = crate::recordings::write_thumbnail_from_mp4(&path, &stem);
        let ns_path = path.with_extension("ns");
        let stored = match crate::crypto::encrypt_file_with_progress(&path, &ns_path, |pct| {
            let overall = 65u8.saturating_add((pct as u16 * 34 / 100) as u8);
            if pct >= 100 || pct == 0 || pct % 8 == 0 {
                crate::save_progress::report(overall.min(99), "encrypting");
            }
        }) {
            Ok(()) => {
                let _ = std::fs::remove_file(&path);
                ns_path
            }
            Err(e) => {
                capture_log(&format!("Failed to encrypt recording: {e}"));
                path.clone()
            }
        };

        if stored.extension().and_then(|s| s.to_str()) == Some("ns") {
            size_bytes = std::fs::metadata(&stored).map(|m| m.len()).unwrap_or(size_bytes);
        }

        let info = crate::state::RecordingInfo {
            id: stem.clone(),
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
        Ok(info)
    }

    fn restart_wgc_session(state: SharedState) -> Result<(), CaptureError> {
        let (recording, streaming) = {
            let st = state.lock();
            (st.recording, st.streaming)
        };
        if !recording && !streaming {
            return Ok(());
        }
        let now = now_ms();
        if now.saturating_sub(LAST_WGC_RESTART_MS.load(Ordering::Relaxed)) < WGC_RESTART_COOLDOWN_MS {
            return Ok(());
        }

        let stream = stream_sink().lock().take();
        stop_recording_glide_pulse();
        stop_paced_output();
        if let Some(control) = control_slot().lock().take() {
            let _ = control.stop();
        }
        clear_gpu_bridge();

        begin_capture(state.clone(), None, stream)?;
        LAST_WGC_RESTART_MS.store(now, Ordering::Relaxed);
        capture_log("WGC session restarted (capture health recovery)");
        Ok(())
    }

    fn rotate_recording_segment(state: SharedState) -> Result<(), CaptureError> {
        let promo = state.lock().promo_mode.is_some();
        if promo {
            return Ok(());
        }
        let (path, dims, orientation, record_fps, bitrate_kbps) = {
            let st = state.lock();
            if !st.recording {
                return Ok(());
            }
            let path = st
                .current_path
                .clone()
                .ok_or_else(|| CaptureError::Other("no active recording path".into()))?;
            let (out_w, out_h, fps, bitrate) = recording_dims(&state);
            (path, (out_w, out_h), viewport_orientation(), fps, bitrate)
        };

        let (frames, size_bytes, duration) = close_recorder()?;
        if frames == 0 {
            capture_log("WARN: segment rotate skipped — no frames in segment");
        } else if let Ok(info) =
            finalize_recording_file(path.clone(), dims, orientation, frames, size_bytes, duration)
        {
            capture_log(&format!(
                "Recording segment saved ({:.0}s, {} bytes) → {}",
                info.duration,
                info.size_bytes,
                info.filename
            ));
            if let Some(app) = crate::app_handle() {
                let _ = app.emit("recording:segment-saved", &info);
            }
        }

        let new_path = new_recording_path(orientation);
        open_recorder(
            &new_path,
            dims.0,
            dims.1,
            record_fps,
            bitrate_kbps,
            state.clone(),
        )?;
        capture_log(&format!(
            "Recording continued in new segment ({}/{})",
            new_path.display(),
            record_fps
        ));
        {
            let mut st = state.lock();
            st.current_path = Some(new_path);
        }
        start_recording_glide_pulse(state, record_fps);
        Ok(())
    }

    /// Called from live stats (~5s). Restarts WGC after sustained lag; rotates file every 30 min.
    pub fn recording_pipeline_health_check(
        state: SharedState,
        elapsed_secs: f64,
        wgc_5s: u64,
        hold_pct: f64,
        target_fps: u32,
    ) {
        if elapsed_secs < 30.0 {
            RECORDING_DEGRADED.store(false, Ordering::Relaxed);
            CAPTURE_BAD_WINDOWS.store(0, Ordering::Relaxed);
            return;
        }

        let wgc_low = wgc_5s < CAPTURE_HEALTH_MIN_WGC_PER_5S;
        let holds_high = hold_pct >= CAPTURE_HEALTH_MAX_HOLD_PCT;
        let degraded = wgc_low || holds_high;
        RECORDING_DEGRADED.store(degraded, Ordering::Relaxed);

        if degraded {
            let bad = CAPTURE_BAD_WINDOWS.fetch_add(1, Ordering::Relaxed) + 1;
            if bad >= CAPTURE_HEALTH_BAD_WINDOWS {
                CAPTURE_BAD_WINDOWS.store(0, Ordering::Relaxed);
                if let Err(e) = restart_wgc_session(state.clone()) {
                    capture_log(&format!("WARN: WGC health restart failed: {e}"));
                }
            }
        } else {
            CAPTURE_BAD_WINDOWS.store(0, Ordering::Relaxed);
        }

        let segment_idx = (elapsed_secs / MAX_SEGMENT_SECS).floor() as u64;
        let completed = COMPLETED_SEGMENTS.load(Ordering::Relaxed);
        if segment_idx > completed && segment_idx > 0 {
            COMPLETED_SEGMENTS.store(segment_idx, Ordering::Relaxed);
            if let Err(e) = rotate_recording_segment(state) {
                capture_log(&format!("WARN: segment rotate failed: {e}"));
            }
        }

        let _ = target_fps;
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
        let (frames, mut size_bytes, mut duration) = close_recorder()?;

        let (promo_mode, promo_inner_was_active, usage_has_audio, inner_started_at) = {
            let st = state.lock();
            let inner_started_at = st
                .promo_inner_started_at
                .and_then(|t| st.session_start.map(|s| t.duration_since(s).as_secs_f64()));
            (
                st.promo_mode,
                st.promo_inner_active,
                crate::audio::source_active(st.audio_settings.source),
                inner_started_at,
            )
        };

        if promo_mode.is_some() {
            let should_composite = promo_inner_was_active || crate::promo::inner_recording_active();
            if should_composite {
                let inner_mp4 = match crate::promo::finish_inner_recorder() {
                    Ok(v) => v,
                    Err(e) => {
                        capture_log(&format!("WARN: promo inner finalize: {e}"));
                        None
                    }
                };
                let composite_tmp = path.with_extension("promo.tmp.mp4");
                let inner_path = inner_mp4.as_ref().map(|(p, _, _)| p.as_path());
                let inner_dur_hint = inner_mp4.as_ref().map(|(_, _, d)| *d);
                match crate::promo::composite_promo_final(
                    &path,
                    inner_path,
                    &composite_tmp,
                    usage_has_audio,
                    inner_started_at,
                    Some(duration),
                    inner_dur_hint,
                    Some(dims),
                ) {
                    Ok(()) => {
                        let _ = std::fs::remove_file(&path);
                        if let Err(e) = std::fs::rename(&composite_tmp, &path) {
                            capture_log(&format!("WARN: promo composite rename: {e}"));
                        } else if let Some(composite_dur) = crate::promo::probe_duration_public(&path) {
                            duration = composite_dur;
                            if let Ok(len) = std::fs::metadata(&path).map(|m| m.len()) {
                                size_bytes = len;
                            }
                        }
                    }
                    Err(e) => {
                        capture_log(&format!("WARN: promo composite failed ({e}); keeping demo track"));
                        let _ = std::fs::remove_file(&composite_tmp);
                    }
                }
                if let Some((inner_path, _, _)) = inner_mp4 {
                    let _ = std::fs::remove_file(inner_path);
                }
            } else {
                let _ = std::fs::remove_file(&path);
                if !was_streaming && !was_camera {
                    stop_capture();
                }
                {
                    let mut st = state.lock();
                    st.current_path = None;
                    st.session_start = None;
                    st.current_start = None;
                    st.promo_mode = None;
                    st.promo_inner_active = false;
                    st.promo_inner_path = None;
                    crate::cursor::sync_follow_gate_from_state(&st);
                    crate::click_audio::sync_click_gate_from_state(&st);
                }
                {
                    let mut vs = shared_viewport().lock();
                    vs.promo_usage_viewport = None;
                    vs.promo_inner_viewport = None;
                }
                return Ok(None);
            }
        }

        if !was_streaming && !was_camera {
            stop_capture();
        }

        {
            let mut st = state.lock();
            st.current_path = None;
            st.session_start = None;
            st.current_start = None;
            st.promo_mode = None;
            st.promo_inner_active = false;
            st.promo_inner_path = None;
            st.promo_inner_started_at = None;
            crate::cursor::sync_follow_gate_from_state(&st);
            crate::click_audio::sync_click_gate_from_state(&st);
        }
        {
            let mut vs = shared_viewport().lock();
            vs.promo_usage_viewport = None;
            vs.promo_inner_viewport = None;
        }

        if frames == 0 || size_bytes < 512 {
            let _ = std::fs::remove_file(&path);
            return Err(CaptureError::Other(format!(
                "Recording produced no video ({frames} frames, {size_bytes} bytes). See ~/Videos/ninesixteen/ninesixteen.log"
            )));
        }

        reset_recording_health_state();
        crate::save_progress::report(65, "encrypting");
        let info = finalize_recording_file(
            path,
            dims,
            orientation,
            frames,
            size_bytes,
            duration,
        )?;
        crate::save_progress::report(100, "encrypting");
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
        let encode_us = PROF_ENCODE_US.swap(0, Ordering::Relaxed);
        let handler_us = PROF_HANDLER_US.swap(0, Ordering::Relaxed);
        let div = handlers.max(1);
        (
            wgc,
            cap,
            glide,
            (render_us + encode_us) / div,
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
    attach_camera, attach_recording, attach_stream, cancel_promo_recording, debug_lock_report,
    dispatch_recording_outputs,
    ensure_capture_session, is_capture_running, poll_camera_connected, recording_encoder_queue_depth,
    recording_encoder_queue_note_consumed, recording_encoder_queue_note_sent,
    recording_encoder_queue_reset, recording_pipeline_health_check,
    recording_pipeline_window_stats, register_virtual_camera,
    render_output_frame, start_both, start_camera, start_promo_recording,
    start_recording,
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
pub fn recording_pipeline_health_check(
    _state: SharedState,
    _elapsed_secs: f64,
    _wgc_5s: u64,
    _hold_pct: f64,
    _target_fps: u32,
) {
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
pub fn cancel_promo_recording(_state: SharedState) -> Result<(), CaptureError> {
    Err(CaptureError::Unsupported)
}

#[cfg(not(windows))]
pub fn start_promo_recording(_state: SharedState) -> Result<(), CaptureError> {
    Err(CaptureError::Unsupported)
}

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

