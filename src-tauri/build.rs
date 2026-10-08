use std::fs;
use std::path::Path;

/// `bundle.externalBin` makes tauri-build require `binaries/mochi-hook-<target-triple>[.exe]` to exist.
/// `npm run prepare:hook` puts the real binary there. So `cargo test` / `cargo build` also work on a fresh
/// checkout (and so the hook helper itself can be compiled first), create a clearly marked placeholder when
/// the file is missing. The installer refuses to use a placeholder.
fn ensure_sidecar_placeholder() {
    let triple = std::env::var("TARGET").unwrap_or_default();
    let ext = if triple.contains("windows") { ".exe" } else { "" };
    let dir = Path::new("binaries");
    let file = dir.join(format!("mochi-hook-{triple}{ext}"));
    if !file.exists() {
        let _ = fs::create_dir_all(dir);
        let _ = fs::write(&file, "MOCHI-HOOK-PLACEHOLDER: run `npm run prepare:hook`\n");
        println!("cargo:warning=created a placeholder for {}; run `npm run prepare:hook` before bundling", file.display());
    }
}

fn main() {
    ensure_sidecar_placeholder();
    tauri_build::build()
}
