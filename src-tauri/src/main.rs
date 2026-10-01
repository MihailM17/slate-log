// Hide the terminal window on Windows release builds (it stays visible in
// debug builds so logs are still readable during development).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    slate_log_lib::run();
}
