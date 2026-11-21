//! What is behind the window's page (_specs/052-ten-times-lighter, A20). The window starts transparent with the desktop
//! blurred behind it, so a background opacity below 1 lets the desktop show. While the page paints a solid background
//! that only costs: WindowServer blends and blurs the window on every update, and never treats the windows behind it
//! as covered. So the window says how much of its own background shows, and at 1 the window becomes opaque in the
//! theme's color with nothing blurred behind it.

#[cfg(target_os = "macos")]
use objc2::msg_send;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
use tauri::window::Color;
use tauri::{Runtime, Webview};

use crate::browser::from_main;

/// How far the desktop behind the transparent window is blurred, like Ghostty's background-blur.
#[cfg(target_os = "macos")]
const BACKGROUND_BLUR_RADIUS: i32 = 20;

#[cfg(target_os = "macos")]
extern "C" {
    // Undocumented CoreGraphics calls, the ones Ghostty and Terminal.app use for a blurred translucent window.
    fn CGSDefaultConnectionForThread() -> *mut std::ffi::c_void;
    fn CGSSetWindowBackgroundBlurRadius(connection: *mut std::ffi::c_void, window: usize, radius: i32) -> i32;
}

/// Blurs what is behind the window by `radius` points, or not at all with 0.
#[cfg(target_os = "macos")]
fn blur(ns_window: &AnyObject, radius: i32) {
    // SAFETY: ns_window is the live NSWindow of this window; windowNumber takes no arguments and returns an NSInteger.
    unsafe {
        let number: isize = msg_send![ns_window, windowNumber];
        CGSSetWindowBackgroundBlurRadius(CGSDefaultConnectionForThread(), number as usize, radius);
    }
}

/// Blurs what is behind the window as it opens. The window stays transparent, so the app's own background opacity
/// decides how much shows, until the page says otherwise with `window_backdrop`.
#[cfg(target_os = "macos")]
pub fn blur_behind(window: &tauri::WebviewWindow) {
    let Ok(ns_window) = window.ns_window() else { return };
    // SAFETY: Tauri hands the live NSWindow of this window.
    blur(unsafe { &*(ns_window as *const AnyObject) }, BACKGROUND_BLUR_RADIUS);
}

/// How much of the page's own background shows, from 0 to 1, and its color. At 1 the window is opaque in that color
/// with no blur behind it. Below 1 it is transparent with the desktop blurred behind it, as it opens.
#[tauri::command]
pub fn window_backdrop<R: Runtime>(webview: Webview<R>, opacity: f64, color: [u8; 3]) -> Result<(), String> {
    from_main(&webview)?;
    let solid = opacity >= 1.0;
    let [red, green, blue] = color;
    // The webview draws no background of its own, so this is what shows wherever the page has not drawn yet, as in a
    // resize: the theme's color, or nothing at all.
    let under = if solid { Color(red, green, blue, 255) } else { Color(0, 0, 0, 0) };
    let window = webview.window();
    window.set_background_color(Some(under)).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    if let Ok(ns_window) = window.ns_window() {
        // SAFETY: Tauri hands the live NSWindow of this window, and a command that is not async runs on the main
        // thread, where AppKit takes these. setOpaque: takes a BOOL and invalidateShadow nothing; neither returns a value.
        let ns_window = unsafe { &*(ns_window as *const AnyObject) };
        unsafe {
            let _: () = msg_send![ns_window, setOpaque: solid];
            let _: () = msg_send![ns_window, invalidateShadow];
        }
        blur(ns_window, if solid { 0 } else { BACKGROUND_BLUR_RADIUS });
    }
    Ok(())
}
