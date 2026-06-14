//! Main-thread stall detector (AppHangB1 black-box recorder).
//!
//! A heartbeat is bumped from the main thread twice a second. A separate monitor
//! thread checks the heartbeat; if the main thread stops pumping for >2.5s we log
//! exactly which internal locks are held at that moment, so a hang names its own
//! culprit in `ninesixteen.log` instead of leaving us to guess.

use crate::state::{SharedState, SharedViewport};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::AppHandle;

static HEARTBEAT_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn start(app: AppHandle, state: SharedState, viewport: SharedViewport) {
    HEARTBEAT_MS.store(now_ms(), Ordering::Relaxed);

    // Bump the heartbeat from the main thread twice a second. If the main loop is
    // alive these callbacks run; if it deadlocks they stop and the gap grows.
    let bump = app.clone();
    std::thread::Builder::new()
        .name("wd-heartbeat".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            let _ = bump.run_on_main_thread(|| {
                HEARTBEAT_MS.store(now_ms(), Ordering::Relaxed);
            });
        })
        .ok();

    // Monitor: report stalls (edge-triggered) and recovery.
    std::thread::Builder::new()
        .name("wd-monitor".into())
        .spawn(move || {
            let mut stalled = false;
            let mut peak_gap = 0u64;
            loop {
                std::thread::sleep(Duration::from_millis(750));
                let gap = now_ms().saturating_sub(HEARTBEAT_MS.load(Ordering::Relaxed));
                if gap > 2500 {
                    peak_gap = peak_gap.max(gap);
                    if !stalled {
                        stalled = true;
                        let st = lock_tag(state.try_lock().is_none());
                        let vp = lock_tag(viewport.try_lock().is_none());
                        let caps = crate::capture::debug_lock_report();
                        let phase = {
                            // Re-acquire after the try above (it was released immediately).
                            match state.try_lock() {
                                Some(s) => format!(
                                    "recording={} armed={} streaming={} camera={}",
                                    s.recording, s.recording_armed, s.streaming, s.camera_enabled
                                ),
                                None => "state=HELD(unreadable)".to_string(),
                            }
                        };
                        crate::log::capture_log(&format!(
                            "WATCHDOG: main thread stalled {gap}ms — state_lock={st} viewport_lock={vp} {caps} | {phase}"
                        ));
                    }
                } else if stalled {
                    stalled = false;
                    crate::log::capture_log(&format!(
                        "WATCHDOG: main thread resumed (peak stall {peak_gap}ms)"
                    ));
                    peak_gap = 0;
                }
            }
        })
        .ok();
}

fn lock_tag(held: bool) -> &'static str {
    if held {
        "HELD"
    } else {
        "free"
    }
}
