//! Zero-copy H.264 recording via Media Foundation (`windows-capture::VideoEncoder`).

use crate::log::capture_log;
use std::path::Path;
use windows_capture::d3d11::SendDirectX;
use windows_capture::encoder::{
    AudioSettingsBuilder, ContainerSettingsBuilder, VideoEncoder, VideoEncoderError,
    VideoSettingsBuilder, VideoSettingsSubType,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DSurface;

pub fn prefer_hw_encode() -> bool {
    !std::env::var("NINESIXTEEN_FFMPEG_PIPE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub struct HwEncoder {
    inner: VideoEncoder,
}

impl HwEncoder {
    pub fn start(
        path: &Path,
        width: u32,
        height: u32,
        fps: u32,
        bitrate_kbps: u32,
    ) -> Result<Self, String> {
        let video = VideoSettingsBuilder::new(width, height)
            .sub_type(VideoSettingsSubType::H264)
            .bitrate(bitrate_kbps.saturating_mul(1000))
            .frame_rate(fps.max(1))
            .hardware_acceleration(true);
        let audio = AudioSettingsBuilder::new().disabled(true);
        let container = ContainerSettingsBuilder::new();
        let inner = VideoEncoder::new(video, audio, container, path)
            .map_err(map_encoder_err)?;
        capture_log(&format!(
            "MF GPU encoder ready → {} ({}x{} @ {}fps, {} kbps)",
            path.display(),
            width,
            height,
            fps,
            bitrate_kbps
        ));
        Ok(Self { inner })
    }

    pub fn send_surface(
        &mut self,
        surface: SendDirectX<IDirect3DSurface>,
        t_secs: f64,
    ) -> Result<(), String> {
        let ticks = (t_secs.max(0.0) * 10_000_000.0).round() as i64;
        self.inner
            .send_surface(surface, ticks)
            .map_err(map_encoder_err)
    }

    pub fn finish(self) -> Result<(), String> {
        self.inner.finish().map_err(map_encoder_err)
    }
}

fn map_encoder_err(e: VideoEncoderError) -> String {
    format!("MF encoder: {e}")
}
