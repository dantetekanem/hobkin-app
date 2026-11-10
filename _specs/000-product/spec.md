---
{
  "id": "000-product",
  "title": "hobkin client",
  "kind": "context",
  "status": "draft",
  "depends": [],
  "updated": "2026-11-09"
}
---
# hobkin client

## Outcome

A Mac app where the user talks to hobkin on the left and sees its work on the right. The chat is the screen itself, one column with the hobkin avatar next to the input. The canvas floats over the right side: work mode, routines, reports, action items, pages hobkin draws, and Change Review, which teaches a finished change as an animated graph of specs, tests and code. One hobkin delegates to many agents, and the app shows them working.

The client is a second front end for the hobkin that the terminal app runs. It uses the same `~/.hobkin`, the same Pi sessions and the same Pi Durable receipts.

## Decisions

### Shape of the app

- There are two things on screen, never three boxed columns: the chat and the canvas.
- The chat is the screen itself, one continuous surface. The conversation never leaves it, whatever the canvas shows.
- Projects and earlier conversations are not a pane. Two buttons at the top of the chat open them as a veil over the chat: a translucent layer inside the chat's own bounds, with the conversation still visible beneath it. Switching between the two slides only the list.
- It is a two-sided app. The canvas is the right side: it runs flush to the top, bottom and right of the window, and its rounded, shadowed left edge is the one division, where it lies over the chat.
- The screen menu floats over the top of the canvas. There is no top bar. Its items follow hobkin's terminal tabs: Reports, Routines, Action Items, Work, then Pages. A menu item changes what the canvas shows, with a transition in the direction of the item.
- Agents that are running sit at the bottom of the chat, under the input. They are navigated the way pi-extended-teams' activity card is, and each one has its own canvas that shows how its work is going. Moving onto an agent shows its canvas at once, and going back to the input puts the canvas back as it was. Enter steps into an agent to talk to it: the canvas grows over the chat, the chat darkens and blurs a little, and an input rises in the canvas.
- The avatar sits beside the message input and shows hobkin's mood.
- The input takes several lines and images. Ctrl+Option+P opens a full prompt editor with Markdown, as pi-prompt does.
- The gap between the chat and the canvas can be dragged to resize the conversation.
- Schedules are called routines everywhere.

### Principles

- P1. Connection matters more than code. A screen shows how things relate first and shows code on request.
- P2. Motion explains, and there is plenty of it. Things travel and settle on springs. A transition shows where something came from and where it went, so nothing teleports and nothing merely fades. Reduced motion is respected.
- P3. hobkin can drive the app. Every action a person can take in the UI is a named command. hobkin can run the same commands and read the same state.
- P4. hobkin can draw on the canvas. A page is data hobkin writes, and the client renders it with its own components.
- P5. One hobkin, one home. The client adds data under the home and never forks hobkin's formats.
- P6. Work is spec driven. Specs live in `_specs/`, and Change Review reads them.
- P7. The client never spends tokens or touches the real home by surprise. Development uses a separate home and a scripted model until the user chooses otherwise.
- P8. Everything works from the keyboard. The mouse is supported and never required. The keys follow the user's Pi habits: Tab walks the canvas menu, Down and Up walk the agents. See `019-keyboard`.

### Stack

- A Tauri 2 window (Rust shell), a React 19 and Vite UI, and a Node host process that imports hobkin.
- shadcn/ui components on Tailwind 4, themed with the hobkin.dev palette in light and dark. Headings, labels and the wordmark are Space Grotesk. The face for reading text is the user's choice in Settings, Space Grotesk by default. Code is JetBrains Mono.
- Motion for animation, React Flow for node graphs, Shiki for code.
- pnpm, TypeScript, and Node 22.19 or newer, the same floor as hobkin.

### Model access

- The first version signs in with an existing OpenAI subscription through Pi ("Sign in with ChatGPT"). Other providers come later through the same screen.

### Answers from the user on 2026-11-09

- The app runs as a Tauri window.
- `_specs/` is the convention here and in every project hobkin changes.
- Change Review opens hobkin's finished work (`hobkin/*` branches) in the first version.
- Continuity covers four things: reopening where the user left off, work that survives a quit, memory from run to run, and the same data as the terminal app.
- The host imports hobkin from `~/Poetry/hobkin`. Small additive changes to hobkin are allowed, on a branch for review.
- After the foundation, real chat and Change Review are built in parallel.
- hobkin's access covers driving the app and drawing on the canvas.
- Delegated work uses four model tiers (fast, mid, high, max). Each is a model plus a thinking level, picked in a lightbox, with no split between reading and writing. hobkin gets its own version of `teams.md` and of the team-leader skill.
- Git is initialized. Nothing is committed until the user says so.
- After seeing the first frame: the chat is the only screen, with its chat bar on the left and the canvas floating on the right. The screen menu floats over the canvas. Space Grotesk is the font everywhere.
- Running agents go at the bottom of the chat, with navigation like pi-extended-teams, and each has a rendered canvas of its own.
- The input supports several lines, attached images, and Ctrl+Option+P for full prompt focus with full Markdown, like pi-prompt.
- A chat bar beside the conversation was rejected as a third pane. Projects and history live within the chat, as a veil.
- The whole app must be usable from the keyboard alone, in the manner of the user's Pi setup.
- Moving onto an agent with Down renders its canvas, and returning to the input restores the screen that was there before.
- The first transitions lacked movement. Motion must be generous and fluid.
- The canvas with space around it read as a box inside a box. It is a two-sided app: the canvas is flush on three sides, and the division on its left stays.
- Tab and Shift+Tab change the screen from anywhere. Left and Right never do. With Projects or History open, Up, Down, Enter and Escape work wherever the keyboard is.
- The menu order is Reports, Routines, Action Items, Work, Pages.
- A new agent pops into the list like a bubble rising. Working agents move. The menu item for an agent carries its name. Enter on an agent steps into it to talk to it.
- The veil's blur grows with the list's slide, and changing between light and dark is smooth.
- Settings is needed, and may be creative (`020-settings`).
- Space Grotesk as small text did not look good enough. The type was tuned, and Settings offers other reading faces to compare.
- Project dependencies may be installed and local dev servers may run. The host uses a separate data folder, never the real `~/.hobkin`, until the user says so.

## Out of scope

- Windows and Linux builds.
- Two owners of one home at the same time. The terminal app and the client take turns (see `002-host`).
- hobkin changing the client's source code, and mods loaded at runtime.
- Reviewing changes hobkin did not make, such as other branches or GitHub pull requests.
- Providers other than OpenAI in the first version.

## Acceptance

- A1. With the app open, the conversation is visible on every screen and in every canvas state, including Change Review with the code panel open.
- A2. Every canvas screen can be reached from the screen menu, and every action on it can also be run by hobkin as a command.
- A3. Closing and reopening the app shows the same conversation, the same canvas screen and the same place in an open review.
- A4. For one home, the terminal app and the client show the same routines, reports, work and conversation.
- A5. The app works in light and dark themes with the hobkin.dev palette, and text passes WCAG AA contrast in both.

## Proof

- A1. See `001-foundation` A10 and `008-review-code` A2.
- A2. See `001-foundation` A2 and `013-hobkin-access` A1.
- A3. See `014-continuity` A1.
- A4. See `014-continuity` A5.
- A5. See `001-foundation` A5.

## Open questions

- Should the terminal app and the client be able to run at the same time? That needs hobkin's runtime to become a background host that both attach to, which is a large change inside hobkin. The first version takes turns.
- Should a packaged app bundle Node and Pi, or keep requiring them on the machine as the terminal app does? See `016-packaging`.

## Related

- `design.md`: palette, type, components, motion and the avatar.
- `architecture.md`: processes, protocol, data, and how the client uses hobkin and Pi.
