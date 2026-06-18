//! Prepare cursor PNG: crop, resize to 64×64, transparent matte, hotspot at tip.
//! Pass `--fill-infill` for black-outline Icons8-style assets.
use image::imageops::FilterType;
use image::RgbaImage;
use std::collections::VecDeque;
use std::env;
use std::path::PathBuf;

const TARGET_PX: u32 = 256;
const FILL_FRAC: f32 = 0.86;
const MIN_RECOMMENDED_SOURCE: u32 = 512;

fn is_dark_opaque(p: [u8; 4]) -> bool {
    let [r, g, b, a] = p;
    a > 128 && r < 96 && g < 96 && b < 96
}

fn fill_infill_white(rgba: &mut RgbaImage) {
    let w = rgba.width();
    let h = rgba.height();
    if w == 0 || h == 0 {
        return;
    }

    let idx = |x: u32, y: u32| (y * w + x) as usize;
    let mut outline = vec![false; (w * h) as usize];

    for y in 0..h {
        for x in 0..w {
            if !is_dark_opaque(rgba.get_pixel(x, y).0) {
                continue;
            }
            let mut edge = false;
            'neighbors: for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        edge = true;
                        break 'neighbors;
                    }
                    if rgba.get_pixel(nx as u32, ny as u32).0[3] < 128 {
                        edge = true;
                        break 'neighbors;
                    }
                }
            }
            outline[idx(x, y)] = edge;
        }
    }

    let mut seed_x = 0u32;
    let mut seed_y = 0u32;
    let mut best = u32::MAX;
    for y in 0..h {
        for x in 0..w {
            if is_dark_opaque(rgba.get_pixel(x, y).0) {
                let score = x + y;
                if score < best {
                    best = score;
                    seed_x = x;
                    seed_y = y;
                }
            }
        }
    }
    let seed_x = seed_x.saturating_add(8).min(w.saturating_sub(1));
    let seed_y = seed_y.saturating_add(8).min(h.saturating_sub(1));

    let mut visited = vec![false; (w * h) as usize];
    let mut queue = VecDeque::new();
    queue.push_back((seed_x, seed_y));
    visited[idx(seed_x, seed_y)] = true;

    while let Some((x, y)) = queue.pop_front() {
        if is_dark_opaque(rgba.get_pixel(x, y).0) {
            continue;
        }
        rgba.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
        for (nx, ny) in [
            (x.wrapping_sub(1), y),
            (x + 1, y),
            (x, y.wrapping_sub(1)),
            (x, y + 1),
        ] {
            if nx >= w || ny >= h {
                continue;
            }
            let i = idx(nx, ny);
            if visited[i] || is_dark_opaque(rgba.get_pixel(nx, ny).0) {
                continue;
            }
            visited[i] = true;
            queue.push_back((nx, ny));
        }
    }

    for y in 0..h {
        for x in 0..w {
            let i = idx(x, y);
            if is_dark_opaque(rgba.get_pixel(x, y).0) && !outline[i] {
                rgba.put_pixel(x, y, image::Rgba([255, 255, 255, 255]));
            }
        }
    }
}

fn strip_matte(rgba: &mut RgbaImage) {
    for p in rgba.pixels_mut() {
        let [r, g, b, a] = p.0;
        // Transparent fringe + solid black export backgrounds (e.g. Screen Studio–style PNGs).
        if a < 8 || (r < 24 && g < 24 && b < 24) {
            p.0 = [0, 0, 0, 0];
        }
    }
}

fn content_bounds(rgba: &RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let mut min_x = u32::MAX;
    let mut min_y = u32::MAX;
    let mut max_x = 0u32;
    let mut max_y = 0u32;
    let mut any = false;
    for y in 0..rgba.height() {
        for x in 0..rgba.width() {
            if rgba.get_pixel(x, y)[3] > 24 {
                any = true;
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }
    }
    if !any {
        return None;
    }
    Some((min_x, min_y, max_x, max_y))
}

fn crop_to_content(rgba: &RgbaImage) -> RgbaImage {
    let Some((min_x, min_y, max_x, max_y)) = content_bounds(rgba) else {
        return rgba.clone();
    };
    let pad = 2u32;
    let x0 = min_x.saturating_sub(pad);
    let y0 = min_y.saturating_sub(pad);
    let x1 = (max_x + pad + 1).min(rgba.width());
    let y1 = (max_y + pad + 1).min(rgba.height());
    image::imageops::crop_imm(rgba, x0, y0, x1 - x0, y1 - y0).to_image()
}

fn fit_canvas(rgba: &RgbaImage, size: u32) -> RgbaImage {
    let cropped = crop_to_content(rgba);
    let max_dim = cropped.width().max(cropped.height()).max(1);
    let target = (size as f32 * FILL_FRAC).round().max(1.0) as u32;
    let scale = target as f32 / max_dim as f32;
    let nw = ((cropped.width() as f32 * scale).round() as u32).max(1);
    let nh = ((cropped.height() as f32 * scale).round() as u32).max(1);
    let resized = image::imageops::resize(&cropped, nw, nh, FilterType::Lanczos3);
    let mut canvas = RgbaImage::new(size, size);
    let ox = (size.saturating_sub(nw)) / 2;
    let oy = (size.saturating_sub(nh)) / 2;
    image::imageops::overlay(&mut canvas, &resized, ox as i64, oy as i64);
    canvas
}

fn hotspot_for(rgba: &RgbaImage) -> (u32, u32) {
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
    let args: Vec<String> = env::args().collect();
    let fill_infill = args.iter().any(|a| a == "--fill-infill");
    let src = args
        .iter()
        .skip(1)
        .find(|a| !a.starts_with("--"))
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("resources/cursor/default.png"));

    let mut rgba = image::open(&src).expect("open cursor").to_rgba8();
    let src_w = rgba.width();
    let src_h = rgba.height();
    if src_w.max(src_h) < MIN_RECOMMENDED_SOURCE {
        eprintln!(
            "WARN: source is {src_w}x{src_h} — use at least {MIN_RECOMMENDED_SOURCE}px on the long edge for Screen Studio–grade sharpness"
        );
    }
    strip_matte(&mut rgba);
    if fill_infill {
        fill_infill_white(&mut rgba);
        strip_matte(&mut rgba);
    }
    rgba = fit_canvas(&rgba, TARGET_PX);
    let (hx, hy) = hotspot_for(&rgba);

    let out_tauri = root.join("resources/cursor/default.png");
    let out_public = root.join("../public/cursor/default.png");
    let out_meta_tauri = root.join("resources/cursor/cursor.json");
    let out_meta_public = root.join("../public/cursor/cursor.json");
    rgba.save(&out_tauri).expect("save tauri cursor");
    rgba.save(&out_public).expect("save public cursor");
    let meta = format!(
        "{{\n  \"width\": {},\n  \"height\": {},\n  \"hotspotX\": {hx},\n  \"hotspotY\": {hy}\n}}\n",
        rgba.width(),
        rgba.height()
    );
    std::fs::write(&out_meta_tauri, &meta).expect("write cursor.json");
    std::fs::write(&out_meta_public, &meta).expect("write public cursor.json");
    println!(
        "Processed cursor → {}x{}, hotspot ({hx}, {hy})",
        rgba.width(),
        rgba.height()
    );
}
