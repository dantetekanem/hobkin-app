use block2::RcBlock;
use objc2::msg_send;
use objc2::rc::Weak;
use objc2::runtime::{AnyClass, AnyObject};
use std::ptr;

// AppKit device-independent modifier flags, minus Caps Lock (which need not be turned off to send).
const MODIFIERS: usize = 0xff_0000 & !(1 << 16);
const CONTROL: usize = 1 << 18;
const RETURN: u16 = 36;

/// Wry's child webviews decline performKeyEquivalent:, including the main view when
/// Tauri multi-webview support is enabled. Offer just Control-Return to WebKit first:
/// the focused composer can preventDefault, or AppKit can show its usual context menu.
///
/// # Safety
/// `view` must be the main WKWebView, on the main thread.
pub unsafe fn install(view: &AnyObject) {
    let (Some(events), Some(webkit)) = (AnyClass::get(c"NSEvent"), AnyClass::get(c"WKWebView"))
    else {
        return;
    };
    let view = Weak::new(view);
    let monitor: RcBlock<dyn Fn(*mut AnyObject) -> *mut AnyObject> =
        RcBlock::new(move |event: *mut AnyObject| {
            let Some(key) = event.as_ref() else {
                return event;
            };
            let code: u16 = msg_send![key, keyCode];
            let flags: usize = msg_send![key, modifierFlags];
            if code != RETURN || flags & MODIFIERS != CONTROL {
                return event;
            }
            let Some(view) = view.load() else {
                return event;
            };
            let window: *mut AnyObject = msg_send![key, window];
            let Some(window) = window.as_ref() else {
                return event;
            };
            let responder: *const AnyObject = msg_send![window, firstResponder];
            if !ptr::eq(responder, &*view) {
                return event;
            }
            let accepted: bool = msg_send![super(&*view, webkit), performKeyEquivalent: key];
            if accepted {
                ptr::null_mut()
            } else {
                event
            }
        });
    // NSEventMaskKeyDown only. No mouse events, other windows, or canvas webviews.
    let _: *mut AnyObject =
        msg_send![events, addLocalMonitorForEventsMatchingMask: 1u64 << 10, handler: &*monitor];
}
