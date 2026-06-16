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
            out.push(RecordingInfo {
                path: path.to_string_lossy().into_owned(),
                filename: format!("{stem}.mp4"),
                id: stem,
                created_at: created,
                duration: 0.0,
                size_bytes: size,
                width: 0,
                height: 0,
                orientation: Orientation::Landscape,
            });
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

pub fn delete_recording(id: &str) {
    let dir = recordings_dir();
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
