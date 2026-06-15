//! Global shortcuts — work while the main window is minimized during capture.

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutEvent, ShortcutState};

pub fn handle(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    if shortcut.matches(Modifiers::ALT, Code::KeyR) {
        let _ = app.emit("hotkey:toggle-recording", ());
    } else if shortcut.matches(Modifiers::ALT, Code::KeyV) {
        let _ = app.emit("hotkey:toggle-overlay", ());
    }
}
