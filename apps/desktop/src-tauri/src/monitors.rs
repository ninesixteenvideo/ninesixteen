use crate::state::MonitorInfo;

#[cfg(windows)]
pub fn list_monitors() -> Vec<MonitorInfo> {
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO};
    use windows_capture::monitor::Monitor;

    fn monitor_origin(m: &Monitor) -> (i32, i32) {
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let ok = unsafe {
            GetMonitorInfoW(HMONITOR(m.as_raw_hmonitor()), &mut info).as_bool()
        };
        if ok {
            (info.rcMonitor.left, info.rcMonitor.top)
        } else {
            (0, 0)
        }
    }

    let mut out = Vec::new();
    let primary = Monitor::primary().ok();
    let primary_name = primary.as_ref().and_then(|m| m.name().ok());

    if let Ok(monitors) = Monitor::enumerate() {
        for (i, m) in monitors.into_iter().enumerate() {
            let name = m.name().unwrap_or_else(|_| format!("Display {}", i + 1));
            let width = m.width().unwrap_or(1920);
            let height = m.height().unwrap_or(1080);
            let is_primary = primary_name.as_deref() == Some(name.as_str());
            let (origin_x, origin_y) = monitor_origin(&m);
            out.push(MonitorInfo {
                id: i as i64,
                name,
                width,
                height,
                is_primary,
                origin_x,
                origin_y,
            });
        }
    }

    if out.is_empty() {
        out.push(MonitorInfo {
            id: 0,
            name: "Primary Display".into(),
            width: 1920,
            height: 1080,
            is_primary: true,
            origin_x: 0,
            origin_y: 0,
        });
    }

    out
}

#[cfg(not(windows))]
pub fn list_monitors() -> Vec<MonitorInfo> {
    vec![MonitorInfo {
        id: 0,
        name: "Primary Display".into(),
        width: 1920,
        height: 1080,
        is_primary: true,
        origin_x: 0,
        origin_y: 0,
    }]
}
