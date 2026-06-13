use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone, Copy, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    Landscape,
    Portrait,
}

impl Orientation {
    pub fn aspect(self) -> f64 {
        match self {
            Orientation::Landscape => 16.0 / 9.0,
            Orientation::Portrait => 9.0 / 16.0,
        }
    }
}

#[derive(Clone, Copy, Serialize, Deserialize, Debug)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
    pub rotation: f64,
    pub orientation: Orientation,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            x: 960.0,
            y: 540.0,
            zoom: 1.0,
            rotation: 0.0,
            orientation: Orientation::Portrait,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MonitorInfo {
    pub id: i64,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    /// Top-left of this monitor in virtual screen coordinates.
    #[serde(default)]
    pub origin_x: i32,
    #[serde(default)]
    pub origin_y: i32,
}

#[derive(Clone, Copy, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InputSettings {
    pub zoom_sensitivity: f64,
}

impl Default for InputSettings {
    fn default() -> Self {
        Self {
            zoom_sensitivity: 1.0,
        }
    }
}

#[derive(Clone, Copy, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSettings {
    pub orientation: Orientation,
    pub fps: u32,
    pub quality: u32,
    pub capture_cursor: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamSettings {
    pub server_url: String,
    pub stream_key: String,
    pub bitrate_kbps: u32,
}

impl Default for StreamSettings {
    fn default() -> Self {
        Self {
            server_url: "rtmp://live.twitch.tv/app".to_string(),
            stream_key: String::new(),
            bitrate_kbps: 6000,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StreamStats {
    pub bytes_sent: u64,
    pub frames_sent: u64,
    pub connected: bool,
    pub error: Option<String>,
}

impl Default for RecordingSettings {
    fn default() -> Self {
        Self {
            orientation: Orientation::Portrait,
            fps: 60,
            quality: 1080,
            capture_cursor: true,
        }
    }
}

#[derive(Clone, Copy, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AudioSourceMode {
    None,
    System,
    Microphone,
    SystemAndMicrophone,
}

impl Default for AudioSourceMode {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub source: AudioSourceMode,
    /// WASAPI endpoint id; None = default microphone.
    pub microphone_id: Option<String>,
    /// 0.0–2.0 calibration gain for system loopback.
    pub system_gain: f32,
    /// 0.0–2.0 calibration gain for microphone.
    pub mic_gain: f32,
    /// Delay microphone vs system when both are active (-500..500 ms).
    pub mic_delay_ms: i32,
    pub calibrated: bool,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            source: AudioSourceMode::None,
            microphone_id: None,
            system_gain: 1.0,
            mic_gain: 1.0,
            mic_delay_ms: 0,
            calibrated: false,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevels {
    pub system: f32,
    pub mic: f32,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CaptureState {
    pub monitor: Option<MonitorInfo>,
    pub viewport: Viewport,
    pub recording: bool,
    pub streaming: bool,
    pub elapsed: f64,
    pub stream_elapsed: f64,
    pub output_width: u32,
    pub output_height: u32,
    pub stream_stats: StreamStats,
    /// User preference: show the on-desktop frame when idle.
    pub overlay_visible: bool,
    pub camera_enabled: bool,
    pub camera_connected: bool,
    /// True during the 5s pre-record countdown (overlay visible, not yet capturing).
    pub recording_armed: bool,
    pub countdown_seconds: u8,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RecordingInfo {
    pub id: String,
    pub path: String,
    pub filename: String,
    pub created_at: i64,
    pub duration: f64,
    pub size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub orientation: Orientation,
}

/// Live viewport + cursor-follow state — isolated mutex so pan never waits on capture/UI.
pub struct ViewportState {
    pub viewport: Viewport,
    /// Scroll wheel adjusts this; `viewport.zoom` eases toward it each tick.
    pub zoom_target: f64,
    pub monitor: Option<MonitorInfo>,
    pub zoom_sensitivity: f64,
}

impl Default for ViewportState {
    fn default() -> Self {
        Self {
            viewport: Viewport::default(),
            zoom_target: 1.0,
            monitor: None,
            zoom_sensitivity: 1.0,
        }
    }
}

pub type SharedViewport = Arc<Mutex<ViewportState>>;

pub fn new_shared_viewport() -> SharedViewport {
    Arc::new(Mutex::new(ViewportState::default()))
}

/// Everything the app needs to share across the UI, capture and input threads.
pub struct AppState {
    pub recording: bool,
    pub streaming: bool,
    pub input_settings: InputSettings,
    pub recording_settings: RecordingSettings,
    pub audio_settings: AudioSettings,
    pub stream_settings: StreamSettings,
    pub stream_stats: StreamStats,
    pub overlay_visible: bool,
    pub camera_enabled: bool,
    pub camera_connected: bool,
    /// Pre-record countdown — user positions the frame before capture starts.
    pub recording_armed: bool,
    pub countdown_seconds: u8,

    // Active recording session bookkeeping.
    pub current_path: Option<PathBuf>,
    /// Wall clock when the user pressed Record (drives timer + CFR slots).
    pub session_start: Option<Instant>,
    pub current_start: Option<Instant>,
    pub stream_start: Option<Instant>,
    pub current_dims: (u32, u32),
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            recording: false,
            streaming: false,
            input_settings: InputSettings::default(),
            recording_settings: RecordingSettings::default(),
            audio_settings: AudioSettings::default(),
            stream_settings: StreamSettings::default(),
            stream_stats: StreamStats::default(),
            overlay_visible: false,
            camera_enabled: false,
            camera_connected: false,
            recording_armed: false,
            countdown_seconds: 0,
            current_path: None,
            session_start: None,
            current_start: None,
            stream_start: None,
            current_dims: (1920, 1080),
        }
    }
}

pub type SharedState = Arc<Mutex<AppState>>;

pub fn new_shared() -> SharedState {
    Arc::new(Mutex::new(AppState::default()))
}

/// Cached Pro entitlement for in-app media playback (`nsmedia://`) and export.
#[derive(Default)]
pub struct EntitlementCache {
    uid: Option<String>,
    pro: bool,
    pro_ends_at_ms: Option<i64>,
}

impl EntitlementCache {
    pub fn apply(&mut self, uid: &str, pro: bool, pro_ends_at_ms: Option<i64>) {
        self.uid = Some(uid.to_string());
        self.pro = pro;
        self.pro_ends_at_ms = pro_ends_at_ms;
    }

    pub fn set_pro(&mut self, pro: bool) {
        self.pro = pro;
    }

    pub fn clear(&mut self) {
        self.uid = None;
        self.pro = false;
        self.pro_ends_at_ms = None;
    }

    /// Active Pro subscription (respects proEndsAt; survives offline once cached).
    pub fn is_pro(&self) -> bool {
        if !self.pro {
            return false;
        }
        if let Some(ends) = self.pro_ends_at_ms {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            if ends <= now {
                return false;
            }
        }
        true
    }
}

pub type SharedEntitlement = Arc<Mutex<EntitlementCache>>;

pub fn new_shared_entitlement() -> SharedEntitlement {
    Arc::new(Mutex::new(EntitlementCache::default()))
}

static GLOBAL_ENTITLEMENT: std::sync::OnceLock<SharedEntitlement> = std::sync::OnceLock::new();

/// Shared entitlement cache — used by `nsmedia` (no app state handle) and Tauri commands.
pub fn global_entitlement() -> SharedEntitlement {
    GLOBAL_ENTITLEMENT
        .get_or_init(new_shared_entitlement)
        .clone()
}

/// Single Tauri-managed handle — avoids dual `.manage()` linker issues on Windows.
#[derive(Clone)]
pub struct AppHandles {
    pub state: SharedState,
    pub viewport: SharedViewport,
    pub entitlement: SharedEntitlement,
}

pub fn new_app_handles() -> AppHandles {
    AppHandles {
        state: new_shared(),
        viewport: new_shared_viewport(),
        entitlement: global_entitlement(),
    }
}