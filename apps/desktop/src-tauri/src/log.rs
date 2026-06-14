use crate::recordings::recordings_dir;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

static DEBUG_MODE: AtomicBool = AtomicBool::new(false);

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

fn debug_env_enabled() -> bool {
    std::env::var("NINESIXTEEN_DEBUG")
        .ok()
        .is_some_and(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
}

pub fn debug_enabled() -> bool {
    DEBUG_MODE.load(Ordering::Relaxed)
}

pub fn log_path() -> PathBuf {
    recordings_dir().join("ninesixteen.log")
}

#[cfg(windows)]
fn attach_debug_console() {
    use windows::Win32::System::Console::{AllocConsole, AttachConsole, ATTACH_PARENT_PROCESS};
    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS).is_err() {
            let _ = AllocConsole();
        }
    }
}

#[cfg(not(windows))]
fn attach_debug_console() {}

/// Call once at startup: panic hook, optional console, startup banner.
pub fn init() {
    let debug = debug_env_enabled();
    DEBUG_MODE.store(debug, Ordering::Relaxed);

    if debug {
        attach_debug_console();
        std::env::set_var("RUST_BACKTRACE", "1");
    }

    std::panic::set_hook(Box::new(|info| {
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".into()
        };
        let loc = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".into());
        capture_log(&format!("PANIC at {loc}: {payload}"));
        if debug_enabled() {
            eprintln!("{}", std::backtrace::Backtrace::force_capture());
        }
    }));

    let profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    capture_log(&format!(
        "App start ({profile}{})",
        if debug { ", NINESIXTEEN_DEBUG=1" } else { "" }
    ));
    capture_log(&format!("Log file: {}", log_path().display()));
    if debug {
        capture_log("Debug mode: console attached, RUST_BACKTRACE=1, panics logged here");
    }
}

/// Append to ~/Videos/ninesixteen/ninesixteen.log (visible even when stderr is detached).
/// Sensitive token-like substrings are redacted before writing.
pub fn capture_log(msg: &str) {
    let safe = sanitize_log_message(msg);
    eprintln!("[ninesixteen] {safe}");
    let log_path = log_path();
    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = writeln!(f, "[{ts}] {safe}");
        let _ = f.flush();
    }
}
