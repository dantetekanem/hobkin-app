fn main() {
    // The icons are read into the binary when it compiles, and cargo does not track them by itself, so a new icon
    // waited for an unrelated Rust change before the app showed it.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
