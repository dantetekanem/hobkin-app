---
{
  "id": "040-canvas-board",
  "title": "Canvas: the right side, live drawings and the kit",
  "kind": "work",
  "status": "doing",
  "depends": ["030-canvas-panel", "035-canvas-drawings", "036-canvas-browser", "034-durable-hobkins", "019-keyboard"],
  "updated": "2026-11-19"
}
---
# Canvas: the right side, live drawings and the kit

## Outcome

The canvas becomes a real drawing surface and whiteboard, as big as the right side of the window. When the main hobkin opens its canvas, the right side travels to it: a place of its own with its own row in the menu, as Settings has, and it stays until the user or hobkin closes it. When a durable hobkin opens its canvas on its page, the page moves left over the chat and the canvas takes the right side. A redraw changes the drawing in place: what stayed the same stays still, new parts draw themselves in, moved parts glide, removed parts fade. A small kit that comes with every drawing gives hobkins sticky notes, boxes, frames and arrows joined by id, in the app's light and dark colors. Escape closes the canvas when the keyboard is in it, the drawing included. The skill teaches hobkins to draw on the canvas when the user asks for a drawing, and never on their own.

## Decisions

### The main hobkin's canvas: a place on the right side
- A contextual screen, `canvas`, shows the main hobkin's canvas across the whole right side, its page or drawing starting just below the floating menu.
- When the main canvas opens (closed to open), the right side travels to it: it comes in from the right on the screens' push spring and pushes the screen that was there out to the left. A redraw of an open canvas never moves the view. An opening while the right side covers the chat (a review the user is in, or a durable hobkin's split) does not move it either.
- The menu's second row holds the canvas group, as Settings' trail: the canvas's title (the active crumb), Reload, Save for a drawing, Open in the browser and Close. A web page keeps Back, Forward, Reload, the address field and Open in the browser in its own bar inside the area; Close moves to the menu.
- Going to another screen leaves the canvas open. Its title stays as a pill at the end of the menu's second row, with a dot once it has been redrawn and not seen since. The pill, and Command with its number, go back to it.
- It closes by Close, by Escape while the keyboard is in it, or by hobkin's `canvas.close`. Closing returns to the place it was opened over, Settings or an agent's page included. Command+R on the canvas comes back to it while it is open; a new launch comes back on the place under it.

### A durable hobkin's canvas: the split
- On a durable hobkin's page while its canvas is open, the right side grows over the chat by the chat's width and the 10-point divider, the page takes the chat's place, and the canvas slides in from the right edge at the right side's usual width (the window's width less the chat and the divider). One spring moves all three; the chat dims under it as it does for a review.
- The menu, the window-drag strip and the top-right controls stay where they are, over the canvas: their offset follows the growth on the same spring.
- The menu's second row shows the agents, then that hobkin's canvas group.
- Leaving the page undoes the split; coming back forms it again. Closing the canvas reverses it.

### Keys
- Escape closes the canvas when the keyboard is in it: its area, its drawing or its controls in the menu. The main canvas goes back to where it was opened, with the keyboard in the message input; a durable hobkin's split undoes, with the keyboard in its talk box. Escape anywhere else leaves the canvas alone.
- Command+S saves the drawing when the keyboard is in the canvas.
- Control+Tab moves the keyboard between the canvas and its agent: the message input for the main canvas, the talk box in a durable hobkin's split.
- The main canvas is a numbered place while it is open, as Settings and a review are.
- While a drawing has the keyboard, a key it did not use reaches the app only from this set: Escape, Command+S, Command+1 to 9, Command+K, Command+L, Command+Return, Command+comma, Command+J, Command+Y and Control+Tab. Nothing that ends, stops, sends or reloads (Control+X, Command+R, Command+N) is ever passed on.
- Escape in a web page in the canvas comes from the shell, which sees the key while the page has the keyboard and tells the window, without taking it from the page.

### Live drawings
- The host serves each drawing with a small runtime and the kit's stylesheet put in right after its doctype, or first when it has none, both marked `data-hb-runtime`. The drawing keeps its sandbox: no origin of its own, the same Content-Security-Policy, never cached. It is also sent with `Access-Control-Allow-Origin: *`, because the drawing has no origin and fetches its next revision itself. When the runtime's files cannot be read, the drawing is served as before.
- The window and a drawing speak in messages, `{ hobkin: 'canvas', type, ... }`:
  - from the window: `appearance` (theme, still, the colors paper, ink, muted, line and accent), `show` (the canvas has arrived: play the first entrance) and `revision` (the url of the new revision);
  - from the drawing: `ready` (version 1), `load` (the url of a revision it cannot change in place) and `key` (key, code, meta, ctrl, alt, shift).
- The window takes messages only from its own frame, and keys only while that frame has the keyboard. The drawing takes messages only from the window. Before `ready`, a revision loads fresh.
- A revision of a drawing with no script of its own changes the open document in place, its `data-hb-runtime` nodes left alone: elements are matched by id, then by tag in order, and text in order. A drawing with a script of its own, or a revision that cannot be fetched or read, loads fresh: the new frame loads behind the one on screen and fades in over it once loaded.
- New parts draw themselves in: an SVG shape traces its stroke and then fills, an element fades and rises, a little after the one before, all within about a second. A moved element glides from where it was. A removed one fades and goes, and what moves after it glides. The first time a drawing shows, all of it draws in, once the canvas has arrived. Under Still movement or reduced motion nothing animates.

### The kit
- `body.hb-board`: whiteboard paper with a faint dot grid. `.hb-note` with `data-color` yellow, green, blue, pink, purple or gray: a sticky note. `.hb-box` with `data-color`: an outlined box with a hand-drawn edge. `.hb-pill`: a small label. `.hb-frame` with `data-title`: a titled group with a dashed edge. `.hb-row`, `.hb-col`, `.hb-grid` with `--cols`: layout. `.hb-hand`: handwritten text. `.hb-sketch`: a hand-drawn wobble on an SVG or an element.
- `<hb-arrow from="id" to="id" label="…" data-style="dashed" curve="0.2"></hb-arrow>`: an arrow from one element to another by id, drawn between their edges, which follows them when they move and traces itself in when new.
- The colors are CSS variables that follow the app's light and dark theme: `--hb-paper`, `--hb-ink`, `--hb-muted`, `--hb-line`, `--hb-accent`, and a variable for each note color. Fonts are the Mac's own; nothing is loaded from the network.

### The skill
- `hobkin/src/prompts/canvas.md` says a hobkin opens, draws on or shows a page on its canvas only when the user asks for it, and changes a drawing again only when asked or when what it shows stops being true. It says what a drawing helps with once asked (how parts connect, options side by side, ideas as notes, numbers as a chart, a rough mock-up), to add to the same drawing with each element's id kept, so only what changed moves, to use the kit, and scripts only when the drawing needs one. The commands and the rules from `035-canvas-drawings` stay.
- Changed on 2026-11-19, the user's words: "the agent sketch things without being asked". Until then the skill said to think on the canvas while talking and to draw instead of describing, and hobkins drew unasked. The main hobkin's client tool and the `canvas.show` and `canvas.draw` descriptions say the same.

## Out of scope
- The user drawing on the canvas, panning and zooming, more than one canvas per hobkin.
- Changing a drawing in pieces: the file is still replaced whole; only what the user sees changes in place.
- Changing a drawing with scripts of its own in place.
- Command+W: the File menu's Close Window keeps it.
- hobkin reading the page it shows, as in `030-canvas-panel`.

## Acceptance
- A1. The main canvas opening takes the right side to the canvas place; a redraw of an open canvas, or an opening while the right side covers the chat, leaves the view where it is.
- A2. The canvas place fills the right side below the menu, and the menu's second row shows the canvas group: the title, Reload, Save for a drawing, Open in the browser, Close.
- A3. Another screen leaves the canvas open with its pill in the second row, dotted after an unseen redraw; the pill and its number go back to it.
- A4. Closing returns to the place it was opened over, Settings or an agent's page included; Command+R on the canvas comes back to it while it is open.
- A5. On a durable hobkin's page with its canvas open, the right side grows by the chat's width and the divider, the page takes the chat's width and the canvas the right side's usual width; the menu's offset is the growth.
- A6. Escape closes the canvas only when the keyboard is in it; in the message input or elsewhere it leaves the canvas.
- A7. Command+S saves a drawing from the canvas; Control+Tab moves between the canvas and its agent.
- A8. A key from a drawing reaches the app only from the set above, only from the window's own frame and only while that frame has the keyboard.
- A9. A drawing is served with the runtime and the kit after its doctype, with `Access-Control-Allow-Origin: *`, the sandbox and no caching; without the runtime's files it is served as before.
- A10. A revision of a drawing without scripts changes it in place; one with scripts, one that cannot be fetched or read, or any before `ready`, loads fresh behind the one on screen.
- A11. New parts draw in, moved parts glide, removed parts fade, the first showing draws everything in, and nothing moves under Still or reduced motion.
- A12. The kit's pieces show in the app's light and dark colors, and an arrow joins two elements by id and follows them.
- A13. Both kinds of hobkin get the rewritten skill.
- A14. Escape in a web page in the canvas closes it.
- A15. Under Still movement, the canvas place and the split fade without travelling.

## Proof
- A1, A3, A4. `ui/test/canvas-place.test.ts`; check: ask hobkin to draw, go to Reports and back by the pill, close it.
- A2. check: a still render of the canvas place in light and dark.
- A5. `ui/test/canvas-place.test.ts` › the split's sizes; check: ask a durable hobkin to draw.
- A6, A7. `ui/test/keys.test.ts`.
- A8. `host/test/canvas-runtime.test.ts` › the keys a drawing passes on; `ui/test/canvas-panel.test.ts` › the frame's messages.
- A9. `host/test/canvases.test.ts`.
- A10. `host/test/canvas-runtime.test.ts` › in place or fresh; `ui/test/canvas-panel.test.ts` › before and after `ready`.
- A11. `host/test/canvas-runtime.test.ts` › the stagger and the glide; check: redraw a drawing in the window, then again under Still.
- A12. `host/test/canvas-runtime.test.ts` › the arrow's path; check: a still render of the kit, and a drawing with arrows in the window.
- A13. `hobkin/test/cli-canvas.test.mjs` › "the main prompts and a durable hobkin's directions hold the canvas skill".
- A14. check: after the shell's patch, Escape in a page shown on the canvas.
- A15. check: set Movement to Still and open both kinds of canvas.

## Steps
- [x] S1 (A8, A9, A10, A11, A12). The host's serving, the runtime and the kit. 711cf8b.
- [x] S2 (A1, A2, A3, A4, A5, A6, A7, A8, A10, A15). The window: the canvas place, the split, the menu row, the keys and the live frame. 9be647e.
- [x] S3 (A13). The skill. hobkin 5c474f2.
- [x] S4 (A14). The shell's Escape for a page, as a patch applied with the user's word, because it restarts the app. Applied with 0.1.21 on 2026-11-14.

## Open questions
- An arrow takes the shortest curve between two edges and does not route around other elements.
