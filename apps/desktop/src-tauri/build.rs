fn icon_bytes_hash(path: &std::path::Path) -> u64 {
    use std::hash::{Hash, Hasher};
    let Ok(bytes) = std::fs::read(path) else {
        return 0;
    };
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

/// Windows embeds `icons/icon.ico` via a stable path in `resource.rc`. When only
/// the ICO bytes change, Cargo can skip relinking because the build-script output
/// looks identical. Writing a fingerprint into OUT_DIR forces a relink.
fn write_icon_fingerprint(app_icon: &std::path::Path, icon_ico: &std::path::Path) {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR");
    let stamp = format!(
        "app-icon={}\nicon.ico={}\n",
        icon_bytes_hash(app_icon),
        icon_bytes_hash(icon_ico)
    );
    let stamp_path = std::path::Path::new(&out_dir).join("icon-fingerprint.txt");
    let _ = std::fs::write(stamp_path, stamp);
}

fn main() {
    let icon_dir = std::path::Path::new("icons");
    let app_icon = std::path::Path::new("app-icon.png");
    let icon_ico = icon_dir.join("icon.ico");
    let icon_source = icon_dir.join("icon-source.svg");

    println!("cargo:rerun-if-changed={}", app_icon.display());
    println!("cargo:rerun-if-changed={}", icon_ico.display());
    println!("cargo:rerun-if-changed={}", icon_source.display());

    tauri_build::build();
    write_icon_fingerprint(app_icon, &icon_ico);

    let web_api_base = std::env::var("NS_WEB_API_BASE").unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            "http://localhost:3000".to_string()
        } else {
            "https://ninesixteen.video".to_string()
        }
    });
    println!("cargo:rustc-env=NS_WEB_API_BASE={web_api_base}");
    println!("cargo:rerun-if-env-changed=NS_WEB_API_BASE");

    println!("cargo:rerun-if-changed=../dist/index.html");
    println!("cargo:rerun-if-changed=../dist/assets");
}
