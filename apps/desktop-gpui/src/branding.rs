macro_rules! from_env {
    ($name:literal, $default:expr) => {
        match option_env!($name) {
            Some(value) => value,
            None => $default,
        }
    };
}

pub const APP_IDENTIFIER: &str = from_env!("CAP_BRAND_IDENTIFIER", "so.cap.desktop");
pub const URL_SCHEME: &str = from_env!("CAP_BRAND_URL_SCHEME", "cap-desktop");
#[cfg(target_os = "windows")]
pub const EXECUTABLE_NAME: &str = from_env!("CAP_BRAND_EXECUTABLE", "Cap.exe");
pub const SERVER_URL: &str = from_env!("CAP_SERVER_URL", "https://cap.so");
pub const DOWNLOAD_URL: &str = from_env!("CAP_DOWNLOAD_URL", "https://cap.so/download");
pub const VERSIONS_URL: &str = from_env!("CAP_VERSIONS_URL", "https://cap.so/download/versions");
pub const SUPPORT_URL: &str = from_env!("CAP_SUPPORT_URL", "https://cap.link/discord");
pub const DOCS_STORAGE_URL: &str =
    from_env!("CAP_DOCS_STORAGE_URL", "https://cap.so/docs/s3-config");
pub const PRICING_URL: &str = from_env!("CAP_PRICING_URL", "https://cap.so/pricing?ref=desktop");
pub const LICENSE_API_BASE: &str = from_env!("CAP_LICENSE_API_BASE", "https://l.cap.so/api");
pub const UPDATE_ENDPOINT: &str = from_env!(
    "CAP_UPDATE_ENDPOINT",
    "https://cdn.crabnebula.app/update/cap/cap"
);
pub const UPDATER_PUBLIC_KEY: &str = from_env!(
    "CAP_UPDATER_PUBLIC_KEY",
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEUyOTAzOTdFNzJFQkRFOTMKUldTVDN1dHlmam1RNHFXb1VYTXlrQk1iMFFkcjN0YitqZlA5WnZNY0ZtQ1dvM1dxK211M3VIYUQK"
);
