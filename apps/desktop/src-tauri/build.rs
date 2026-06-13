fn main() {
    tauri_build::build();
    println!("cargo:rerun-if-changed=shaders/crop_scale.hlsl");
}
