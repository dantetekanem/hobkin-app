//! Run fixed interactions in WebKit's client world. A site's scripts share the DOM, not the agent's globals or refs.
use super::{text, Browser, Ordering};
use block2::RcBlock;
use objc2::{
    msg_send,
    runtime::{AnyClass, AnyObject},
};
use objc2_foundation::{NSError, NSPoint, NSRect, NSString};
use std::{ptr, sync::mpsc, time::Duration};
use tauri::{Manager, Runtime, Webview};

fn ready<R: Runtime>(view: &Webview<R>) -> bool {
    let state = view.state::<Browser>();
    state.current().as_deref() == Some(view.label()) && state.visible.load(Ordering::Acquire)
}

pub fn interact<R: Runtime>(view: &Webview<R>, script: String) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    let held = view.clone();
    view.with_webview(move |platform| {
        if !ready(&held) { let _ = tx.send(Err("The visible canvas changed.".into())); return; }
        let completion = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            // SAFETY: WebKit supplies its result and NSError for the lifetime of this callback. Only NSString is read.
            let result = unsafe {
                if !error.is_null() { Err((*error).localizedDescription().to_string()) }
                else if value.is_null() { Err("No result from WebKit.".into()) }
                else {
                    let string: bool = msg_send![value, isKindOfClass: AnyClass::get(c"NSString").unwrap()];
                    if string { Ok((&*value.cast::<NSString>()).to_string()) }
                    else { Err("WebKit did not return an interaction result.".into()) }
                }
            };
            let _ = tx.send(result);
        });
        // SAFETY: with_webview runs on the main thread; WebKit copies the completion block. No IPC capability is given to the site.
        unsafe {
            let wk = &*platform.inner().cast::<AnyObject>();
            let world: *mut AnyObject = msg_send![AnyClass::get(c"WKContentWorld").unwrap(), defaultClientWorld];
            let _: () = msg_send![wk, evaluateJavaScript: &*NSString::from_str(&script), inFrame: ptr::null_mut::<AnyObject>(), inContentWorld: world, completionHandler: &*completion];
        }
    }).map_err(text)?;
    rx.recv_timeout(Duration::from_secs(6)).map_err(|_| {
        "WebKit did not confirm the action. Inspect the page before retrying.".to_owned()
    })?
}

// Only send input to this webview, never to the OS event queue, a file picker, or an unrelated window.
unsafe fn at_url(wk: &AnyObject, expected: &str) -> bool {
    let url: *mut AnyObject = msg_send![wk, URL];
    if url.is_null() {
        return false;
    }
    let address: *mut NSString = msg_send![url, absoluteString];
    !address.is_null() && (*address).to_string() == expected
}

#[derive(Clone, Copy, PartialEq)]
pub enum Pointer {
    Hover,
    Click,
    Upload,
}

pub fn pointer<R: Runtime>(
    view: &Webview<R>,
    point: &str,
    expected: String,
    action: Pointer,
) -> Result<String, String> {
    let [x, y]: [f64; 2] = serde_json::from_str(point).map_err(text)?;
    if ![x, y].iter().all(|v| (0.0..1.0).contains(v)) {
        return Err("Control is outside the canvas.".into());
    }
    let held = view.clone();
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |platform| {
        // SAFETY: WKWebView is the child on its AppKit thread; hitTest is restricted to descendants of that view.
        let result = (|| unsafe {
            let wk = &*platform.inner().cast::<AnyObject>();
            if !ready(&held) || !at_url(wk,&expected) { return Err("The canvas page changed.".into()); }
            let win: *mut AnyObject = msg_send![wk, window];
            if win.is_null() { return Err("The canvas is closed.".into()); }
            let bounds: NSRect = msg_send![wk,bounds];
            let flipped: bool = msg_send![wk,isFlipped];
            let point = NSPoint::new(bounds.origin.x + x*bounds.size.width, bounds.origin.y + (if flipped { y } else { 1.0-y })*bounds.size.height);
            let location: NSPoint = msg_send![wk, convertPoint:point, toView:ptr::null_mut::<AnyObject>()];
            let parent: *mut AnyObject = msg_send![wk, superview];
            let local: NSPoint = msg_send![wk,convertPoint:point,toView:parent];
            let hit: *mut AnyObject = msg_send![wk,hitTest:local];
            if hit.is_null() { return Err("The control cannot be hit.".into()); }
            let number: isize = msg_send![win,windowNumber];
            let kinds: &[usize] = if action != Pointer::Hover { &[5,1,2] } else { &[5] };
            for &kind in kinds {
                let event: *mut AnyObject = msg_send![AnyClass::get(c"NSEvent").unwrap(),mouseEventWithType:kind,location:location,modifierFlags:0usize,timestamp:0.0f64,windowNumber:number,context:ptr::null_mut::<AnyObject>(),eventNumber:0isize,clickCount:if kind==5 {0isize} else {1isize},pressure:if kind==1 {1.0f32} else {0.0f32}];
                if event.is_null() { return Err("Cannot create a pointer event.".into()); }
                let _: () = match kind { 1 => msg_send![hit,mouseDown:event], 2 => msg_send![hit,mouseUp:event], _ => msg_send![hit,mouseMoved:event] };
            }
            Ok(match action { Pointer::Click => "Clicked the canvas control.", Pointer::Hover => "Hovered over the control.", Pointer::Upload => "Activated the file picker. Verify the selected count before submitting." }.into())
        })();
        let _ = tx.send(result);
    }).map_err(text)?;
    rx.recv_timeout(Duration::from_secs(if action == Pointer::Upload {
        240
    } else {
        6
    }))
    .map_err(|_| "The canvas did not confirm the pointer event.".to_string())?
}

struct Key {
    chars: String,
    base: String,
    code: u16,
    flags: usize,
}
fn key(description: &str) -> Result<Key, String> {
    let mut parts: Vec<_> = description.split('+').collect();
    let last = parts.pop().unwrap_or("");
    let mut flags = 0;
    for modifier in parts {
        flags |= match modifier.to_ascii_lowercase().as_str() {
            "shift" => 1 << 17,
            "control" | "ctrl" => 1 << 18,
            "alt" | "option" => 1 << 19,
            "meta" | "command" | "cmd" => 1 << 20,
            _ => return Err("Unknown keyboard modifier.".into()),
        };
    }
    let (chars, code) = match last {
        "Enter" => ("\r", 36),
        "Tab" => ("\t", 48),
        "Space" => (" ", 49),
        "Backspace" => ("\u{7f}", 51),
        "Escape" => ("\u{1b}", 53),
        "ArrowLeft" => ("\u{f702}", 123),
        "ArrowRight" => ("\u{f703}", 124),
        "ArrowDown" => ("\u{f701}", 125),
        "ArrowUp" => ("\u{f700}", 126),
        "Delete" => ("\u{f728}", 117),
        "Home" => ("\u{f729}", 115),
        "End" => ("\u{f72b}", 119),
        "PageUp" => ("\u{f72c}", 116),
        "PageDown" => ("\u{f72d}", 121),
        c if c.chars().count() == 1 => (
            c,
            "asdfhgzxcv§bqweryt123465=97-80]ou[ip\rlj'k;\\,/nm."
                .chars()
                .position(|key| Some(key) == c.chars().next().map(|key| key.to_ascii_lowercase()))
                .unwrap_or(0) as u16,
        ),
        _ => return Err("Use a character, navigation key, or modifier chord.".into()),
    };
    let rendered = if flags & (1 << 17) != 0 {
        chars.to_uppercase()
    } else {
        chars.into()
    };
    Ok(Key {
        chars: rendered,
        base: chars.into(),
        code,
        flags,
    })
}

pub fn press<R: Runtime>(
    view: &Webview<R>,
    description: &str,
    expected: String,
) -> Result<String, String> {
    let key = key(description)?;
    let held = view.clone();
    let (tx, rx) = mpsc::channel();
    view.with_webview(move |platform| {
        // SAFETY: target only this WKWebView, on its main thread; never send keys to NSApplication or the system event queue.
        let result = unsafe {
            let wk = &*platform.inner().cast::<AnyObject>();
            if !ready(&held) || !at_url(wk, &expected) { Err("The canvas page changed.".into()) }
            else {
                let win: *mut AnyObject = msg_send![wk, window];
                if win.is_null() { let _ = tx.send(Err("The canvas is closed.".into())); return; }
                let number: isize = msg_send![win, windowNumber];
                for kind in [10usize,11] {
                    let event: *mut AnyObject = msg_send![AnyClass::get(c"NSEvent").unwrap(), keyEventWithType: kind, location: NSPoint::new(0.,0.), modifierFlags: key.flags, timestamp: 0.0f64, windowNumber: number, context: ptr::null_mut::<AnyObject>(), characters: &*NSString::from_str(&key.chars), charactersIgnoringModifiers: &*NSString::from_str(&key.base), isARepeat: false, keyCode: key.code];
                    if event.is_null() { let _ = tx.send(Err("The key event could not be created.".into())); return; }
                    if kind == 10 { let _: () = msg_send![wk, keyDown: event]; } else { let _: () = msg_send![wk, keyUp: event]; }
                }
                Ok("Sent the key to the canvas.".into())
            }
        };
        let _ = tx.send(result);
    }).map_err(text)?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "No confirmation of the key press.".to_string())?
}
