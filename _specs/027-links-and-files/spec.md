---
{
  "id": "027-links-and-files",
  "title": "Links and local files",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host", "003-chat", "008-review-code", "020-settings"],
  "updated": "2026-11-10"
}
---
# Links and local files

## Outcome

A link clicked in the Mac window opens in the system's default browser. A local file path in the chat, in a report or in agent activity, written as `/Users/x/notes.md` or `~/Poetry/x/README.md`, shows as a link. Clicking it opens a sheet over the blurred window: a Markdown file rendered as the chat renders it, any other text as code, and a binary or very large file with a plain reason it is not shown. The sheet has a button that opens the file in the Mac's default app. Escape closes it.

## Decisions

- The Mac window's web view opens no window for `target=_blank`, and the shell has no opener plugin (none is added). The host opens things, as it already does for GitHub and sign-in.
- `system.open { url }` opens http, https and mailto addresses only, through an opener the host is handed (`openSystem`). The default is no opener, so a test never opens anything. `main.ts` passes the real one: `open <address>` through execFile, no shell (`host/src/open.ts`). The registry's pattern and the handler both check the address.
- `file.read { path }` takes a full path or one that starts with `~/`. The host follows symlinks and answers with the real path. It refuses anything that is not a regular file, a file over 2 MB, a file with a zero byte in its first 8000 bytes, and a file that is not valid UTF-8. A refusal is an `unavailable` failure whose message is the plain reason (`host/src/files.ts`). A `.md`, `.markdown` or `.mdx` file is answered with `markdown: true`.
- The button uses a separate command, `file.open { path }`, not `system.open` with a file URL, so `system.open` stays web and mail only. `file.open` resolves the path the same way and opens any regular file, large or binary, in its default app, but refuses a program (an executable bit, or an extension such as `.app`, `.command`, `.sh`, `.pkg`). It takes the opener `openFile`; none by default.
- Neither file command is offered to hobkin's own client tool. They are for the window.
- One catcher for the whole app (`ui/src/features/viewer/catch.ts`, mounted by `LinkLayer` in `App.tsx`) listens for clicks on the document, after the page's own handlers. A file link always opens the viewer. In the Mac window with a host connected, an `http`, `https` or `mailto` link calls `system.open`. In a browser tab, or with no host, the link works as a link does. The GitHub rows keep their own handler, which runs first.
- Paths in text are found only when they start with `~/` or with a top-level Mac folder (`/Users`, `/Volumes`, `/private`, `/tmp`, `/var`, `/opt`, `/etc`, `/usr`, `/home`, `/Applications`, `/Library`, `/System`, `/Developer`), so `and/or` and `/api/users` stay words. In a link's own destination any full path or `~/` path counts. An inline code span that is exactly one path is linked. Code blocks are left alone. The work is a remark plugin in the chat's Markdown (`ui/src/features/viewer/paths.ts`), so reports and agent activity that use that renderer get it too.
- Code is drawn through `highlight.ts` (Shiki). A file over 5000 lines is drawn plain, so coloring never stalls the window.
- Motion: the sheet rises and the blur fades in, the header and the content land one after another. Under Still, or a Mac that asks for less, only fades remain (`useStill`).

## Out of scope

- Relative links inside a viewed Markdown file, line numbers in a path (`file.ts:12`), `file://` links, images in a viewed Markdown file, editing, and file types the viewer cannot read as text.
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

## Steps

- [x] S1 (A1, A2). `system.open` and the opener.
- [x] S2 (A3, A4, A5). `file.read` and `file.open`.
- [x] S3 (A6, A7). The path links in Markdown and the click catcher.
- [x] S4 (A8, A9, A10). The viewer sheet.

## Open questions

- Should the Mac window's own links also open through a Tauri opener later? That needs a shell plugin, which the shell does not have.
