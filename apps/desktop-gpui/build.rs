#[path = "../../scripts/diagnostic-build.rs"]
mod diagnostic_build;

fn main() {
    diagnostic_build::emit();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // Export dispatch constructs media futures on the UI thread before Tokio can poll them.
        println!("cargo:rustc-link-arg-bin=cap-gpui=/STACK:16777216");
    }

    let icon = std::env::var("CAP_BRAND_ICON")
        .unwrap_or_else(|_| "../desktop/src-tauri/icons/icon.ico".to_string());
    println!("cargo:rerun-if-changed={icon}");
    println!("cargo:rerun-if-env-changed=CAP_BRAND_ICON");
    println!("cargo:rerun-if-env-changed=CAP_BRAND_NAME");
    println!("cargo:rerun-if-env-changed=CAP_BRAND_EXECUTABLE");
    let name = std::env::var("CAP_BRAND_NAME").unwrap_or_else(|_| "Cap".to_string());
    let executable =
        std::env::var("CAP_BRAND_EXECUTABLE").unwrap_or_else(|_| format!("{name}.exe"));
    tauri_winres::WindowsResource::new()
        .set_icon_with_id(&icon, "1")
        .set("ProductName", &name)
        .set("FileDescription", &name)
        .set("OriginalFilename", &executable)
        .compile()
        .expect("failed to compile the Cap Windows icon resource");
}
