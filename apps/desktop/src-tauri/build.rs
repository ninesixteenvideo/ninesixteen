fn main() {
    tauri_build::build();

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
