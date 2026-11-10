---
{
  "id": "006-review-graph",
  "title": "Change Review: the graph",
  "kind": "work",
  "status": "doing",
  "depends": ["001-foundation", "005-review-model"],
  "updated": "2026-11-10"
}
---
# Change Review: the graph

## Outcome

A review opens on the canvas as a node graph in the hobkin palette. At a glance the reviewer sees what the change promised, which tests prove it, which code carries it, and how those connect. It reads like an Unreal Engine Blueprint drawn in this design.

## Decisions

- Built on React Flow (`@xyflow/react`) with custom node and wire components. The visual language is in `000-product/design.md`.
- Columns run left to right: spec, tests, code, context. Positions come from the review file, so the layout is the same every time. A node the user drags keeps its new place for that review.
- A node card shows a kind icon and title, where it lives, one line on what changed, the size of the change, and a status: a test is passed, failed or not run, and an acceptance line is proven or unproven.
- Wires leave from a pin on the right and arrive at a pin on the left. A wire is tinted by its kind. A wire the model proposed is drawn dashed until the user confirms or removes it.
- Hovering a node lights its wires and neighbors and dims the rest. Clicking a wire shows its label.
- The graph is a view of the review model. It never edits code ranges.
- The review screen is a canvas screen like the others, opened from a finished change's card or by a command. The conversation stays where it is.

## Out of scope

- The story, the code panel and notes (`007`, `008`, `009`).
- Editing the graph's structure. A reviewer can move nodes, and confirm or remove proposed wires, and nothing else.

## Acceptance

- A1. Opening a review shows every node of the review file in its column, with no two nodes overlapping, and every wire running from a right pin to a left pin.
- A2. Each node kind can be told apart with color removed (grayscale), by its icon and label.
- A3. A node shows its title, path, one-line summary, added and removed line counts, and status. An unproven acceptance line and a failed test are visibly marked.
- ~~A4. The graph pans by dragging and by two-finger scroll, zooms by pinch and by Command with scroll, and fits to the window with the `0` key and a button.~~ Retired: `0` now goes to step 10 (`007-review-story` A14). See A11.
- A5. A node the user drags stays where it was dropped after the review is closed and reopened.
- A6. Hovering a node highlights its wires and direct neighbors and dims every other node.
- A7. Clicking a wire shows its kind and label. A dashed wire offers Confirm and Remove, and the choice persists.
- A8. With 80 nodes and 160 wires, a 3 second pan in the Tauri window keeps 95% of frames under 16.7ms.
- A9. With reduced motion on, the graph appears without entrance movement and hover changes are instant.
- A10. The first opening of a review plays an entrance in column order: spec, then tests, then code, then context, with wires drawing after the nodes they join.
- A11. The graph pans by dragging and by two-finger scroll, zooms by pinch and by Command with scroll, and fits to the window with the `G` key and a button.
- A12. With the keyboard, Up and Down move the focus to the nearest node above or below, and Shift with Right or Left follows a wire to the node it connects to on that side, nearest in height, or to the nearest node that way when no wire leaves that side.

## Proof

- A1. `shared/test/review-layout.test.ts` › "places nodes in columns without overlap"
- A2. check: view the graph with a grayscale filter. Kinds are still distinct.
- A3. check: open the sample review. Compare three nodes against the review file.
- A4. Retired.
- A5. `ui/test/review-positions.test.ts` › "keeps a moved node's position for that review"
- A6. check: hover nodes in each column.
- A7. `ui/test/review-wires.test.ts` › "confirming or removing a proposed wire persists"
- A8. check: load the 80 node stress review in the Tauri window and read the frame-time overlay.
- A9. check: reduced motion on, reopen the review.
- A10. check: open the sample review for the first time and watch the order.
- A11. check: pan, pinch, Command with scroll, `G`.
- A12. `ui/test/review-focus.test.ts` › "Shift with the arrows follows a wire to the node it connects to"

## Steps

- [ ] S1 (A1, A2, A3). Node cards for each kind, pins, and the wire component, rendered from the sample review.
- [ ] S2 (A4, A5, A6, A7, A11, A12). Interaction: pan, zoom, fit, drag with saved positions, hover, wire labels, proposed wires, moving the focus with the keyboard.
- [ ] S3 (A10, A9). The entrance, and the reduced-motion path.
- [ ] S4 (A8). A stress review of 80 nodes, a frame-time overlay for development, and tuning until the budget holds.
