---
{
  "id": "035-canvas-drawings",
  "title": "Canvas: drawings, one per hobkin, and saving",
  "kind": "work",
  "status": "doing",
  "depends": ["030-canvas-panel", "034-durable-hobkins"],
  "updated": "2026-11-13"
}
---
# Canvas: drawings, one per hobkin, and saving

## Outcome

The canvas becomes something a hobkin draws on as well as a window onto a site. The main hobkin and every durable hobkin has a canvas of its own. Each one shows either a web page or a drawing: an HTML document the hobkin wrote, which can be a whiteboard, a diagram, a Mermaid chart, a mock-up of a site or anything else HTML can hold. The main hobkin's canvas is the panel over the screens, as before. A durable hobkin's canvas opens on that hobkin's own page. The user can save a drawing as an HTML file. Both kinds of hobkin learn the canvas from one small skill and use the same commands.

## Decisions

### One canvas per hobkin, kept under the home

- hobkin keeps the canvases in `canvas/` under the home: `state.json` says, for `main` and for each durable hobkin's id, whether its canvas is open, whether it shows a page or a drawing, the page's address, the title and a revision number. A drawing is the file `canvas/<owner>.html`.
- A drawing is one whole HTML document of at most 2 MiB. Drawing again replaces it and raises the revision.
- The canvases stay as they were across a restart, so a durable hobkin's drawing is still on its page.
- Ending a durable hobkin closes its canvas. The drawing file stays.

### The commands

- `hobkin canvas show <url> [--title]`, `hobkin canvas draw <file> [--title]` (or `-` for standard input), `hobkin canvas read`, `hobkin canvas save [path]` and `hobkin canvas close`. Each takes `--hobkin <id>` for a durable hobkin's canvas and acts on the main hobkin's without it. They write the store directly and the window follows within a second.
- `read` returns the canvas's state and the path of its drawing, so a hobkin can open what it drew and carry on from it.
- `save` copies the drawing to `path`, or to the Downloads folder under a name made from the title, never over an existing file, and returns where it went.
- The same five actions are host commands, `canvas.show`, `canvas.draw`, `canvas.read`, `canvas.save` and `canvas.close`, each with an optional `hobkin` id. The window's buttons call them, and the main hobkin can run them through its `client` tool.
- A page's address keeps the rule of `030-canvas-panel`: http or https, with a host and no sign-in in it. The rule runs in the commands and again in the host before the window is told.

### The skill

- One short file in hobkin, `prompts/canvas.md`, says what the canvas is for, the five commands, and how to draw: a whole HTML document that stands by itself, styles and scripts inline, a library loaded from a CDN only when the drawing needs one, light and dark both readable, and `read` before changing a drawing someone already has open.
- The main hobkin gets it with its other prompts. A durable hobkin gets it in its directions, with its own id for `--hobkin`, on Pi and on Claude Code alike.

### Showing a drawing

- The host serves each drawing on the loopback port it already listens on, at an address with a random key in it, and tells the window that address with the revision. The window frames it like any page.
- A drawing runs scripts and never has an origin of its own: the frame's sandbox leaves `allow-same-origin` out, and the host sends the same sandbox as a Content-Security-Policy header, so opening the address in a browser changes nothing. It cannot reach the window, the host's socket or other drawings.
- A drawing may load from the network, since a Mermaid chart or a map needs it.
- When the revision changes, the frame loads the drawing again.

### The panel

- The panel takes the canvas it shows: the main hobkin's over the screens, and a durable hobkin's on that hobkin's page. Each keeps its own width.
- The bar shows the title, then Reload, Save for a drawing, Open in the browser and Close. Save writes the file and says where, with a button that opens it.
- Closing the panel closes that canvas for its hobkin too, as in `030-canvas-panel`.

## Out of scope

- Publishing a drawing to the web. That comes with premium.
- hobkin reading the page it shows: no screenshots, no DOM access and no clicks.
- Changing a drawing in pieces. A drawing is replaced whole.
- The user drawing on the canvas, or an address bar.
- The Pages screen and block pages of `013-hobkin-access`. A drawing is HTML in a sandbox and takes their place for free-form pages.
- A choice of where the panel sits.

## Acceptance

- A1. `hobkin canvas draw` with an HTML file opens that hobkin's canvas on a drawing with the title given, and drawing again replaces it and raises the revision. A file over 2 MiB, or one that is not text, is refused and the canvas stays as it was.
- A2. `hobkin canvas show` opens the canvas on an http or https page and refuses any other address. `close` closes it. `--hobkin <id>` acts on that hobkin's canvas and leaves the main one alone.
- A3. `hobkin canvas read` gives the state and the drawing's path. `hobkin canvas save` writes the drawing to the path given, or to Downloads under a name from the title, and never replaces a file.
- A4. The canvases are the same after a restart.
- A5. The host tells the window each canvas, the main one and each durable hobkin's, when it changes and with every reset. A change made by the `hobkin canvas` command reaches the window within a second.
- A6. A drawing is served only at its keyed address, as HTML that is never cached, with a sandbox header that leaves out its own origin. A wrong key, another path or another method gets nothing.
- A7. The main hobkin's `client` tool lists and runs `canvas.show`, `canvas.draw`, `canvas.read`, `canvas.save` and `canvas.close`.
- A8. The frame for a drawing allows scripts and never its own origin, and it loads again when the revision changes. A page on this Mac keeps the rule of `030-canvas-panel`.
- A9. The main hobkin's canvas shows over the screens and a durable hobkin's on its own page. Closing one leaves the other.
- A10. Save, on a drawing, writes the file, says where it went and offers to open it. A page has no Save.
- A11. The main hobkin's prompts and a durable hobkin's directions both hold the canvas skill, and the durable hobkin's name its id.

## Proof

- A1. `hobkin/test/cli-canvas.test.mjs` › "a drawing opens the canvas, replaces the last one and stays within its size"
- A2. `hobkin/test/cli-canvas.test.mjs` › "a page opens, only http and https, and each hobkin has its own canvas"
- A3. `hobkin/test/cli-canvas.test.mjs` › "read gives the drawing's path and save never replaces a file"
- A4. `hobkin/test/cli-canvas.test.mjs` › "the canvases are read back as they were written"
- A5. `host/test/canvases.test.ts` › "the window is told each canvas, and a change on disk reaches it"
- A6. `host/test/canvases.test.ts` › "a drawing is served only at its keyed address, sandboxed and uncached"
- A7. `host/test/canvases.test.ts` › "hobkin draws, reads, saves and closes through the client tool"
- A8. `ui/test/canvas-panel.test.ts` › "a drawing runs scripts without an origin and reloads on a new revision"
- A9. `ui/test/canvas-panel.test.ts` › "each hobkin's panel follows its own canvas"; check: draw on the main canvas and on a durable hobkin's, and close one.
- A10. `ui/test/canvas-panel.test.ts` › "Save shows for a drawing only and says where the file went"; check: save a drawing and open it from the note.
- A11. `hobkin/test/cli-canvas.test.mjs` › "the main prompts and a durable hobkin's directions hold the canvas skill"

## Steps

- [x] S1 (A1, A2, A3, A4, A11). hobkin: the canvas store, the `hobkin canvas` command and the skill.
- [x] S2 (A5, A6, A7). Host: canvases read from the store, the drawing's address, and the five commands.
- [ ] S3 (A8, A9, A10). The panel per hobkin, drawings and Save.
- [ ] S4 (A9). The window's frame rule: a packaged app's Content-Security-Policy has no `frame-src`, so it refuses every framed page, drawings included. Adding `frame-src http: https:` to `src-tauri/tauri.conf.json` restarts the running app, so it waits for the user's word.

## Open questions

- A drawing can load from the network and send what is on it anywhere. That is what makes a Mermaid chart or a live page possible. Should drawings be offline unless the user allows the network for one?
- Save goes to Downloads without asking where. A save dialog needs Tauri's dialog plugin, which is an install and an app restart.
