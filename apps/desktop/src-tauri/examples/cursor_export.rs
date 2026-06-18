//! Promote a black-matte JPEG/PNG to RGBA PNG (alpha=0 on pure black only). No resize.
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

fn dematte_pure_black(rgba: &mut image::RgbaImage) {
    for p in rgba.pixels_mut() {
        let [r, g, b, a] = p.0;
        if a > 0 && r == 0 && g == 0 && b == 0 {
            p.0[3] = 0;
        }
    }
}

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let src = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("resources/cursor/source.jpg"));
    let bytes = std::fs::read(&src).expect("read source");
    let mut rgba = image::load_from_memory(&bytes)
        .expect("decode source")
        .to_rgba8();
    dematte_pure_black(&mut rgba);
    let (hx, hy) = hotspot_for(&rgba);

    let out_tauri = root.join("resources/cursor/default.png");
    let out_public = root.join("../public/cursor/default.png");
    let out_meta_tauri = root.join("resources/cursor/cursor.json");
    let out_meta_public = root.join("../public/cursor/cursor.json");

    rgba.save(&out_tauri).expect("save default.png");
    rgba.save(&out_public).expect("save public default.png");

    let meta = format!(
        "{{\n  \"width\": {},\n  \"height\": {},\n  \"hotspotX\": {hx},\n  \"hotspotY\": {hy}\n}}\n",
        rgba.width(),
        rgba.height()
    );
    std::fs::write(&out_meta_tauri, &meta).expect("write cursor.json");
    std::fs::write(&out_meta_public, &meta).expect("write public cursor.json");
    println!(
        "Exported {}x{} PNG, hotspot ({hx}, {hy})",
        rgba.width(),
        rgba.height()
    );
}
