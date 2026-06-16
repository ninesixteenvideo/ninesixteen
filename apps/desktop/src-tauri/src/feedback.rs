use std::time::Duration;

const WEB_API_BASE: &str = env!("NS_WEB_API_BASE");
const MAX_LOG_BYTES: usize = 512 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FeedbackPayload {
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    send_logs: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    logs: Option<String>,
    app_version: String,
    platform: String,
    source: String,
}

/// Last N bytes of the diagnostic log (same file users see at ~/Videos/ninesixteen/ninesixteen.log).
pub fn read_log_tail(max_bytes: usize) -> Option<String> {
    let path = crate::log::log_path();
    let data = std::fs::read(&path).ok()?;
    if data.is_empty() {
        return Some(String::new());
    }
    if data.len() <= max_bytes {
        return String::from_utf8(data).ok();
    }
    let tail = &data[data.len() - max_bytes..];
    let start = tail.iter().position(|&b| b == b'\n').map(|i| i + 1).unwrap_or(0);
    String::from_utf8(tail[start..].to_vec()).ok()
}

fn parse_api_error(body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
            return err.to_string();
        }
    }
    if body.is_empty() {
        "Feedback could not be sent.".to_string()
    } else {
        body.to_string()
    }
}

#[tauri::command]
pub fn submit_feedback(message: String, email: Option<String>, send_logs: bool) -> Result<(), String> {
    let message = message.trim().to_string();
    if message.len() < 10 {
        return Err("Please enter at least 10 characters.".into());
    }
    if message.len() > 5000 {
        return Err("Message is too long (max 5000 characters).".into());
    }

    let email = email
        .map(|e| e.trim().to_string())
        .filter(|e| !e.is_empty());

    let logs = if send_logs {
        read_log_tail(MAX_LOG_BYTES)
    } else {
        None
    };

    let payload = FeedbackPayload {
        message,
        email,
        send_logs,
        logs,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        source: "desktop".to_string(),
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Could not send feedback: {e}"))?;

    let url = format!("{WEB_API_BASE}/api/feedback");
    let res = client
        .post(&url)
        .json(&payload)
        .send()
        .map_err(|e| format!("Could not send feedback: {e}"))?;

    if res.status().is_success() {
        return Ok(());
    }

    Err(parse_api_error(&res.text().unwrap_or_default()))
}
