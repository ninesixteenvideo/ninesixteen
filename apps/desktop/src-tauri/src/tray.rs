//! System tray — keeps the app reachable while the main window is minimized during capture.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

pub fn show_main_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "tray-show", "Show window", true, None::<&str>)?;
    let record = MenuItem::with_id(
        app,
        "tray-record",
        "Start / stop recording  (Alt+R)",
        true,
        None::<&str>,
    )?;
    let frame = MenuItem::with_id(
        app,
        "tray-frame",
        "Toggle frame  (Alt+V)",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &record,
            &frame,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .ok_or("missing app icon for tray")?
        .clone();

    TrayIconBuilder::new()
        .icon(icon)
        .tooltip("ninesixteen.video — 9×16 & 16×9 screen recorder")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-show" => show_main_window(app),
            "tray-record" => {
                let _ = app.emit("hotkey:toggle-recording", ());
            }
            "tray-frame" => {
                let _ = app.emit("hotkey:toggle-overlay", ());
            }
            "tray-quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Close the main window → hide to tray instead of quitting.
pub fn on_main_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}
