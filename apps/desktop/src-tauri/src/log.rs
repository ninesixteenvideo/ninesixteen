use crate::recordings::recordings_dir;
use std::io::Write;

/// Append to ~/Videos/ninesixteen/ninesixteen.log (visible even when stderr is detached).
pub fn capture_log(msg: &str) {
    eprintln!("[ninesixteen] {msg}");
    let log_path = recordings_dir().join("ninesixteen.log");
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(f, "[{ts}] {msg}");
    }
}
