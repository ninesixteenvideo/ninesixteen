use crate::recordings::recordings_dir;
use std::io::Write;

fn sanitize_log_message(msg: &str) -> String {
    let mut out = msg.to_string();
    for pattern in ["Bearer ", "access_token=", "accessToken", "customToken", "id_token="] {
        if let Some(idx) = out.find(pattern) {
            let start = idx + pattern.len();
            let end = out[start..]
                .find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == '&')
                .map(|i| start + i)
                .unwrap_or(out.len());
            if end > start {
                out.replace_range(start..end, "[redacted]");
            }
        }
    }
    out
}

/// Append to ~/Videos/ninesixteen/ninesixteen.log (visible even when stderr is detached).
/// Sensitive token-like substrings are redacted before writing.
pub fn capture_log(msg: &str) {
    let safe = sanitize_log_message(msg);
    eprintln!("[ninesixteen] {safe}");
    let log_path = recordings_dir().join("ninesixteen.log");
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(f, "[{ts}] {safe}");
    }
}
