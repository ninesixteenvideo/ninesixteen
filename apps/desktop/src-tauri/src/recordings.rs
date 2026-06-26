use crate::state::{Orientation, RecordingInfo};
use std::path::PathBuf;

pub fn recordings_dir() -> PathBuf {
    let base = dirs::video_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("ninesixteen");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn new_recording_path(orientation: Orientation) -> PathBuf {
    let ts = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let tag = match orientation {
        Orientation::Landscape => "16x9",
        Orientation::Portrait => "9x16",
    };
    recordings_dir().join(format!("ns_{ts}_{tag}.mp4"))
}

pub fn save_metadata(info: &RecordingInfo) {
    let p = PathBuf::from(&info.path).with_extension("json");
    if let Ok(j) = serde_json::to_string_pretty(info) {
        let _ = std::fs::write(p, j);
    }
}

/// Encrypt any leftover plaintext `.mp4` recordings into `.ns` (one-time, on
/// startup) so nothing playable is ever left lying in the recordings folder.
pub fn migrate_plaintext() {
    let dir = recordings_dir();
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return;
    };
    for e in rd.flatten() {
        let path = e.path();
        if path.extension().and_then(|s| s.to_str()) != Some("mp4") {
            continue;
        }
        let ns = path.with_extension("ns");
        if ns.exists() {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        if crate::crypto::encrypt_file(&path, &ns).is_ok() {
            let _ = std::fs::remove_file(&path);
            // Point any existing sidecar at the encrypted file.
            let json = path.with_extension("json");
            if let Ok(txt) = std::fs::read_to_string(&json) {
                if let Ok(mut info) = serde_json::from_str::<RecordingInfo>(&txt) {
                    info.path = ns.to_string_lossy().into_owned();
                    save_metadata(&info);
                }
            }
        }
    }
}

pub fn list_recordings() -> Vec<RecordingInfo> {
    let dir = recordings_dir();
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let path = e.path();
            if path.extension().and_then(|s| s.to_str()) != Some("ns") {
                continue;
            }
            let stem = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let json = path.with_extension("json");
            if let Ok(txt) = std::fs::read_to_string(&json) {
                if let Ok(mut info) = serde_json::from_str::<RecordingInfo>(&txt) {
                    // Always trust the on-disk encrypted path / id.
                    info.path = path.to_string_lossy().into_owned();
                    info.id = stem;
                    out.push(info);
                    continue;
                }
            }
            // Fallback: synthesise minimal info from the file itself.
            let meta = std::fs::metadata(&path).ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let created = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let orientation = if stem.contains("_16x9") {
                Orientation::Landscape
            } else {
                Orientation::Portrait
            };
            out.push(RecordingInfo {
                path: path.to_string_lossy().into_owned(),
                filename: format!("{stem}.mp4"),
                id: stem,
                created_at: created,
                duration: 0.0,
                size_bytes: size,
                width: 0,
                height: 0,
                orientation,
            });
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

pub fn delete_recording(id: &str) {
    let dir = recordings_dir();
    let _ = std::fs::remove_file(thumb_path(id));
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let path = e.path();
            let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned());
            if stem.as_deref() == Some(id) {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

const THUMB_MAX_W: u32 = 168;
/// First N plaintext bytes to decrypt for thumbnail extraction (moov-at-front after faststart).
const THUMB_DECRYPT_BYTES: u64 = 64 * 1024 * 1024;

pub fn thumb_path(id: &str) -> PathBuf {
    recordings_dir().join(format!("{id}.thumb.jpg"))
}

/// Extract a small JPEG beside the take (from plaintext MP4). Idempotent.
#[cfg(windows)]
pub fn write_thumbnail_from_mp4(mp4: &std::path::Path, id: &str) -> Result<(), String> {
    use crate::ffmpeg_util::{ffmpeg_command, find_ffmpeg};
    use std::process::Stdio;

    if !mp4.exists() {
        return Err("recording mp4 missing".into());
    }
    let out = thumb_path(id);
    if let Some(parent) = out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let ffmpeg = find_ffmpeg()?;
    let vf = format!("scale={THUMB_MAX_W}:-2:flags=lanczos");
    let status = ffmpeg_command(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            "0.05",
            "-i",
        ])
        .arg(mp4)
        .args([
            "-frames:v",
            "1",
            "-vf",
            &vf,
            "-q:v",
            "5",
            "-y",
        ])
        .arg(&out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .status()
        .map_err(|e| format!("ffmpeg thumb: {e}"))?;
    if !status.success() {
        return Err("ffmpeg thumb failed".into());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn write_thumbnail_from_mp4(_mp4: &std::path::Path, _id: &str) -> Result<(), String> {
    Err("thumbnails unsupported".into())
}

#[cfg(windows)]
fn write_thumbnail_from_encrypted(ns: &std::path::Path, id: &str) -> Result<(), String> {
    let temp = std::env::temp_dir().join(format!("ns-thumb-{id}.mp4"));
    let written = crate::crypto::decrypt_prefix_to_file(ns, &temp, THUMB_DECRYPT_BYTES)
        .map_err(|e| format!("decrypt prefix for thumb: {e}"))?;
    if written < 4096 {
        let _ = std::fs::remove_file(&temp);
        return Err("encrypted recording too small for thumbnail".into());
    }
    let result = write_thumbnail_from_mp4(&temp, id);
    let _ = std::fs::remove_file(&temp);
    if result.is_err() {
        // Older files may have moov at the tail — fall back to full decrypt once.
        let full = std::env::temp_dir().join(format!("ns-thumb-full-{id}.mp4"));
        crate::crypto::decrypt_to_file(ns, &full).map_err(|e| format!("decrypt for thumb: {e}"))?;
        let retry = write_thumbnail_from_mp4(&full, id);
        let _ = std::fs::remove_file(&full);
        retry?;
    } else {
        result?;
    }
    Ok(())
}

#[cfg(windows)]
pub fn ensure_thumbnail(id: &str) -> Result<PathBuf, String> {
    let out = thumb_path(id);
    if out.exists() && out.metadata().map(|m| m.len()).unwrap_or(0) > 64 {
        return Ok(out);
    }
    let ns = recordings_dir().join(format!("{id}.ns"));
    if !ns.exists() {
        return Err("recording not found".into());
    }
    write_thumbnail_from_encrypted(&ns, id)?;
    Ok(out)
}

#[cfg(not(windows))]
pub fn ensure_thumbnail(_id: &str) -> Result<PathBuf, String> {
    Err("thumbnails unsupported".into())
}

/// Legacy IPC thumbnail (base64). Prefer `nsthumb://` URLs from the webview.
pub fn thumbnail_data_url(id: &str) -> String {
    use base64::Engine;
    let Ok(path) = ensure_thumbnail(id) else {
        return String::new();
    };
    let Ok(bytes) = std::fs::read(path) else {
        return String::new();
    };
    if bytes.is_empty() {
        return String::new();
    }
    format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn normalize_display_filename(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Name cannot be empty".into());
    }
    if trimmed.contains(['/', '\\', '\0']) {
        return Err("Name cannot contain path separators".into());
    }
    let base = trimmed
        .strip_suffix(".mp4")
        .or_else(|| trimmed.strip_suffix(".MP4"))
        .or_else(|| trimmed.strip_suffix(".ns"))
        .or_else(|| trimmed.strip_suffix(".NS"))
        .unwrap_or(trimmed);
    if base.is_empty() {
        return Err("Name cannot be empty".into());
    }
    Ok(format!("{base}.mp4"))
}

/// Update the display filename stored in a take's sidecar metadata.
pub fn rename_recording(id: &str, filename: &str) -> Result<RecordingInfo, String> {
    let filename = normalize_display_filename(filename)?;
    let ns = recordings_dir().join(format!("{id}.ns"));
    if !ns.exists() {
        return Err("Recording not found".into());
    }

    let json_path = recordings_dir().join(format!("{id}.json"));
    let mut info = if json_path.exists() {
        let txt = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
        serde_json::from_str::<RecordingInfo>(&txt).map_err(|e| e.to_string())?
    } else {
        let meta = std::fs::metadata(&ns).map_err(|e| e.to_string())?;
        RecordingInfo {
            id: id.to_string(),
            path: ns.to_string_lossy().into_owned(),
            filename: format!("{id}.mp4"),
            created_at: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
            duration: 0.0,
            size_bytes: meta.len(),
            width: 0,
            height: 0,
            orientation: Orientation::Portrait,
        }
    };

    info.path = ns.to_string_lossy().into_owned();
    info.id = id.to_string();
    info.filename = filename;
    save_metadata(&info);
    Ok(info)
}

/// Recording duration in seconds from sidecar metadata (0 if unknown).
pub fn recording_duration(id: &str) -> f64 {
    let json = recordings_dir().join(format!("{id}.json"));
    let Ok(txt) = std::fs::read_to_string(json) else {
        return 0.0;
    };
    serde_json::from_str::<RecordingInfo>(&txt)
        .map(|info| info.duration)
        .unwrap_or(0.0)
}
