//! FFmpeg path discovery — shared by recording, streaming, etc.

use crate::log::capture_log;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Prevent black console windows when spawning FFmpeg from a GUI app.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Build a `Command` for FFmpeg (or any child process) without flashing a console on Windows.
pub fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub fn ffmpeg_command(path: &str) -> Command {
    hidden_command(path)
}

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
        if hidden_command(name)
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
