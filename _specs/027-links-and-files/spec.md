---
{
  "id": "027-links-and-files",
  "title": "Links and local files",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "003-chat", "008-review-code", "020-settings"],
  "updated": "2026-11-25"
}
---
# Links and local files

## Outcome

A link clicked in the Mac window opens in the system's default browser. A local file path in the chat, in a report or in agent activity, written as `/Users/x/notes.md` or `~/Poetry/x/README.md`, shows as a link. Clicking it opens a sheet over the blurred window: a Markdown file rendered as the chat renders it, any other text as code, an image drawn to fit the sheet with its size in pixels and bytes, and any other binary or very large file with a plain reason it is not shown. The sheet has a button that opens the file in the Mac's default app, as does ⌘-click on the link. Escape closes it. A report links a path in its code blocks too, and in inline code among other words.

## Decisions

- The Mac window's web view opens no window for `target=_blank`, and the shell has no opener plugin (none is added). The host opens things, as it already does for GitHub and sign-in.
- `system.open { url }` opens http, https and mailto addresses only, through an opener the host is handed (`openSystem`). The default is no opener, so a test never opens anything. `main.ts` passes the real one: `open <address>` through execFile, no shell (`host/src/open.ts`). The registry's pattern and the handler both check the address.
- `file.read { path }` takes a full path or one that starts with `~/`. The host follows symlinks and answers with the real path. It refuses anything that is not a regular file, a file over 2 MB, a file with a zero byte in its first 8000 bytes, and a file that is not valid UTF-8. A refusal is an `unavailable` failure whose message is the plain reason (`host/src/files.ts`). A `.md`, `.markdown` or `.mdx` file is answered with `markdown: true`.
- An image is known by its first bytes, never by its name (`host/src/image-type.ts`): PNG, JPEG, GIF, WebP, AVIF (an `ftyp` box with an AVIF brand), BMP (a known second header size, since "BM" starts plenty of text), ICO, and SVG (an `<svg>` root after any prolog, comments or doctype). `file.read` answers it with `kind: 'image'`, its type and its bytes as a base64 `data:` URL, up to 20 MB, with a plain refusal above that. 20 MB holds a full-screen screenshot of a 5K or 6K Retina display (a 5 to 15 MB PNG) and keeps the answer under 27 MB of base64 on the window's local socket. A text answer says `kind: 'text'`. The window's content policy already allows `data:` images. Any other binary file keeps its refusal.
- An image is drawn only through an `<img>`, so an SVG's script never runs and it loads nothing else. It fits inside the sheet and is never drawn larger than it is. Its size in pixels comes from the drawn image, under it with its size in bytes. A file whose name says image gets the full-height frame before its bytes arrive, so the sheet does not change size or move its header as it loads; the bytes still decide what it is.
- The button uses a separate command, `file.open { path }`, not `system.open` with a file URL, so `system.open` stays web and mail only. `file.open` resolves the path the same way and opens any regular file, large or binary, in its default app, but refuses a program (an executable bit, or an extension such as `.app`, `.command`, `.sh`, `.pkg`). It takes the opener `openFile`; none by default.
- Neither file command is offered to hobkin's own client tool. They are for the window.
- One catcher for the whole app (`ui/src/features/viewer/catch.ts`, mounted by `LinkLayer` in `App.tsx`) listens for clicks on the document, after the page's own handlers. A file link opens the viewer. With ⌘ held and a host connected it opens in its default app through `file.open`, and a file the host does not open, such as one that is not there, opens the viewer, which says why. In the Mac window with a host connected, an `http`, `https` or `mailto` link calls `system.open`. In a browser tab, or with no host, the link works as a link does. The GitHub rows keep their own handler, which runs first.
- Paths in text are found only when they start with `~/` or with a top-level Mac folder (`/Users`, `/Volumes`, `/private`, `/tmp`, `/var`, `/opt`, `/etc`, `/usr`, `/home`, `/Applications`, `/Library`, `/System`, `/Developer`), so `and/or` and `/api/users` stay words. In a link's own destination any full path or `~/` path counts. An inline code span that is exactly one path is linked. In the chat and agent activity code blocks are left alone. The work is a remark plugin in the chat's Markdown (`ui/src/features/viewer/paths.ts`), so agent activity that uses that renderer gets it too.
- A report draws its own Markdown (`ReportMarkdown.tsx`: the reader, its short version and its folds, a catch-up, and a project's run guide). It takes the same remark plugin, and a rehype plugin from the same file (`rehypeCodePaths`) links each path inside a code block's lines and inside an inline code with other words, with the same detection. A report's link to a file, or its picture of one, opens the viewer like the chat's. A path relative to a project is not linked: a report carries no project folder (its source is `work.<slug>.<lane>`, and the window knows no folder for a slug).
- Code is drawn through `highlight.ts` (Shiki). A file over 5000 lines is drawn plain, so coloring never stalls the window.
- Motion: the sheet rises and the blur fades in, the header and the content land one after another. Under Still, or a Mac that asks for less, only fades remain (`useStill`).

## Out of scope

- Relative links inside a viewed Markdown file, line numbers in a path (`file.ts:12`), `file://` links, images in a viewed Markdown file, editing, zooming an image, and file types the viewer can neither read as text nor draw as an image (HEIC, TIFF, PDF and others).
- Opening a program from a link.

## Acceptance

- A1. `system.open` opens an http, https or mailto address through the host's opener and refuses `file:`, `javascript:`, `ftp:` and path addresses. A host with no opener opens nothing.
- A2. The real opener runs `open` with the address as one argument and no shell.
- A3. `file.read` answers with the text of a regular file, from a full path or `~/`, following symlinks to the real path, and marks Markdown.
- A4. `file.read` refuses a binary file, a file that is not UTF-8, a file over 2 MB, a folder, a symlink to a folder, a missing or dangling path and a relative path, each with a plain reason.
- A5. `file.open` opens a regular file in the default app and refuses a program, an app bundle and a missing file.
- A6. Paths in text and in link destinations show as file links in the chat's Markdown. Prose that only looks like a path, web links and code blocks do not.
- A7. In the Mac window with a host, a web link calls `system.open`. In a browser tab, with no host, or for an in-page anchor, the link is left alone. A file link opens the viewer everywhere.
- A8. The viewer opens over a blurred window, shows a refusal reason when the file cannot be shown, and Escape closes it.
- A9. The viewer shows a `.md` file as rendered Markdown and other text as colored code, with a button that opens the file in the default app.
- A10. Under Still the viewer only fades.
- A11. `file.read` knows an image by its bytes and not its name, and answers it as a data URL of its own bytes, an SVG included. It refuses an image over 20 MB with a plain reason and keeps refusing other binary files.
- A12. The viewer draws an image to fit the sheet, with its name, its size in pixels and bytes, and the open in default app button. The sheet has the same size and header while the image loads as once it is drawn.
- A13. A report shows a full or `~/` path as a file link in its words, in inline code and in a code block's lines, in its folds too. Web links, report links and words that only look like paths do not change.
- A14. ⌘-click on a file link opens the file in its default app when a host is connected, and the viewer otherwise.

## Proof

- A1. `host/test/open.test.ts` › "system.open opens only what the opener is handed, and refuses other addresses"
- A2. `host/test/open.test.ts` › "the real opener runs open with the address as one argument and no shell"
- A3. `host/test/open.test.ts` › "file.read gives the text of a regular file, with ~/ and symlinks resolved"
- A4. `host/test/open.test.ts` › "file.read refuses what is not a small text file, with a plain reason"
- A5. `host/test/open.test.ts` › "a file opens in its default app only when it is plain and cannot run"
- A6. `ui/test/links.test.ts` › "markdown shows local paths as file links and keeps web links as they were"
- A7. `ui/test/links.test.ts` › "a click is caught for a file anywhere, and for the web only in the Mac window with a host"
- A8. check: open http://localhost:5187 in a browser tab (sample data) and click a file link. The blurred sheet shows the "Files open once hobkin is connected" reason, and Escape closes it.
- A9. check: with a host connected, click `~/some/README.md` in the chat, then a `.ts` path. The first renders as Markdown, the second as colored code, and the button opens the default app.
- A10. check: set Movement to Still and open the viewer. It fades without rising or growing.
- A11. `host/test/open.test.ts` › "an image is known by its bytes, not its name", › "file.read answers an image with its own bytes as a data URL, whatever its name", › "file.read refuses an image over 20 MB, and still refuses other binary files" and › "file.read and file.open run over the socket; only file.open reaches the opener"
- A12. check: a still render (no browser) of the sheet with a wide JPEG and a tall PNG, dark and light, and of the same sheet while the file is read: the image fits, the caption reads "1920 × 1200 px · 959 KB", and the header sits in the same place in both. Clicking an image path in the live window needs a host restart and was not seen.
- A13. `ui/test/report-paths.test.ts` › "a report links every local path: in its words, in inline code and in a code block line, full or from ~/", › "a report keeps web links, report links and words that only look like paths as they were" and › "a fold's label and inside link paths the same way"
- A14. `ui/test/report-paths.test.ts` › "⌘-click on a file opens it in its app when a host can, and a plain click opens the sheet"

## Steps

- [x] S1 (A1, A2). `system.open` and the opener.
- [x] S2 (A3, A4, A5). `file.read` and `file.open`.
- [x] S3 (A6, A7). The path links in Markdown and the click catcher.
- [x] S4 (A8, A9, A10). The viewer sheet.
- [x] S5 (A11, A12). Images: known by their bytes in `file.read`, drawn in the sheet.
- [x] S6 (A13, A14). Paths in reports, their code included, and ⌘-click to the default app.

## Open questions

- Should the Mac window's own links also open through a Tauri opener later? That needs a shell plugin, which the shell does not have.
