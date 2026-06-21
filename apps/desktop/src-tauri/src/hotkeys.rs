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
    } else if shortcut.matches(Modifiers::ALT, Code::KeyF) {
        let _ = crate::rawinput::toggle_frame_frozen();
    } else if shortcut.matches(Modifiers::ALT, Code::ArrowUp) {
        let _ = crate::rawinput::queue_keyboard_zoom(1.0);
    } else if shortcut.matches(Modifiers::ALT, Code::ArrowDown) {
        let _ = crate::rawinput::queue_keyboard_zoom(-1.0);
    } else if shortcut.matches(Modifiers::ALT, Code::KeyP) {
        let _ = app.emit("hotkey:promo-portrait", ());
    } else if shortcut.matches(Modifiers::ALT, Code::KeyL) {
        let _ = app.emit("hotkey:promo-landscape", ());
    }
}
