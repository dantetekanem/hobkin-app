# Notes

Findings and decisions made while building the foundation.

## 2026-11-09

- The dev server uses port 5187. Vite's usual 5173 was taken by another project's dev server on this machine, and Tauri needs a fixed address. The port is `DEV_PORT` in `vite.config.ts` and `devUrl` in `src-tauri/tauri.conf.json`.
- shadcn was initialized with the `base-nova` style, which builds on Base UI. The CLI installs a `cn` package for class merging, so `clsx` and `tailwind-merge` are not direct dependencies. It also added the Geist font and `next-themes`, which were removed: the app ships Inter, Space Grotesk and JetBrains Mono, and has its own theme switch (`ui/src/app/theme.ts`).
- The generated button was changed to a pill, and its `transition-all` to named properties.
- Tailwind has a built-in `overline` utility, a text decoration. The small uppercase label style is therefore named `eyebrow`.
- Hobkin tokens are prefixed `--hb-` because shadcn already uses `--accent`, `--border` and `--muted` with other meanings. shadcn's tokens are mapped onto them in `ui/src/styles/tokens.css`.
- Motion curves and durations follow the table in the `animate` skill rather than the site's rail curve. Tabs are used often, so a screen change shifts 28px and fades instead of sliding the full width.
- The avatar's reaction rules (`ui/src/avatar/reactions.ts`) are a port of hobkin's `src/cli/face-reactions.mjs` with the same timings, covered by `ui/test/avatar-reactions.test.ts`.
- The view state (screen, sidebar section, divider) is kept in the browser's storage for now. `014-continuity` moves it into the home.
- `pnpm check:contrast` checks 90 token pairs across both themes, including code text on the diff tints. All pass.
- The Tauri window uses an overlay title bar. The top bar leaves room for the window buttons through `--titlebar-inset`, set in `ui/index.html` when the page runs inside Tauri.

## 2026-11-09, after the user saw the first frame

- The first frame had three columns (sidebar, conversation, canvas) under a full-width top bar. The user rejected it. The frame is now the chat as one column and a floating canvas, with the screen menu floating over the canvas and no top bar. A second attempt put a chat bar beside the conversation and was rejected as still a third pane, so Projects and History became a veil over the chat.
- All interface text is Space Grotesk. The Inter package was removed.
- Screen changes were a 28px shift with a fade. The user said they lacked movement and fluidity. Screens now cross the whole canvas on a spring (`spring.screen`), sideways along the menu and vertically along the agents list, and their pieces land one after another (`ui/src/app/Reveal.tsx`).
- Running agents moved under the input. Moving onto one previews its canvas, and leaving the list restores the screen that was showing (`previewReturn` in `ui/src/app/view-store.ts`).
- A half-finished multi-file edit can leave the hot-reloaded page blank until a full reload. Touching `ui/index.html` makes Vite reload the page.

### Evidence so far

- S2, A5: `pnpm check:contrast` passes 90 pairs. In the browser the theme toggled from light to dark, `localStorage` held `dark`, and a reload opened in dark.
- A6: the gallery shows 18 moods, all animating. After moving the pointer over the chat the eyes had the transform `translate(4.75px, -5px)`. Reduced motion is not checked yet.
- A7: a drag moved the conversation from 460px to 560px, a reload kept 560px, Left on the focused divider gave 544px, and a double click returned to 460px.
- A10: with the app's width held at 1600, 1280 and 1100 pixels the chat stayed 460px and the canvas panel measured 1120, 800 and 620 pixels, with no third pane. The menu stayed inside the panel, and at 1100 only the open screen kept its label. The browser window itself would not resize, so the width was set on the app's root.
- A11: checked by eye in both themes, in the browser and in the Tauri window.
- A12: from Routines, Down showed the first agent's canvas, Down the second, Up the first again, and Escape returned to the input with Routines showing and the Agent item gone from the menu. Enter kept the canvas and moved the keyboard into it.
- A1: `pnpm dev` serves the frame, and `pnpm tauri dev` showed it in a native window, but that run used a config override because Vite was already running. The plain command, which starts Vite itself, is not exercised yet.
- A8 (reduced motion) is not checked yet.
