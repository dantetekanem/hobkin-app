---
{
  "id": "008-review-code",
  "title": "Change Review: the code panel",
  "kind": "work",
  "status": "doing",
  "depends": ["007-review-story"],
  "updated": "2026-11-09"
}
---
# Change Review: the code panel

## Outcome

Double-clicking a node shows its code. A panel rises from the bottom to 30% of the window while the graph moves up and re-centers, so the node stays in view above its code. The panel shows the change the way GitHub does, with the surrounding lines within reach. Code is the extra: the graph stays on screen.

## Decisions

- The panel belongs to the canvas. The conversation is not covered.
- It opens with a spring, and the camera re-frames the focus in the same movement. It closes the same way in reverse.
- Highlighting uses Shiki's core build with the JavaScript regex engine, so no WebAssembly is loaded. A language grammar is loaded the first time a file of that language is shown. Unknown languages show as plain text.
- Two themes: a light theme for light mode and Dracula for dark mode. Both are applied as CSS variables, so a theme change recolors the code without highlighting it again.
- The diff is drawn by the client's own component on top of Shiki tokens and the `diff` package: one column (unified) by default, two columns as an option. `@pierre/diffs`, which pi-coder uses, was considered. It brings its own theming and a larger Shiki setup, and the panel needs this palette, these animations and note markers, so the first version draws its own.
- A row shows the old and new line numbers, a marker for added or removed, and the highlighted line. Added and removed lines are tinted. Words that changed within a line are tinted more strongly.
- Vicinity: three unchanged lines show around each group of changes. Controls between groups reveal more lines above or below, twenty at a time, and a control shows the whole file.
- The lines of the current story step have an accent bar at the left. Other changes in the same file are slightly dimmed.
- A node with ranges in several files shows them as tabs.
- Highlighting runs in a worker, and long files are drawn with a virtual list.
- The panel's height can be dragged between 20% and 70% of the window, and the height is remembered.

## Out of scope

- Editing code.
- Running or debugging.
- Image and binary diffs beyond naming the file.

## Acceptance

- A1. Double-click or Enter on a node opens the panel from the bottom to 30% of the window height in 450ms or less. During the same movement the graph re-centers, and when it settles the focus node is fully visible above the panel.
- A2. The conversation remains visible and usable while the panel is open.
- A3. The panel shows the node's change as a diff: added and removed lines tinted, old and new line numbers, and changed words within a line tinted more strongly.
- A4. Three unchanged lines surround each group of changes. "Show more" above or below a group reveals twenty more lines each time, and "Whole file" shows every line.
- A5. Code is colored with the light theme in light mode and with Dracula in dark mode. Switching the theme recolors open code with no reload and no new highlighting request.
- A6. Opening a TypeScript file downloads the TypeScript grammar and no other language. The highlighter without grammars (core, engine and both themes) is 150kB gzipped or less.
- A7. Escape closes the panel and the graph returns to the framing it had before.
- A8. Dragging the panel's top edge resizes it between 20% and 70% of the window, the graph re-frames as it moves, and the height is the same after a restart.
- A9. A 5,000 line file opens in under 300ms to first lines and scrolls at 60 frames per second.
- A10. An added file shows every line as added, a deleted file every line as removed, a renamed file its old and new paths, and a binary file a line saying it is not shown.
- A11. With reduced motion on, the panel and the graph take their new places with a fade and no travel.

## Proof

- A1. check: open the sample review in the Tauri window, double-click three nodes in different columns, and measure with the timing overlay.
- A2. check: with the panel open, type and send a message.
- A3. `ui/test/diff-rows.test.ts` › "builds rows with line numbers, markers and changed words"
- A4. `ui/test/diff-rows.test.ts` › "shows three lines of context and expands by twenty"
- A5. `ui/test/highlight.test.ts` › "emits both themes as variables in one pass"
- A6. check: `pnpm check:bundle` reports the highlighter chunk size, and the network panel shows one grammar request.
- A7. check: open, press Escape, compare the framing.
- A8. check: drag to both limits, restart.
- A9. check: open the 5,000 line sample file and read the timing overlay.
- A10. `ui/test/diff-rows.test.ts` › "handles added, deleted, renamed and binary files"
- A11. check: reduced motion on, open and close the panel.

## Steps

- [ ] S1 (A5, A6). The highlighter: core build, JavaScript engine, lazy grammars, both themes as variables, in a worker.
- [ ] S2 (A3, A4, A10). Diff rows from two file sides: line numbers, markers, changed words, context and expansion.
- [ ] S3 (A1, A2, A7, A8, A11). The panel: opening and closing with the camera, resizing, tabs for several files.
- [ ] S4 (A9). The virtual list and timing for long files.
