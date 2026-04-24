use std::path::PathBuf;

fn main() {
    // In dev mode, Tauri resolves sidecars next to the compiled binary rather
    // than from src-tauri/. Copy each sidecar there automatically so
    // `cargo run` / `npm run tauri dev` works without a manual step.
    // Production builds bundle via `externalBin` in tauri.conf.json; Tauri
    // places binaries directly in Contents/MacOS/ (no subdirectory prefix).
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let target_triple = std::env::var("TARGET").expect("TARGET not set");
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let is_windows = target_triple.contains("windows");

    let dest_dir = PathBuf::from(&manifest_dir)
        .join("target")
        .join(&profile);
    std::fs::create_dir_all(&dest_dir).unwrap_or_else(|_| ());

    // Add new sidecars here as they are introduced.
    for bin in &["exiftool", "mkvpropedit"] {
        let stem = format!("{bin}-{target_triple}");
        let filename = if is_windows {
            format!("{stem}.exe")
        } else {
            stem
        };
        let src = PathBuf::from(&manifest_dir).join(&filename);
        if src.exists() {
            let dest = dest_dir.join(&filename);
            if let Err(e) = std::fs::copy(&src, &dest) {
                println!("cargo:warning=Could not copy {bin} sidecar to {dest:?}: {e}");
            }
        }
    }

    tauri_build::build()
}
