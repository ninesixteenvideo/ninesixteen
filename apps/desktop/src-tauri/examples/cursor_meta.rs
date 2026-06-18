//! Print cursor.json metadata from a raw PNG (no resize, no matte strip).
use std::env;
use std::path::PathBuf;

fn hotspot_for(rgba: &image::RgbaImage) -> (u32, u32) {
    let mut best = u32::MAX;
    let mut hx = 0u32;
    let mut hy = 0u32;
    for y in 0..rgba.height() {
        for x in 0..rgba.width() {
            if rgba.get_pixel(x, y)[3] > 128 {
                let score = x + y;
                if score < best {
                    best = score;
                    hx = x;
                    hy = y;
                }
            }
        }
    }
    (hx, hy)
}

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let path = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("resources/cursor/default.png"));
    let bytes = std::fs::read(&path).expect("read image");
    let rgba = image::load_from_memory(&bytes)
        .expect("decode image")
        .to_rgba8();
    let (hx, hy) = hotspot_for(&rgba);
    println!(
        "{{\n  \"width\": {},\n  \"height\": {},\n  \"hotspotX\": {hx},\n  \"hotspotY\": {hy}\n}}",
        rgba.width(),
        rgba.height()
    );
}
