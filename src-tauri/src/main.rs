// The shell: one window that shows the UI. Starting and stopping the host arrives with _specs/002-host.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hobkin_lib::run()
}
