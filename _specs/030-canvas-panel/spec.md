---
{
  "id": "030-canvas-panel",
  "title": "Canvas panel",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "013-hobkin-access"],
  "updated": "2026-11-10"
}
---
# Canvas panel

## Outcome
When hobkin has something to show, such as an app it is testing or a page it is walking through, it opens the canvas: a panel that slides in from the right over the screens, about half the width, with the page in an iframe. The user can drag its edge to resize it, reload the page, open it in their browser, or close it. The user does not open it from a menu; hobkin does.

## Decisions
- hobkin opens and closes the panel with the host commands `canvas.show { url, title? }` and `canvas.close`, both marked for hobkin's `client` tool. The host holds the state (open, url, title) and pushes it to the window as `canvas` in the state message, whole, on every change and with every reset.
- Since `035-canvas-drawings` the state is hobkin's, kept under the home, one canvas per hobkin, and it also has a kind and a revision. Showing the same page again raises the revision, so the page loads again.
- Only http and https addresses open, with a host and no sign-in in the address. The check is shared (`shared/protocol/canvas.ts`) and runs in the host, so no other kind of address reaches the window.
- The panel is a separate component with its own store (`ui/src/features/canvas-panel`). The frame mounts it with one line inside the area it covers.
- Pages on `http://localhost` and `http://127.0.0.1` run in a sandbox with scripts and their own origin, so a dev server works. Every other page runs scripts without its origin, with no top-level navigation and no downloads.
- The bar shows the title hobkin gave, or the page's host, then reload, open in the browser (`system.open`) and close. Escape closes the panel.
- A page that does not load within eight seconds, or errors, is replaced by a plain note with the open-in-the-browser button.
- Motion holds still under the Movement setting: the slide is dropped and the fade stays.
- For checks in development, `window.__canvasDev.show(url, title?)` and `.close()` open and close the panel without a host.

## Out of scope
- A real in-app browser: an address bar the user types in, back and forward, tabs, history, and a native Tauri child webview that is not bound by frame rules. This panel only shows what hobkin points it at.
- Reading the page: no screenshots, no DOM access, no clicking for hobkin. Showing only.
- Detecting a refusal to be framed from the response headers. A browser does not tell the page, so the note appears on a timeout or error only.
- A menu item or shortcut for the user to open the canvas.
- Remembering the panel's width or page between launches.

## Acceptance
- A1. `canvas.show` with an http or https address opens the canvas state and the window is told its url and title; `canvas.close` closes it. Any other kind of address, an address with a sign-in in it, or arguments that do not fit are refused and nothing opens.
- A2. hobkin's `client` tool lists `canvas.show` and `canvas.close` and runs them.
- A3. A new connection is told the canvas state, closed or open, with its first full state.
- A4. A page on localhost or 127.0.0.1 over http gets a sandbox with its own origin; no other page does.
- A5. The panel slides in from the right at about half the area, and its left edge drags (or arrow keys) between a third and four fifths.
- A6. Reload loads the page again. Open in the browser opens the page in the Mac's browser through the host. Close and Escape send the panel away, and tell the host.
- A7. A page that does not load shows a plain note with the open-in-the-browser button.
- A8. Under Still movement, the panel fades and does not travel.

## Proof
- A1. `host/test/canvas.test.ts` › "only http and https pages with a host and no sign-in open"
- A2. `host/test/canvas.test.ts` › "hobkin opens and closes the canvas through the client tool"
- A3. `host/test/canvas.test.ts` › "the host tells the window when the canvas opens and closes"
- A4. `ui/test/canvas-panel.test.ts` › "a page on this Mac runs with its own origin, any other page without it"
- A5. `ui/test/canvas-panel.test.ts` › "the panel keeps between a third and four fifths of the area"; check: open the panel with `window.__canvasDev.show('http://localhost:5187')`, see it cover about half, drag its edge.
- A6. check: with the panel open, click Reload, Open in the browser and Close, and press Escape.
- A7. check: show `http://localhost:1` and wait eight seconds.
- A8. check: set Movement to Still and open the panel. It fades without sliding.

## Steps
- [x] S1 (A1, A2, A3). Host: `canvas.show`, `canvas.close`, state in the protocol.
- [ ] S2 (A4, A5, A6, A7, A8). The panel component, its store and the dev helper.
- [ ] S3 (A5, A6, A7, A8). Mount in the frame and check in the window.

## Open questions
- Refused frames cannot be told from loaded pages in the window. The host could ask the page for its `X-Frame-Options` and `Content-Security-Policy` headers before showing it. That adds a host fetch of an address hobkin chose; worth it only if the note proves too late in use.
