//! FFmpeg path discovery — shared by recording, streaming, etc.

use crate::log::capture_log;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

static BUNDLED_FFMPEG: OnceLock<PathBuf> = OnceLock::new();

pub fn set_bundled_ffmpeg(path: PathBuf) {
    capture_log(&format!("Using bundled FFmpeg: {}", path.display()));
    let _ = BUNDLED_FFMPEG.set(path);
}

pub fn require_ffmpeg() -> Result<(), String> {
    find_ffmpeg().map(|_| ())
}

pub fn find_ffmpeg() -> Result<String, String> {
    if let Some(p) = BUNDLED_FFMPEG.get() {
        if p.exists() {
            return Ok(p.to_string_lossy().into_owned());
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("ffmpeg.exe"));
            candidates.push(dir.join("resources").join("ffmpeg").join("ffmpeg.exe"));
            candidates.push(dir.join("ffmpeg").join("ffmpeg.exe"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(
            cwd.join("apps")
                .join("desktop")
                .join("src-tauri")
                .join("resources")
                .join("ffmpeg")
                .join("ffmpeg.exe"),
        );
        candidates.push(cwd.join("resources").join("ffmpeg").join("ffmpeg.exe"));
    }
    candidates.push(PathBuf::from("resources/ffmpeg/ffmpeg.exe"));

    for path in candidates {
        if path.exists() {
            return Ok(path.to_string_lossy().into_owned());
        }
    }

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

    Err("FFmpeg not found. Run: node scripts/fetch-ffmpeg.mjs".into())
}
