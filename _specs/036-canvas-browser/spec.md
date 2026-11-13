---
{
  "id": "036-canvas-browser",
  "title": "Canvas: a real browser for pages",
  "kind": "work",
  "status": "doing",
  "depends": ["030-canvas-panel", "035-canvas-drawings", "019-keyboard"],
  "updated": "2026-11-13"
}
---
# Canvas: a real browser for pages

## Outcome
A canvas that shows a web page is a real browser pane. The page loads in a native webview laid exactly over the panel's page area, so a site that refuses to be framed loads too. The bar has Back, Forward, Reload, an address field the user can type in, Open in the browser and Close. hobkin still opens pages with `canvas.show`; where the user goes from there is theirs. A drawing stays exactly as it is, in its sandboxed frame. Without the shell's browser the panel frames pages as before.

## What changes from 030
`030-canvas-panel` left out "a real in-app browser: an address bar the user types in, back and forward, tabs, history, and a native Tauri child webview that is not bound by frame rules". This spec brings the address field, Back and Forward and the native child webview. Tabs, a history list and bookmarks stay out. 030's other rules hold: hobkin opens and closes the canvas, only http and https pages, the panel's width and edge, Escape, Still movement.

## Decisions

### The native view
- One webview, a child of the main window (Tauri's multi-webview API, behind its `unstable` cargo feature), named `canvas-browser-<n>`, a new number each time it opens. It is created the first time the page area shows and closed when the panel goes, when the panel moves to another hobkin's canvas, and when the window's own page loads again.
- The window sends the page area's rectangle, in the window's points, each frame it changes: the panel sliding in, its edge dragged, the window resized. Only the part inside the window is sent, in whole points; less than 24 points is hidden.
- A native view draws over everything in the window, so it is hidden whenever the panel is closed or leaving, or anything covers the page area: a dialog, a sheet, the spotlight, another screen's overlay. The window looks at nine points of the area; when any of them shows something else, the view hides. The edge's drag shield does not count.
- A page in it is a stranger. No capability names its label, so Tauri's and the plugins' commands refuse it, and every command of the shell's own answers the main window's webview only. It keeps its own cookies and storage, apart from the app's (macOS 14 and later). It gets no camera, microphone, location or downloads. A link that would open a window opens in the pane instead.
- Only http and https pages load, with the rule of `canvasUrl`: a host, and no sign-in in the address. Within a page, blank frames and data and blob addresses work. The app's own address never loads in the pane.
- The shell reports the address, the title, whether it is loading and whether Back and Forward can go: on each load and title change, after Back and Forward, and once a second while the pane is open, since a page can change its address without loading. Back and Forward are WebKit's own, so a page cannot stand in their way.

### The bar
- Back, Forward, Reload, the page's name, the address field, Open in the browser, Close. Back and Forward are dimmed when they cannot go. Reload turns while the page loads, and stays still under Still movement.
- The name is the page's own title. Before it has one: hobkin's name for its page, or the host of any other.
- The field shows the address on screen. Clicking it selects it to type over.
- What is typed is an address, never a search. Without a scheme it gets https, or http on this Mac (`localhost`, `127.0.0.1`) and on an IP address; `localhost:5173` is a host and a port. Words, a lone word, or an address the canvas does not take are refused with a plain line under the bar, and nothing loads.
- Enter loads it. Escape puts back the address on screen and the keyboard in the panel, without closing it; a second Escape closes the panel, as in 030. The field's other keys are a text field's (`019-keyboard`). While the page has the keyboard its keys are its own: the window takes none of them.
- Open in the browser opens the page on screen, or hobkin's page when the pane shows no web page.

### What stays hobkin's
- hobkin's canvas keeps the page hobkin showed. What the user browses to is not written to hobkin's store: only the bar shows it. hobkin showing a page again (a new revision) takes the pane back to it.

### Where it lives
- `ui/src/features/canvas-panel/browser.ts`: the rules: a typed address, the bar, when the view shows, the rectangle, what goes to the shell. Pure.
- `ui/src/features/canvas-panel/BrowserPane.tsx`: the bar and the page area for a page canvas with the shell's browser. `CanvasPanel.tsx` uses it in place of the frame.
- `ui/src/lib/native.ts`: the shell's commands, one after another. Without them the panel frames pages as before.
- The shell (`src-tauri/src/browser.rs`): `shell_features`, `browser_open`, `browser_place`, `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload`, `browser_shown`, `browser_close`, and the `canvas-browser:state` event to the main window's webview.

## Out of scope
- Tabs, a history list, bookmarks, a search from the address field, zoom, find in page.
- hobkin reading or driving the page: no screenshots, DOM or clicks, as in 030.
- Writing the user's navigation back to hobkin's canvas.
- Showing a drawing in the native view: a drawing keeps its sandboxed frame (035).
- Drawing over a covered page: the view hides instead.

## Acceptance
- A1. A typed address becomes a page by the canvas's rule, with https by default and http on this Mac and on an IP address. Words, a lone word, other schemes and addresses with a sign-in are refused, and nothing loads.
- A2. The bar shows the address on screen, the page's title or else a name for it, whether it loads, and whether Back and Forward can go. While the user types, the field holds what they typed. Open in the browser opens only a web page.
- A3. The native view shows only over an open panel that nothing covers. Anything over any part of the page area hides it.
- A4. The rectangle sent is the page area in whole points, inside the window, and none when too little shows.
- A5. The view opens the first time the area shows, at the page an address typed before then names, or hobkin's page. It is told only what changed, a page hobkin shows again takes it back there, and it closes once. The bar's actions reach it in order, and none reach it before it exists.
- A6. Only http and https pages by the canvas's rule load in the pane, never the app's own address; blank, data and blob frames inside a page work.
- A7. A page that refuses frames, such as `https://github.com`, loads in the pane, and Back, Forward, Reload and the address field work. (Native patch needed.)
- A8. The pane follows the panel as it slides in, as its edge is dragged and as the window is resized, and hides under the question sheet, the spotlight and a dialog. (Native patch needed.)
- A9. Escape in the address field leaves the panel open with the keyboard in it; a second Escape closes it, and the pane goes with it. (Native patch needed.)
- A10. Without the shell's browser, a page canvas frames as in 030. A drawing frames as in 035 with or without it.
- A11. A page in the pane cannot run the shell's commands nor Tauri's: calling `browser_close` or `notice_send` from it is refused. (Native patch needed.)

## Proof
- A1. `ui/test/canvas-browser.test.ts` › "a typed address becomes a page, and words are not searched"
- A2. `ui/test/canvas-browser.test.ts` › "the bar shows the page as it is: its address, its title, loading, and whether it can go back or forward"
- A3. `ui/test/canvas-browser.test.ts` › "the native view shows only over an open page panel that nothing covers" and "anything over a part of the page area covers it"
- A4. `ui/test/canvas-browser.test.ts` › "the rectangle sent is the page area in whole points, kept inside the window"
- A5. `ui/test/canvas-browser.test.ts` › "the window tells the native view only what changed, opens it when it first shows, and closes it once" and "what the user does in the bar reaches the native view in order"
- A6. `src-tauri/src/browser.rs` › `tests::only_web_pages_by_the_canvas_rule_open` and `tests::the_browser_goes_to_pages_and_what_they_use_but_never_the_app_itself` (compiled with the patch; run with `cargo test`)
- A7. check: after the native patch, `window.__canvasDev.show('https://github.com')`, then follow a link, go Back and Forward, Reload, and type `example.com`.
- A8. check: open the panel, drag its edge, resize the window, then press Command+K and cause a question.
- A9. check: click the address field, press Escape twice.
- A10. check: before the patch, show `http://localhost:5187` and a drawing; both frame as before.
- A11. check: with the pane on a page, run `window.__TAURI_INTERNALS__.invoke('browser_close')` in its inspector; it is refused and the pane stays.

## Steps
- [x] S1 (A1, A2, A3, A4, A5). The rules in `browser.ts`, with tests.
- [x] S2 (A7, A8, A9, A10). `BrowserPane` and the panel's use of it, behind the shell's answer.
- [x] S3 (A6, A7, A11). The native patch: `browser.rs`, Tauri's `unstable` feature, the capability limited to the main webview.
- [ ] S4 (A7, A8, A9, A11). Apply the native patch and check in the window.

## Open questions
- WebKit's own user agent names no browser, and some sites treat it as an embedded view (sign-in pages most of all). A Safari user agent would make more sites work, at the price of saying the pane is Safari.
- The window looks for covers at nine points. Something small over the area between them, such as a tooltip, can be drawn under the pane. More points cost more each frame.
- While the page has the keyboard, the window's presence report says the window is not focused (`use-presence.ts` reads `document.hasFocus()`), so hobkin may count the user as away while they browse in the pane.
