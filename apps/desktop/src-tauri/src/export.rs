use crate::state::RecordingInfo;
use std::fs::File;
use std::path::{Path, PathBuf};

/// Default folder for exported MP4s: Documents/Videos.
pub fn export_dir() -> PathBuf {
    let dir = dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Videos");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn resolve_recording(id: &str) -> Result<RecordingInfo, String> {
    crate::recordings::list_recordings()
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Recording not found".to_string())
}

pub fn export_decrypted_mp4(rec: &RecordingInfo, dest: &Path) -> Result<(), String> {
    let src = PathBuf::from(&rec.path);
    if !src.exists() {
        return Err("Source file no longer exists".to_string());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create export folder: {e}"))?;
    }
    crate::crypto::decrypt_to_file(&src, dest).map_err(|e| format!("Export failed: {e}"))
}

pub fn export_recording_local(id: &str) -> Result<String, String> {
    let rec = resolve_recording(id)?;
    let dest = export_dir().join(&rec.filename);
    export_decrypted_mp4(&rec, &dest)?;
    Ok(dest.to_string_lossy().into_owned())
}

pub fn upload_recording_to_drive(id: &str, access_token: &str) -> Result<String, String> {
    let rec = resolve_recording(id)?;
    let src = PathBuf::from(&rec.path);
    if !src.exists() {
        return Err("Source file no longer exists".to_string());
    }

    let temp_dir = std::env::temp_dir().join("ninesixteen-export");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Temp folder: {e}"))?;
    let temp_mp4 = temp_dir.join(&rec.filename);
    export_decrypted_mp4(&rec, &temp_mp4)?;

    let result = upload_mp4_to_drive(&temp_mp4, &rec.filename, access_token);
    let _ = std::fs::remove_file(&temp_mp4);
    result
}

fn upload_mp4_to_drive(path: &Path, filename: &str, access_token: &str) -> Result<String, String> {
    let file_size = std::fs::metadata(path)
        .map_err(|e| format!("Read export file: {e}"))?
        .len();
    let file = File::open(path).map_err(|e| format!("Open export file: {e}"))?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60 * 30))
        .build()
        .map_err(|e| format!("HTTP client: {e}"))?;

    let init = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")
        .bearer_auth(access_token)
        .header("Content-Type", "application/json; charset=UTF-8")
        .header("X-Upload-Content-Type", "video/mp4")
        .header("X-Upload-Content-Length", file_size.to_string())
        .json(&serde_json::json!({
            "name": filename,
            "mimeType": "video/mp4",
        }))
        .send()
        .map_err(|e| format!("Drive upload start: {e}"))?;

    if !init.status().is_success() {
        let body = init.text().unwrap_or_default();
        return Err(format!("Drive upload start failed: {body}"));
    }

    let upload_url = init
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Drive upload URL missing".to_string())?
        .to_string();

    let upload = client
        .put(upload_url)
        .header("Content-Type", "video/mp4")
        .header("Content-Length", file_size.to_string())
        .body(reqwest::blocking::Body::sized(file, file_size))
        .send()
        .map_err(|e| format!("Drive upload: {e}"))?;

    if !upload.status().is_success() {
        let body = upload.text().unwrap_or_default();
        return Err(format!("Drive upload failed: {body}"));
    }

    let payload: serde_json::Value = upload
        .json()
        .map_err(|e| format!("Drive response: {e}"))?;
    let file_id = payload
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    Ok(format!("https://drive.google.com/file/d/{file_id}/view"))
}
