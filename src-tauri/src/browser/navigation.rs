//! Bounded interactions in the same native page the user sees. Only the main webview may call this command.
use super::{browser, from_main, page, read, step, text, Browser, Ordering, LABEL};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, Url, Webview};

#[derive(Deserialize, Serialize)]
#[serde(tag = "do", rename_all = "lowercase", deny_unknown_fields)]
pub enum Action {
    Read {
        what: Option<String>,
        within: Option<String>,
    },
    Click {
        on: String,
    },
    Hover {
        on: String,
    },
    Upload {
        on: String,
    },
    Type {
        on: String,
        text: String,
    },
    Fill {
        on: String,
        text: String,
    },
    Select {
        on: String,
        option: String,
    },
    Drag {
        on: String,
        to: String,
    },
    Scroll {
        by: Option<i64>,
        to: Option<String>,
    },
    Wait {
        on: Option<String>,
        text: Option<String>,
        url: Option<String>,
    },
    Press {
        key: String,
    },
    Back,
    Forward,
    Reload,
}

fn destination(address: &str, own: Option<&Url>) -> Result<Url, String> {
    let url = page(address)?;
    if matches!(url.port(), Some(5187 | 4848))
        || own.is_some_and(|own| own.origin() == url.origin())
    {
        return Err("Canvas interaction cannot access the app or browser control service.".into());
    }
    Ok(url)
}

fn interaction_script(action: &Action, url: &str) -> Result<String, String> {
    let args = serde_json::to_string(action).map_err(text)?;
    if args.len() > 128 * 1024 {
        return Err("Canvas input is too long.".into());
    }
    Ok(format!(
        "({})({}, {})",
        include_str!("interact.js"),
        args,
        serde_json::to_string(url).map_err(text)?
    ))
}

#[tauri::command]
pub async fn browser_canvas_action<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    scope: String,
    action: Action,
) -> Result<String, String> {
    from_main(&webview)?;
    let label = format!("{LABEL}-{scope}");
    let view = browser(&app)
        .filter(|view| {
            view.label() == label
                && app.state::<Browser>().visible.load(Ordering::Acquire)
                && view.window().is_visible().unwrap_or(false)
                && !view.window().is_minimized().unwrap_or(true)
        })
        .ok_or("That canvas is no longer visible.")?;
    let shown = read(&view).ok_or("The page is not ready.")?;
    destination(&shown.url, app.config().build.dev_url.as_ref())?;
    if shown.loading {
        return Err("The page is still loading.".into());
    }
    match action {
        Action::Back | Action::Forward => {
            let forward = matches!(action, Action::Forward);
            if !(if forward { shown.forward } else { shown.back }) {
                return Err("No page in that direction.".into());
            }
            step(&view, forward)?;
            Ok("Navigated in the canvas.".into())
        }
        Action::Reload => {
            view.reload().map_err(text)?;
            Ok("Reloading the canvas.".into())
        }
        #[cfg(target_os = "macos")]
        Action::Click { .. } | Action::Hover { .. } | Action::Upload { .. } => {
            use super::native_input::Pointer;
            let point =
                super::native_input::interact(&view, interaction_script(&action, &shown.url)?)?;
            super::native_input::pointer(
                &view,
                &point,
                shown.url,
                match action {
                    Action::Upload { .. } => Pointer::Upload,
                    Action::Click { .. } => Pointer::Click,
                    _ => Pointer::Hover,
                },
            )
        }
        #[cfg(target_os = "macos")]
        Action::Press { ref key } => {
            super::native_input::interact(&view, interaction_script(&action, &shown.url)?)?;
            super::native_input::press(&view, key, shown.url)
        }
        #[cfg(target_os = "macos")]
        _ => super::native_input::interact(&view, interaction_script(&action, &shown.url)?),
        #[cfg(not(target_os = "macos"))]
        _ => Err("Canvas interactions require the Mac window.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interaction_checks_the_page_and_does_not_accept_filesystem_paths_or_agent_code() {
        for args in [
            r#"{"do":"upload","on":"Attachments","path":"/private/file"}"#,
            r#"{"do":"eval","code":"1"}"#,
        ] {
            assert!(serde_json::from_str::<Action>(args).is_err());
        }
        for address in [
            "javascript:void(0)",
            "file:///a",
            "http://localhost:4848",
            "http://127.1:5187",
            "https://a:b@example.com",
        ] {
            assert!(destination(address, None).is_err());
        }
    }
}
