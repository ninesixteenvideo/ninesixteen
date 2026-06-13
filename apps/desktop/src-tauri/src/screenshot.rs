//! GDI-based monitor snapshot used as the preview backdrop. Returns a base64
//! PNG (no data: prefix). On any failure returns an empty string so the UI
//! falls back to a drawn gradient.

#[cfg(windows)]
pub fn monitor_thumbnail(max_w: u32) -> String {
    use base64::Engine;
    use std::ffi::c_void;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER,
        DIB_RGB_COLORS, HALFTONE, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

    unsafe {
        let sw = GetSystemMetrics(SM_CXSCREEN);
        let sh = GetSystemMetrics(SM_CYSCREEN);
        if sw <= 0 || sh <= 0 {
            return String::new();
        }

        // Target thumbnail size, preserving aspect.
        let scale = (max_w as f64 / sw as f64).min(1.0);
        let tw = ((sw as f64 * scale).round() as i32).max(2);
        let th = ((sh as f64 * scale).round() as i32).max(2);

        let screen_dc = GetDC(None);
        if screen_dc.is_invalid() {
            return String::new();
        }
        let mem_dc = CreateCompatibleDC(Some(screen_dc));
        let bmp = CreateCompatibleBitmap(screen_dc, tw, th);
        let old = SelectObject(mem_dc, bmp.into());

        SetStretchBltMode(mem_dc, HALFTONE);
        let ok = StretchBlt(mem_dc, 0, 0, tw, th, Some(screen_dc), 0, 0, sw, sh, SRCCOPY).as_bool();

        let mut buf = vec![0u8; (tw * th * 4) as usize];
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: tw,
                biHeight: -th, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                ..Default::default()
            },
            ..Default::default()
        };

        let got = GetDIBits(
            mem_dc,
            bmp,
            0,
            th as u32,
            Some(buf.as_mut_ptr() as *mut c_void),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Cleanup GDI objects.
        SelectObject(mem_dc, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(mem_dc);
        ReleaseDC(None, screen_dc);

        if !ok || got == 0 {
            return String::new();
        }

        // BGRA -> RGBA
        for px in buf.chunks_exact_mut(4) {
            px.swap(0, 2);
            px[3] = 255;
        }

        let img = match image::RgbaImage::from_raw(tw as u32, th as u32, buf) {
            Some(i) => i,
            None => return String::new(),
        };
        let mut png: Vec<u8> = Vec::new();
        if image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .is_err()
        {
            return String::new();
        }
        base64::engine::general_purpose::STANDARD.encode(&png)
    }
}

#[cfg(not(windows))]
pub fn monitor_thumbnail(_max_w: u32) -> String {
    String::new()
}
