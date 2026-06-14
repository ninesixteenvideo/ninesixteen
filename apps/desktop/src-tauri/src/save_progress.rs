//! Optional callback used while a recording is being finalized on disk.
//!
//! Also writes phase timing to `~/Videos/ninesixteen/ninesixteen.log` so we can
//! see which finalize step dominates on long recordings.

use crate::log::capture_log;
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

static REPORTER: OnceLock<Mutex<Option<Arc<dyn Fn(u8, &'static str) + Send + Sync>>>> = OnceLock::new();
static TIMING: OnceLock<Mutex<Option<SaveTiming>>> = OnceLock::new();
static HEARTBEAT_STOP: OnceLock<Mutex<Option<Arc<AtomicBool>>>> = OnceLock::new();

struct SaveTiming {
    started: Instant,
    last_mark: Instant,
    last_label: String,
    segments: Vec<(String, f64)>,
    last_encrypt_pct: u8,
}

pub fn set_reporter(reporter: Option<Arc<dyn Fn(u8, &'static str) + Send + Sync>>) {
    *REPORTER
        .get_or_init(|| Mutex::new(None))
        .lock() = reporter;
}

pub fn begin_timing() {
    let now = Instant::now();
    *TIMING.get_or_init(|| Mutex::new(None)).lock() = Some(SaveTiming {
        started: now,
        last_mark: now,
        last_label: "start".into(),
        segments: Vec::new(),
        last_encrypt_pct: 0,
    });
    capture_log("Save timing: begin");
}

pub fn end_timing() {
    stop_heartbeat();
    let Some(mut timing) = TIMING.get().and_then(|slot| slot.lock().take()) else {
        return;
    };

    let delta = timing.last_mark.elapsed().as_secs_f64();
    if delta >= 0.001 {
        timing.segments.push((timing.last_label.clone(), delta));
    }

    let total = timing.started.elapsed().as_secs_f64();
    let mut summary = format!("Save timing summary ({total:.2}s total):");
    for (label, secs) in &timing.segments {
        summary.push_str(&format!(" {label} {secs:.2}s;"));
    }
    capture_log(&summary.trim_end_matches(';'));
}

fn milestone_label(percent: u8, phase: &'static str) -> Option<&'static str> {
    match (phase, percent) {
        (_, 8) if phase == "starting" => Some("preparing"),
        ("finalizing", 12) => Some("worker join"),
        ("finalizing", 16) => Some("draining frames"),
        ("finalizing", 20) => Some("frames drained"),
        ("finalizing", 22) => Some("ffmpeg flush"),
        ("finalizing", 38) => Some("ffmpeg encode"),
        ("timing", 42) => Some("timing stretch"),
        ("timing", 48) => Some("timing stretch done"),
        ("finalizing", 52) => Some("recorder close"),
        ("audio", 55) => Some("audio mux"),
        ("audio", 62) => Some("audio mux done"),
        ("encrypting", 65) => Some("encrypt"),
        ("encrypting", 100) => Some("encrypt done"),
        _ => None,
    }
}

fn log_milestone(percent: u8, phase: &'static str) {
    let Some(label) = milestone_label(percent, phase) else {
        return;
    };

    let slot = TIMING.get_or_init(|| Mutex::new(None));
    let mut guard = slot.lock();
    let Some(timing) = guard.as_mut() else {
        return;
    };

    if phase == "encrypting" && percent != 65 && percent != 100 {
        if percent.saturating_sub(timing.last_encrypt_pct) < 10 {
            return;
        }
        timing.last_encrypt_pct = percent;
    }

    let delta = timing.last_mark.elapsed().as_secs_f64();
    let total = timing.started.elapsed().as_secs_f64();
    capture_log(&format!(
        "Save timing: {} → {} {:.2}s ({:.2}s total, {}%)",
        timing.last_label, label, delta, total, percent
    ));
    timing.segments.push((timing.last_label.clone(), delta));
    timing.last_label = label.to_string();
    timing.last_mark = Instant::now();
}

pub fn report(percent: u8, phase: &'static str) {
    log_milestone(percent, phase);
    if let Some(reporter) = REPORTER.get().and_then(|slot| slot.lock().clone()) {
        reporter(percent.min(100), phase);
    }
}

/// Smooth progress while a long-running step blocks (e.g. recorder worker join).
/// Returns a guard that stops the heartbeat when dropped.
pub fn start_heartbeat(from: u8, to: u8, est_secs: f64) -> HeartbeatGuard {
    stop_heartbeat();
    let stop = Arc::new(AtomicBool::new(false));
    *HEARTBEAT_STOP.get_or_init(|| Mutex::new(None)).lock() = Some(stop.clone());
    let from = from.min(to);
    let to = to.max(from);
    let est = est_secs.max(1.0);
    std::thread::Builder::new()
        .name("save-progress-heartbeat".into())
        .spawn(move || {
            let started = Instant::now();
            while !stop.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(400));
                if stop.load(Ordering::Acquire) {
                    break;
                }
                let elapsed = started.elapsed().as_secs_f64();
                let t = (elapsed / est).clamp(0.0, 0.95);
                let pct = from + ((to - from) as f64 * t).round() as u8;
                report(pct.min(to.saturating_sub(1)), "finalizing");
            }
        })
        .ok();
    HeartbeatGuard
}

pub struct HeartbeatGuard;

impl Drop for HeartbeatGuard {
    fn drop(&mut self) {
        stop_heartbeat();
    }
}

fn stop_heartbeat() {
    if let Some(slot) = HEARTBEAT_STOP.get() {
        if let Some(stop) = slot.lock().take() {
            stop.store(true, Ordering::Release);
        }
    }
}
