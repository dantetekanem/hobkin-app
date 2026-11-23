---
{
  "id": "001-foundation",
  "title": "Foundation: window, palette, frame and avatar",
  "kind": "work",
  "status": "doing",
  "depends": [],
  "updated": "2026-11-23"
}
---
# Foundation: window, palette, frame and avatar

## Outcome

The app opens in a Mac window and in a browser tab and shows its full frame on sample data: the chat as one column with the avatar beside the input and the running agents under it, the veil that lists projects and earlier conversations over the chat, and the canvas floating on the right with the screen menu over it and a placeholder for each screen. It uses the hobkin.dev palette in light and dark. Everything later is built inside this frame.

## Decisions

- One package at the repo root with `ui/`, `host/`, `shared/` and `src-tauri/`. pnpm only.
- Vite and React with TypeScript. Tailwind 4 through its Vite plugin. shadcn/ui components copied into `ui/src/components/ui` and themed with the tokens in `000-product/design.md`.
- Tokens live in one stylesheet, `ui/src/styles/tokens.css`. The theme is a class on the root element (`light` or `dark`). It follows the system until the user picks one, and the choice persists.
- Fonts are bundled: Space Grotesk for all interface text and JetBrains Mono for code.
- Motion values live in `ui/src/lib/motion.ts`.
- The avatar is one React component with all 18 moods, ported from hobkin's SVG art.
- The frame takes its content from a sample store in this step. `002-host` replaces the store's source without changing the frame.
- Screen menu items, in the order of hobkin's terminal tabs: Reports, Routines, Action Items, Work, then Pages. Review, Agent and Settings appear while one of them is open.
- Projects and History open from two buttons in the chat's header as a veil over the chat. They are not a pane.
- The frame owns the keyboard map of `019-keyboard`.
- The Tauri shell only opens the window in this step. Starting the host comes in `002-host`.
- A page's column grows with a bigger window (the user, 2026-11-23: "dashboard and others can be a bit larger in the width for bigger screens, i want max to reach 30%+ of what is now, but in my current screen is fine"). Every one-column and two-pane page takes its width from one custom property, `--page-width` (`ui/src/styles/tokens.css`, read by `ui/src/app/screen-layout.ts`). It is 1040px in a window 1728px wide or narrower, the width of the user's screen that day. A wider window gives the page half of each extra pixel, up to 1380px, a third more, in a window 2408px wide. Reading widths, the chat column, dialogs and the review graph keep their own.

## Out of scope

- Real data, the host, sign-in.
- The content of each canvas screen beyond a placeholder that proves the transition.
- Packaging a distributable app.

## Acceptance

- A1. `pnpm dev` serves the UI at a local address, and `pnpm tauri dev` shows the same UI in a native Mac window.
- A2. Choosing an item in the screen menu changes only the canvas. The new screen crosses the canvas from the side its item is on and settles on a spring, the old one leaves the other way, and the pieces of the new screen land one after another.
- ~~A3. The buttons at the top of the sidebar (Agents, Projects, History) slide only the list under them.~~ Retired on 2026-11-09: the sidebar column became the chat bar. See A9.
- ~~A4. The conversation stays visible at every window width from 1100px up. Below 1280px the sidebar collapses to a rail.~~ Retired on 2026-11-09: there is no sidebar column. See A10.
- A5. Light and dark themes use the hobkin.dev palette. The choice survives a reload. Every text and background pair used by the tokens passes WCAG AA: 4.5 to 1 for body text and 3 to 1 for large text and interface glyphs.
- A6. The avatar shows each of the 18 moods, its eyes follow the pointer over the conversation, and with reduced motion on it holds still.
- A7. Dragging the divider resizes the conversation and the canvas between their minimum widths, and the position survives a reload.
- A8. With reduced motion on, screen and veil changes are fades and nothing travels across the screen.
- A9. Projects and History open as a veil over the chat: a translucent layer inside the chat's bounds with the conversation visible beneath it. Switching between them slides only the list. Escape, a click on the veil, or choosing a row closes it.
- A10. The window shows two things: the chat, as one column, and the canvas. There is no third pane. The conversation is visible at every window width from 1100px up.
- ~~A11. The canvas is a rounded panel with a shadow and the chat's surface visible around it on three sides.~~ Retired on 2026-11-09: that read as a box inside a box. See A13.
- A12. Running agents are listed under the input. With the list focused, Down and Up move between agents and the canvas shows the selected agent at once, traveling up or down with the list. Enter steps into the agent (`011-work`). Escape, or Up from the first agent, returns to the input, and the canvas returns to the screen it showed before. With no agent running the list is not drawn.
- A13. The canvas fills the right side of the window, flush at the top, bottom and right. Its left edge is rounded and shadowed where it meets the chat. The screen menu floats over its top, and there is no bar across the top of the window.
- A14. Changing theme opens the new theme in a circle from the control that was used. No part of the window switches color in a hard cut.
- A15. In a window 1728px wide or narrower a page's column is 1040px, as before. It is 1136px at 1920, and 1380px at 2408 and wider. Every page that was 1040px wide follows the one definition.

## Proof

- A1. check: run both commands. The same frame appears in the browser and in the window.
- A2. check: in the browser, click each menu item in both directions and watch the canvas only.
- A5. check: `pnpm check:contrast` prints every pair with its ratio and exits 0. Toggle the theme, reload, and the theme holds.
- A6. check: open the avatar gallery at `/#/dev/avatar`, step through the 18 moods, move the pointer, then turn on reduced motion.
- A7. check: drag the divider to both limits, reload.
- A8. check: turn on reduced motion in System Settings and repeat A2 and A9.
- A9. check: open Projects, switch to History, close with Escape, then with a click on the veil. The conversation shows through the veil.
- A10. check: resize the window from 1600px down to 1100px. Count the regions.
- A12. check: from Routines, press Down in an empty message, then Down, Up and Escape. The canvas follows the agents and ends on Routines.
- A13. check: measure the canvas against the window in both themes. The gaps at the top, right and bottom are zero.
- A14. check: switch theme with the header button and from Settings, and watch the reveal.
- A15. check: `rg -n "1040" ui/src` finds the number only in `tokens.css` and in sample data; the built style sheet holds `--page-width` and the three rules that read it (2026-11-23). Not seen in a window.

## Steps

- [ ] S1 (A1). Scaffold the package: pnpm, TypeScript, Vite, React, Tailwind, shadcn, fonts, scripts.
- [x] S2 (A5). Write the tokens for both themes, map them to shadcn's tokens, add the theme switch and the contrast check.
- [ ] S3 (A6). Port the avatar with its moods, eye follow and pointer reactions.
- [ ] S4 (A2, A7, A8, A9, A10, A12, A13, A14). Build the frame: the chat column with its header and veil, the agents under the input, the divider, and the floating canvas with its menu and traveling screens, on a sample store.
- [ ] S5 (A1). Add the Tauri shell that opens the UI in a window.
- [x] S6 (A15). The page width as one custom property: 8602378, and the two pages that wrote the number themselves 3b5cdac. Not seen in a window. At the widest, the 260px blocks of the GitHub rows and the 600px proof chart keep their size.
