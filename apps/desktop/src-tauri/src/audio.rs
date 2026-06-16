//! Windows audio capture via WASAPI (loopback + microphone).
//!
//! System audio uses the default render device in loopback mode — the same API OBS
//! uses. No Stereo Mix, virtual cables, or extra drivers required.

use crate::state::{AudioDeviceInfo, AudioLevels, AudioSettings, AudioSourceMode};
use crate::log::capture_log;
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::sync::mpsc::Receiver;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: u16 = 2;
pub const BYTES_PER_FRAME: usize = (CHANNELS as usize) * 2;
/// 10 ms of stereo PCM at 48 kHz — keeps A/V drift under one video frame at 60 fps.
pub const WRITE_BLOCK_FRAMES: usize = SAMPLE_RATE as usize / 100;

#[cfg(windows)]
mod imp {
    use super::*;
    use std::fs::File;
    use std::io::BufWriter;
    use std::path::PathBuf;
    use wasapi::*;

    /// Capture buffer we ask WASAPI for, in 100-ns units (~60 ms). A generous
    /// buffer absorbs scheduling jitter on slow/fresh PCs so the engine never
    /// overruns and drops samples (the usual cause of "grainy" audio). Latency
    /// is irrelevant here because audio is muxed offline. Falls back to the
    /// device minimum if a driver rejects this size.
    const CAPTURE_BUFFER_100NS: i64 = 60 * 10_000;

    fn com_init() {
        let _ = initialize_mta();
    }

    fn output_format() -> WaveFormat {
        WaveFormat::new(
            32,
            32,
            &SampleType::Float,
            SAMPLE_RATE as usize,
            CHANNELS as usize,
            None,
        )
    }

    fn resample_to_stereo_48k(samples: &[f32], src_rate: u32, src_channels: u16) -> Vec<f32> {
        let ch = src_channels.max(1) as usize;
        if samples.is_empty() {
            return Vec::new();
        }
        let frames = samples.len() / ch;
        if frames == 0 {
            return Vec::new();
        }
        // Downmix to stereo first (take L/R; duplicate mono into both channels).
        let mut stereo = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let l = samples[i * ch];
            let r = if ch > 1 { samples[i * ch + 1] } else { l };
            stereo.push(l);
            stereo.push(r);
        }
        if src_rate == SAMPLE_RATE {
            return stereo;
        }
        // Linear interpolation to 48 kHz. `round()` on the output length keeps the
        // long-run ratio unbiased, so per-packet rounding error cancels out instead
        // of accumulating into A/V drift (the mux step corrects any tiny residual).
        let out_frames = (frames as f64 * SAMPLE_RATE as f64 / src_rate as f64).round() as usize;
        let mut out = Vec::with_capacity(out_frames * 2);
        let step = src_rate as f64 / SAMPLE_RATE as f64;
        for i in 0..out_frames {
            let pos = i as f64 * step;
            let i0 = pos.floor() as usize;
            let frac = (pos - i0 as f64) as f32;
            let i1 = (i0 + 1).min(frames - 1);
            let l = stereo[i0 * 2] * (1.0 - frac) + stereo[i1 * 2] * frac;
            let r = stereo[i0 * 2 + 1] * (1.0 - frac) + stereo[i1 * 2 + 1] * frac;
            out.push(l);
            out.push(r);
        }
        out
    }

    struct CaptureStream {
        _client: AudioClient,
        capture: AudioCaptureClient,
        event: Handle,
        block_align: u32,
        sample_rate: u32,
        channels: u16,
        is_float: bool,
    }

    impl CaptureStream {
        fn open_loopback() -> Result<Self, String> {
            com_init();
            let device = get_default_device(&Direction::Render).map_err(|e| e.to_string())?;
            let name = device.get_friendlyname().unwrap_or_else(|_| "?".into());
            capture_log(&format!("Opening system loopback: {name}"));
            Self::open_device(device, true)
        }

        fn open_microphone(device_id: Option<&str>) -> Result<Self, String> {
            com_init();
            let device = if let Some(id) = device_id {
                let collection =
                    DeviceCollection::new(&Direction::Capture).map_err(|e| e.to_string())?;
                (&collection)
                    .into_iter()
                    .filter_map(|d| d.ok())
                    .find(|d| d.get_id().ok().as_deref() == Some(id))
                    .ok_or_else(|| format!("microphone not found: {id}"))?
            } else {
                get_default_device(&Direction::Capture).map_err(|e| e.to_string())?
            };
            let name = device.get_friendlyname().unwrap_or_else(|_| "?".into());
            capture_log(&format!("Opening microphone: {name}"));
            Self::open_device(device, false)
        }

        fn open_device(device: Device, loopback: bool) -> Result<Self, String> {
            // Probe the device for its periods and (for loopback) its native mix
            // format, then drop the probe client so we always Initialize a fresh one.
            let (default_time, min_time, native) = {
                let probe = device.get_iaudioclient().map_err(|e| e.to_string())?;
                let native = if loopback { probe.get_mixformat().ok() } else { None };
                let (d, m) = probe.get_periods().map_err(|e| e.to_string())?;
                (d, m, native)
            };

            // For LOOPBACK we capture at the render endpoint's *native* mix format
            // and resample to 48 kHz ourselves. WASAPI's AUTOCONVERTPCM is
            // unreliable in loopback mode: on some interfaces (e.g. a 44.1 kHz
            // Steinberg UR22) it silently ignores the requested 48 kHz and returns
            // fewer samples than wall-clock time, so audio drifts out of sync with
            // video. Capturing native + resampling ourselves is the documented,
            // device-agnostic path. For microphones, shared-mode AUTOCONVERTPCM is
            // reliable, so we keep requesting 48 kHz / stereo / float directly.
            let format = match (loopback, native) {
                (true, Some(mix)) => {
                    capture_log(&format!(
                        "Loopback native capture: {} Hz, {} ch, {}-bit {}",
                        mix.get_samplespersec(),
                        mix.get_nchannels(),
                        mix.get_bitspersample(),
                        if matches!(mix.get_subformat(), Ok(SampleType::Float)) {
                            "float"
                        } else {
                            "int"
                        }
                    ));
                    mix
                }
                _ => output_format(),
            };
            // Loopback uses native format (no SRC). Mic requests 48k w/ auto-convert.
            let convert = !loopback;
            let is_float = match format.get_subformat() {
                Ok(SampleType::Float) => true,
                Ok(SampleType::Int) => false,
                Err(_) => format.get_bitspersample() == 32,
            };
            let sample_rate = format.get_samplespersec();
            let channels = format.get_nchannels().max(1);
            let block_align = format.get_blockalign();

            // Initialize a fresh client at the chosen format + buffer size.
            let init = |buffer: i64| -> Result<(AudioClient, Handle), String> {
                let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
                client
                    .initialize_client(
                        &format,
                        buffer,
                        &Direction::Capture,
                        &ShareMode::Shared,
                        convert,
                    )
                    .map_err(|e| e.to_string())?;
                let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
                Ok((client, event))
            };

            let generous = CAPTURE_BUFFER_100NS.max(default_time);
            let (client, event) = match init(generous) {
                Ok(v) => v,
                Err(e) => {
                    capture_log(&format!(
                        "WARN: {}ms capture buffer rejected ({e}); falling back to device minimum",
                        generous / 10_000
                    ));
                    init(min_time)?
                }
            };

            let capture = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
            client.start_stream().map_err(|e| e.to_string())?;
            Ok(Self {
                _client: client,
                capture,
                event,
                block_align,
                sample_rate,
                channels,
                is_float,
            })
        }

        fn read_samples(&mut self) -> Result<Vec<f32>, String> {
            self.read_samples_timeout(2000)
        }

        fn read_samples_recording(&mut self) -> Result<Vec<f32>, String> {
            self.read_samples_timeout(50)
        }

        fn read_samples_timeout(&mut self, wait_ms: u32) -> Result<Vec<f32>, String> {
            let _ = self.event.wait_for_event(wait_ms);
            let block = self.block_align as usize;
            if block == 0 {
                return Ok(Vec::new());
            }
            let ch = self.channels.max(1) as usize;
            let bytes_per_sample = (block / ch).max(1);

            // Drain EVERY packet WASAPI currently has queued before going back to
            // the event wait. Reading a single packet per wakeup (the old behavior)
            // lets the capture buffer overflow on devices that deliver several
            // periods between wakeups — WASAPI then silently DROPS the surplus, so
            // the recording captures fewer samples than wall-clock time and the
            // audio ends up short (then stretched/desynced at mux). Looping until
            // GetBuffer reports empty keeps every sample on every device.
            let mut samples: Vec<f32> = Vec::new();
            loop {
                let mut pkt: VecDeque<u8> = VecDeque::new();
                let flags = self
                    .capture
                    .read_from_device_to_deque(&mut pkt)
                    .map_err(|e| e.to_string())?;
                if pkt.len() < block {
                    break;
                }
                let frames = pkt.len() / block;
                if flags.silent {
                    // Silent packets carry valid timing but undefined contents —
                    // emit true zeros so silence keeps A/V aligned without garbage.
                    samples.extend(std::iter::repeat(0.0f32).take(frames * ch));
                } else {
                    let raw: Vec<u8> = pkt.into_iter().collect();
                    for frame in raw.chunks_exact(block) {
                        for s in frame.chunks_exact(bytes_per_sample) {
                            samples.push(decode_sample(s, self.is_float));
                        }
                    }
                }
            }

            if samples.is_empty() {
                return Ok(Vec::new());
            }
            Ok(resample_to_stereo_48k(&samples, self.sample_rate, self.channels))
        }
    }

    /// Decode one native PCM sample to `f32` in [-1.0, 1.0]. Shared-mode mix
    /// formats are effectively always 32-bit float, but microphones can be
    /// 16/24/32-bit int, so handle the common widths defensively.
    fn decode_sample(bytes: &[u8], is_float: bool) -> f32 {
        match (is_float, bytes.len()) {
            (true, 4) => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            (true, 8) => f64::from_le_bytes([
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            ]) as f32,
            (false, 2) => i16::from_le_bytes([bytes[0], bytes[1]]) as f32 / 32_768.0,
            (false, 3) => {
                // 24-bit little-endian signed, sign-extended through the top byte.
                let v = ((bytes[0] as i32) << 8)
                    | ((bytes[1] as i32) << 16)
                    | ((bytes[2] as i32) << 24);
                (v >> 8) as f32 / 8_388_608.0
            }
            (false, 4) => {
                i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f32
                    / 2_147_483_648.0
            }
            _ => 0.0,
        }
    }

    fn peak(samples: &[f32]) -> f32 {
        samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max)
    }

    fn mix_to_s16(
        system: Option<&[f32]>,
        mic: Option<&[f32]>,
        system_gain: f32,
        mic_gain: f32,
        frames: usize,
        out: &mut [u8],
    ) -> f32 {
        let mut peak_out = 0.0f32;
        for i in 0..frames {
            let mut l = 0.0f32;
            let mut r = 0.0f32;
            if let Some(s) = system {
                let li = i * 2;
                if li + 1 < s.len() {
                    l += s[li] * system_gain;
                    r += s[li + 1] * system_gain;
                }
            }
            if let Some(m) = mic {
                let li = i * 2;
                if li + 1 < m.len() {
                    l += m[li] * mic_gain;
                    r += m[li + 1] * mic_gain;
                }
            }
            peak_out = peak_out.max(l.abs()).max(r.abs());
            l = l.clamp(-1.0, 1.0);
            r = r.clamp(-1.0, 1.0);
            let li = i * BYTES_PER_FRAME;
            if li + 3 < out.len() {
                let sl = (l * 32767.0).round().clamp(-32768.0, 32767.0) as i16;
                let sr = (r * 32767.0).round().clamp(-32768.0, 32767.0) as i16;
                out[li..li + 2].copy_from_slice(&sl.to_le_bytes());
                out[li + 2..li + 4].copy_from_slice(&sr.to_le_bytes());
            }
        }
        peak_out
    }

    struct SampleQueue {
        samples: VecDeque<f32>,
    }

    impl SampleQueue {
        fn new() -> Self {
            Self {
                samples: VecDeque::new(),
            }
        }

        fn push(&mut self, data: Vec<f32>) {
            self.samples.extend(data);
        }

        fn take_frames(&mut self, frames: usize) -> Vec<f32> {
            let need = frames * CHANNELS as usize;
            let mut out = Vec::with_capacity(need);
            for _ in 0..need {
                out.push(self.samples.pop_front().unwrap_or(0.0));
            }
            out
        }

        fn len_frames(&self) -> usize {
            self.samples.len() / CHANNELS as usize
        }

        fn peak(&self) -> f32 {
            self.samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max)
        }

        fn take_frames_blocking(&mut self, frames: usize, timeout: Duration) -> Vec<f32> {
            let need = frames * CHANNELS as usize;
            let deadline = Instant::now() + timeout;
            while self.samples.len() < need && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(1));
            }
            self.take_frames(frames)
        }

        fn delay_frames(&mut self, frames: usize) {
            for _ in 0..frames * CHANNELS as usize {
                self.samples.push_front(0.0);
            }
        }

        fn clear(&mut self) {
            self.samples.clear();
        }
    }

    pub fn list_devices() -> Vec<AudioDeviceInfo> {
        com_init();
        let mut out = Vec::new();
        if let Ok(render) = get_default_device(&Direction::Render) {
            if let (Ok(id), Ok(name)) = (render.get_id(), render.get_friendlyname()) {
                out.push(AudioDeviceInfo {
                    id: format!("system:{id}"),
                    name: format!("System audio ({name})"),
                    kind: "system".into(),
                });
            }
        }
        if let Ok(collection) = DeviceCollection::new(&Direction::Capture) {
            for dev in &collection {
                if let Ok(dev) = dev {
                    if let (Ok(id), Ok(name)) = (dev.get_id(), dev.get_friendlyname()) {
                        out.push(AudioDeviceInfo {
                            id,
                            name,
                            kind: "microphone".into(),
                        });
                    }
                }
            }
        }
        out
    }

    fn wants_system(source: AudioSourceMode) -> bool {
        matches!(
            source,
            AudioSourceMode::System | AudioSourceMode::SystemAndMicrophone
        )
    }

    fn wants_mic(source: AudioSourceMode) -> bool {
        matches!(
            source,
            AudioSourceMode::Microphone | AudioSourceMode::SystemAndMicrophone
        )
    }

    struct MonitorSession {
        stop: Arc<AtomicBool>,
        levels: Arc<Mutex<AudioLevels>>,
        threads: Vec<JoinHandle<()>>,
    }

    static MONITOR: OnceLock<Mutex<Option<MonitorSession>>> = OnceLock::new();

    pub fn start_monitor(settings: AudioSettings) -> Result<(), String> {
        stop_monitor();
        if settings.source == AudioSourceMode::None {
            return Ok(());
        }
        let stop = Arc::new(AtomicBool::new(false));
        let levels = Arc::new(Mutex::new(AudioLevels::default()));
        let mut threads = Vec::new();

        if wants_system(settings.source) {
            let stop_t = stop.clone();
            let levels_t = levels.clone();
            threads.push(
                std::thread::Builder::new()
                    .name("audio-mon-sys".into())
                    .spawn(move || {
                        if let Ok(mut cap) = CaptureStream::open_loopback() {
                            while !stop_t.load(Ordering::Relaxed) {
                                if let Ok(samples) = cap.read_samples() {
                                    let p = peak(&samples);
                                    let mut lv = levels_t.lock();
                                    lv.system = lv.system * 0.7 + p * 0.3;
                                }
                                std::thread::sleep(Duration::from_millis(10));
                            }
                        }
                    })
                    .map_err(|e| e.to_string())?,
            );
        }

        if wants_mic(settings.source) {
            let mic_id = settings.microphone_id.clone();
            let stop_t = stop.clone();
            let levels_t = levels.clone();
            threads.push(
                std::thread::Builder::new()
                    .name("audio-mon-mic".into())
                    .spawn(move || {
                        if let Ok(mut cap) = CaptureStream::open_microphone(mic_id.as_deref()) {
                            while !stop_t.load(Ordering::Relaxed) {
                                if let Ok(samples) = cap.read_samples() {
                                    let p = peak(&samples);
                                    let mut lv = levels_t.lock();
                                    lv.mic = lv.mic * 0.7 + p * 0.3;
                                }
                                std::thread::sleep(Duration::from_millis(10));
                            }
                        }
                    })
                    .map_err(|e| e.to_string())?,
            );
        }

        *MONITOR.get_or_init(|| Mutex::new(None)).lock() = Some(MonitorSession {
            stop,
            levels,
            threads,
        });
        Ok(())
    }

    pub fn stop_monitor() {
        if let Some(session) = MONITOR.get_or_init(|| Mutex::new(None)).lock().take() {
            session.stop.store(true, Ordering::Relaxed);
            for t in session.threads {
                let _ = t.join();
            }
        }
    }

    pub fn monitor_levels() -> AudioLevels {
        MONITOR
            .get_or_init(|| Mutex::new(None))
            .lock()
            .as_ref()
            .map(|s| s.levels.lock().clone())
            .unwrap_or_default()
    }

    pub fn monitor_active() -> bool {
        MONITOR
            .get_or_init(|| Mutex::new(None))
            .lock()
            .is_some()
    }

    pub struct RecordingAudio {
        stop: Arc<AtomicBool>,
        thread: JoinHandle<Result<(), String>>,
        pcm_path: PathBuf,
    }

    impl RecordingAudio {
        pub fn start(
            settings: AudioSettings,
            session_rx: Receiver<Instant>,
            session_target: Arc<AtomicU64>,
            pcm_path: PathBuf,
        ) -> Result<(Self, PathBuf), String> {
            if settings.source == AudioSourceMode::None {
                return Err("audio disabled".into());
            }
            stop_monitor();
            std::thread::sleep(Duration::from_millis(120));
            let _ = std::fs::remove_file(&pcm_path);
            let pcm_for_thread = pcm_path.clone();
            let stop = Arc::new(AtomicBool::new(false));
            let stop_t = stop.clone();
            let thread = std::thread::Builder::new()
                .name("audio-rec".into())
                .spawn(move || {
                    run_recording_pcm(
                        pcm_for_thread,
                        settings,
                        stop_t,
                        session_rx,
                        session_target,
                    )
                })
                .map_err(|e| e.to_string())?;
            Ok((
                Self {
                    stop,
                    thread,
                    pcm_path: pcm_path.clone(),
                },
                pcm_path,
            ))
        }

        pub fn stop_flag(&self) -> Arc<AtomicBool> {
            self.stop.clone()
        }

        pub fn pcm_path(&self) -> &PathBuf {
            &self.pcm_path
        }

        pub fn stop(self) -> Result<(), String> {
            self.stop.store(true, Ordering::Relaxed);
            match self.thread.join() {
                Ok(Ok(())) => Ok(()),
                Ok(Err(e)) => Err(e),
                Err(_) => Err("audio thread panicked".into()),
            }
        }
    }

    fn spawn_capture_feeder(
        open: impl FnOnce() -> Result<CaptureStream, String> + Send + 'static,
        queue: Arc<Mutex<SampleQueue>>,
        stop: Arc<AtomicBool>,
        name: &'static str,
    ) -> JoinHandle<()> {
        std::thread::Builder::new()
            .name(name.into())
            .spawn(move || {
                match open() {
                    Ok(mut cap) => {
                        capture_log(&format!("{name} capture started"));
                        let mut peaks = 0u32;
                        while !stop.load(Ordering::Relaxed) {
                            for _ in 0..16 {
                                if stop.load(Ordering::Relaxed) {
                                    break;
                                }
                                match cap.read_samples_recording() {
                                    Ok(samples) if !samples.is_empty() => {
                                        let p = peak(&samples);
                                        if p > 0.001 {
                                            peaks += 1;
                                        }
                                        queue.lock().push(samples);
                                    }
                                    Ok(_) => {}
                                    Err(e) => {
                                        capture_log(&format!("WARN: {name} read error: {e}"));
                                        break;
                                    }
                                }
                            }
                        }
                        capture_log(&format!("{name} capture stopped ({peaks} non-silent reads)"));
                    }
                    Err(e) => capture_log(&format!("ERROR: {name} failed to open: {e}")),
                }
            })
            .expect("spawn capture feeder")
    }

    fn apply_mic_sync(system_q: &mut SampleQueue, mic_q: &mut SampleQueue, delay_ms: i32) {
        if delay_ms == 0 {
            return;
        }
        let frames =
            (delay_ms.unsigned_abs() as f64 * SAMPLE_RATE as f64 / 1000.0).round() as usize;
        if delay_ms > 0 {
            mic_q.delay_frames(frames);
        } else {
            system_q.delay_frames(frames);
        }
    }

    fn available_mix_frames(
        settings: &AudioSettings,
        system_q: &SampleQueue,
        mic_q: &SampleQueue,
    ) -> usize {
        match (wants_system(settings.source), wants_mic(settings.source)) {
            (true, true) => system_q.len_frames().min(mic_q.len_frames()),
            (true, false) => system_q.len_frames(),
            (false, true) => mic_q.len_frames(),
            (false, false) => 0,
        }
    }

    fn write_pcm_block<W: Write>(
        writer: &mut W,
        settings: &AudioSettings,
        system_q: &Arc<Mutex<SampleQueue>>,
        mic_q: &Arc<Mutex<SampleQueue>>,
        frames: usize,
        buf: &mut [u8],
    ) -> Result<f32, String> {
        let sys = if wants_system(settings.source) {
            Some(system_q.lock().take_frames(frames))
        } else {
            None
        };
        let mic = if wants_mic(settings.source) {
            Some(mic_q.lock().take_frames(frames))
        } else {
            None
        };
        let peak = mix_to_s16(
            sys.as_deref(),
            mic.as_deref(),
            settings.system_gain,
            settings.mic_gain,
            frames,
            &mut buf[..frames * BYTES_PER_FRAME],
        );
        writer
            .write_all(&buf[..frames * BYTES_PER_FRAME])
            .map_err(|e| format!("audio PCM write: {e}"))?;
        Ok(peak)
    }

    /// Drain every frame currently queued and write it, in `max_block` chunks.
    /// Returns the number of frames written and the peak seen.
    fn drain_available<W: Write>(
        writer: &mut W,
        settings: &AudioSettings,
        system_q: &Arc<Mutex<SampleQueue>>,
        mic_q: &Arc<Mutex<SampleQueue>>,
        max_block: usize,
        buf: &mut [u8],
    ) -> Result<(u64, f32), String> {
        let mut written = 0u64;
        let mut peak_max = 0.0f32;
        loop {
            let avail = {
                let sys = system_q.lock();
                let mic = mic_q.lock();
                available_mix_frames(settings, &sys, &mic)
            };
            if avail == 0 {
                break;
            }
            let chunk = avail.min(max_block);
            let peak = write_pcm_block(writer, settings, system_q, mic_q, chunk, buf)?;
            peak_max = peak_max.max(peak);
            written += chunk as u64;
        }
        Ok((written, peak_max))
    }

    /// Write `frames` of stereo digital silence (zero PCM) to the sidecar, reusing
    /// `buf` in `max_block`-sized chunks. Used to bridge real-time gaps where a
    /// loopback endpoint delivered no packets, keeping audio locked to the wall
    /// clock without a mux-time tempo stretch.
    fn write_silence<W: Write>(
        writer: &mut W,
        frames: usize,
        buf: &mut [u8],
    ) -> Result<(), String> {
        if frames == 0 {
            return Ok(());
        }
        let frames_per_chunk = (buf.len() / BYTES_PER_FRAME).max(1);
        let mut remaining = frames;
        while remaining > 0 {
            let chunk = remaining.min(frames_per_chunk);
            let bytes = chunk * BYTES_PER_FRAME;
            for b in buf[..bytes].iter_mut() {
                *b = 0;
            }
            writer
                .write_all(&buf[..bytes])
                .map_err(|e| format!("write PCM silence: {e}"))?;
            remaining -= chunk;
        }
        Ok(())
    }

    fn run_recording_pcm(
        pcm_path: PathBuf,
        settings: AudioSettings,
        stop: Arc<AtomicBool>,
        session_rx: Receiver<Instant>,
        session_target: Arc<AtomicU64>,
    ) -> Result<(), String> {
        com_init();
        // session_target is no longer used to gate writes — audio runs at the
        // device clock and is locked to the video duration at mux time.
        let _ = session_target;

        let file = File::create(&pcm_path).map_err(|e| format!("create PCM sidecar: {e}"))?;
        let mut writer = BufWriter::with_capacity(256 * 1024, file);

        let system_q = Arc::new(Mutex::new(SampleQueue::new()));
        let mic_q = Arc::new(Mutex::new(SampleQueue::new()));

        // Open + start the capture devices BEFORE the session clock begins, so
        // the 50–200 ms device-open latency is absorbed during pre-roll and the
        // recording never loses its head (a constant lip-sync offset otherwise).
        let mut feeders = Vec::new();
        if wants_system(settings.source) {
            feeders.push(spawn_capture_feeder(
                || CaptureStream::open_loopback(),
                system_q.clone(),
                stop.clone(),
                "audio-rec-sys",
            ));
        }
        if wants_mic(settings.source) {
            let mic_id = settings.microphone_id.clone();
            feeders.push(spawn_capture_feeder(
                move || CaptureStream::open_microphone(mic_id.as_deref()),
                mic_q.clone(),
                stop.clone(),
                "audio-rec-mic",
            ));
        }

        // t = 0 is defined by the video thread. If it never arrives, bail out
        // cleanly (and stop the feeders we already started).
        let session_start = match session_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(t) => t,
            Err(_) => {
                stop.store(true, Ordering::Relaxed);
                for feeder in feeders {
                    let _ = feeder.join();
                }
                return Err("audio never received session start".into());
            }
        };

        // Discard everything captured during pre-roll so audio and video share
        // the same t = 0, then apply the user's mic/system delay offset.
        {
            let mut sys = system_q.lock();
            let mut mic = mic_q.lock();
            sys.clear();
            mic.clear();
            apply_mic_sync(&mut sys, &mut mic, settings.mic_delay_ms);
        }

        let max_block = WRITE_BLOCK_FRAMES;
        let mut buf = vec![0u8; max_block * BYTES_PER_FRAME];
        let mut frames_written = 0u64;
        let mut silence_frames = 0u64;
        let mut mix_peak_max = 0.0f32;
        let mut in_gap = false;

        // Wall-clock locked capture. We write every real sample the device hands
        // us, in order — but some endpoints (notably WASAPI loopback on audio
        // interfaces like the Steinberg UR22) deliver NO packets at all during
        // silent stretches, so the captured stream runs short of real time and
        // drifts. We close that gap by inserting silence in real time against the
        // same wall clock the video uses, so the silence lands exactly where the
        // device went quiet instead of being smeared across the whole take by a
        // mux-time tempo stretch.
        //
        // GRACE absorbs normal capture latency (buffer depth, scheduling jitter)
        // so well-behaved devices — e.g. a 48 kHz default endpoint that already
        // stays in sync — never trip the gap filler and behave exactly as before.
        // It exceeds the capture buffer depth, so by the time we're this far
        // behind, any missing audio was genuinely never delivered (or already
        // dropped by WASAPI), making silence the correct reconstruction.
        const GRACE_FRAMES: u64 = (SAMPLE_RATE as u64) * 150 / 1000; // 150 ms
        while !stop.load(Ordering::Relaxed) {
            let (written, peak) =
                drain_available(&mut writer, &settings, &system_q, &mic_q, max_block, &mut buf)?;
            frames_written += written;
            mix_peak_max = mix_peak_max.max(peak);
            if written > 0 {
                in_gap = false;
            }

            // Compare what we've written to where the wall clock says we should
            // be. Only open a gap once we're more than GRACE behind (a real
            // silence gap, not ordinary latency); once open, top up to the wall
            // clock every pass so audio resumes tightly aligned.
            let target = (session_start.elapsed().as_secs_f64() * SAMPLE_RATE as f64) as u64;
            if !in_gap && frames_written + GRACE_FRAMES < target {
                in_gap = true;
            }
            if in_gap && frames_written < target {
                let deficit = (target - frames_written) as usize;
                write_silence(&mut writer, deficit, &mut buf)?;
                frames_written += deficit as u64;
                silence_frames += deficit as u64;
            }

            if written == 0 {
                std::thread::sleep(Duration::from_millis(2));
            }
        }

        // Stop the feeders, then drain whatever they captured up to the stop.
        for feeder in feeders {
            let _ = feeder.join();
        }
        let (tail, peak) =
            drain_available(&mut writer, &settings, &system_q, &mic_q, max_block, &mut buf)?;
        frames_written += tail;
        mix_peak_max = mix_peak_max.max(peak);

        writer
            .flush()
            .map_err(|e| format!("flush PCM sidecar: {e}"))?;

        let secs = frames_written as f64 / SAMPLE_RATE as f64;
        let silence_secs = silence_frames as f64 / SAMPLE_RATE as f64;
        let wall = session_start.elapsed().as_secs_f64();
        capture_log(&format!(
            "Audio PCM wrote {} bytes ({secs:.2}s total / {silence_secs:.2}s gap-filled / {wall:.2}s wall, wall-locked); mix peak {:.3}",
            frames_written * BYTES_PER_FRAME as u64,
            mix_peak_max
        ));
        Ok(())
    }
}

#[cfg(windows)]
pub use imp::{list_devices, monitor_active, monitor_levels, start_monitor, stop_monitor, RecordingAudio};

#[cfg(not(windows))]
use std::sync::Arc;
#[cfg(not(windows))]
use std::sync::atomic::{AtomicBool, AtomicU64};
#[cfg(not(windows))]
use std::sync::mpsc::Receiver;

#[cfg(not(windows))]
pub fn list_devices() -> Vec<AudioDeviceInfo> {
    vec![]
}

#[cfg(not(windows))]
pub fn start_monitor(_settings: AudioSettings) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn stop_monitor() {}

#[cfg(not(windows))]
pub fn monitor_active() -> bool {
    false
}

#[cfg(not(windows))]
pub fn monitor_levels() -> AudioLevels {
    AudioLevels::default()
}

#[cfg(not(windows))]
pub struct RecordingAudio;

#[cfg(not(windows))]
use std::sync::OnceLock;
#[cfg(not(windows))]
use std::path::PathBuf;
#[cfg(not(windows))]
impl RecordingAudio {
    pub fn start(
        _settings: AudioSettings,
        _session_rx: Receiver<Instant>,
        _session_target: Arc<AtomicU64>,
        _pcm_path: PathBuf,
    ) -> Result<(Self, PathBuf), String> {
        Err("audio capture is only supported on Windows".into())
    }
    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        Arc::new(AtomicBool::new(true))
    }
    pub fn pcm_path(&self) -> &PathBuf {
        static EMPTY: OnceLock<PathBuf> = OnceLock::new();
        EMPTY.get_or_init(PathBuf::new)
    }
    pub fn stop(self) -> Result<(), String> {
        Ok(())
    }
}

pub fn source_active(source: AudioSourceMode) -> bool {
    source != AudioSourceMode::None
}
