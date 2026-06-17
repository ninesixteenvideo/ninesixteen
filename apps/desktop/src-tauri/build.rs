fn main() {
    tauri_build::build();

    let icon_dir = std::path::Path::new("icons");
    println!("cargo:rerun-if-changed=app-icon.png");
    println!("cargo:rerun-if-changed={}", icon_dir.join("icon.ico").display());
    println!("cargo:rerun-if-changed={}", icon_dir.join("icon-source.svg").display());

    let web_api_base = std::env::var("NS_WEB_API_BASE").unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            "http://localhost:3000".to_string()
        } else {
            "https://ninesixteen.video".to_string()
        }
    });
    println!("cargo:rustc-env=NS_WEB_API_BASE={web_api_base}");
    println!("cargo:rerun-if-env-changed=NS_WEB_API_BASE");

    println!("cargo:rerun-if-changed=shaders/crop_scale.hlsl");
}
