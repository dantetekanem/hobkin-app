---
{
  "id": "020-settings",
  "title": "Settings",
  "kind": "work",
  "status": "doing",
  "depends": ["001-foundation", "017-model-tiers", "019-keyboard"],
  "updated": "2026-11-10"
}
---
# Settings

## Outcome

Settings is a screen on the canvas that looks like hobkin's desk, not a form. Each setting is a small living scene, and the scene is the control: the sun sets behind the hills when the theme goes dark, hoods walk in and out as the number of agents changes, the avatar hops or holds still with the movement setting. The user sees what a setting does while changing it, and hobkin can change the same settings from the conversation.

## Decisions

- Settings opens with Cmd+comma and from a button in the chat's header. It is a canvas screen, so the conversation stays beside it. While it is open it has an item in the screen menu. Closing it, or Escape, returns the canvas to the screen it showed before.
- The screen is a grid of tiles. A tile has a name, the current value in words, and a scene. Tiles arrive one after another.
- First tiles:

  | Tile | Setting | Scene |
  | --- | --- | --- |
  | Day and night | Theme: light, dark, or follow the Mac | Hills with a sun that sets and a moon that rises |
  | Agents at once | How many agents work mode runs together, 1 to 8 | A row of hoods that grows and shrinks |
  | Models | The lead and the four tiers | Five sets of bars. Opens the tiers lightbox of `017-model-tiers` |
  | Daily budget | Tokens work mode may spend in a day | A track with today's use on it |
  | Type | The face for reading text: Space Grotesk, Inter, Geist, DM Sans or Figtree | A message and a line of small text in the chosen face. The whole app changes with it |
  | Movement | Lively, follow the Mac, or still | The avatar hopping, breathing, or holding still |
  | What leaves this Mac | Usage events and feedback, each on or off | Two switches with the plain sentence from hobkin's README |
  | Keys | The keyboard map | The keys of `019-keyboard`, read only |
  | Nerd stats | Nothing to set. Numbers for the curious | How the window is drawing (frames a second, the slowest frame, memory), and what hobkin spent and ran today (tokens in, out and cached, context used, compactions, cost, runs by outcome, host and versions) |

- Account, data folder and versions get a tile once the host supplies them. Until then they are left out rather than shown empty.
- Settings that belong to the client alone (theme, type, movement) are kept by the client and work at once. Settings that belong to hobkin (agents, budget, models, usage events, feedback, account) are hobkin's own: the host reads and writes them through hobkin's code, and the terminal app sees the same values. Until the host supplies them, the tiles run on sample values and say so.
- Every tile works from the keyboard, by the rule of `019-keyboard`: Up and Down move between controls, Left and Right change a choice or a number, Enter opens what a tile opens. Opening Settings puts the keyboard on the first control.
- Every change is a command (`013-hobkin-access`), so hobkin can make it, and a change hobkin makes plays the same scene.
- A change that costs money or reaches outside the Mac (budget up, usage events on) says so in one line under the control. Nothing here asks "are you sure".

## Out of scope

- Changing keys.
- Per-project settings. Those live with the project in work mode.
- Themes beyond light and dark.

## Acceptance

- A1. Cmd+comma and the header button open Settings on the canvas with the conversation still visible. Close and Escape return the canvas to the screen it showed before, and the Settings item leaves the menu.
- A2. Choosing light, dark or follow the Mac changes the theme at once with the reveal of `001-foundation`, the sun and moon move to match, and the choice holds after a reload. With follow the Mac, changing the Mac's appearance changes the app.
- A3. The agents tile shows as many hoods as the setting, between 1 and 8. Plus, minus and the arrow keys change it by one, and it stops at both ends.
- A4. The Models tile shows the lead's and each tier's model and thinking level, and opens the tiers lightbox. After Apply in the lightbox the tile shows the new values.
- A5. Movement set to still makes screen changes fade without travel and holds the avatar still, whatever the Mac's setting. Set to lively, movement plays even when the Mac asks for less. Follow the Mac does what the Mac says.
- A6. The daily budget changes in steps with the arrow keys and by dragging, and shows today's use against it.
- A7. Each switch under What leaves this Mac states in one sentence what is sent and when, and its state after a reload matches what was chosen.
- A8. Every control in Settings can be reached and changed with the keyboard alone, and the control holding the keyboard is visibly marked.
- A9. A setting that belongs to hobkin, changed in the client, reads the same in the terminal app, and the reverse.
- A10. hobkin changing a setting through a command plays the same scene as the user changing it.
- A12. Nerd stats shows the window's frames a second and slowest frame, updated every second while Settings is open, and hobkin's tokens, context, cost and runs for today. A number that is a sample says so.
- A11. Choosing a reading face changes the reading text across the app at once and holds after a reload. Headings, the screen menu and the wordmark stay in Space Grotesk.
- A13. Integrations sits under Settings wherever it is opened from. The menu's second row reads Settings › Integrations, Settings there goes back up, and its close button closes both. Leaving Integrations by Escape lands on Settings with the keyboard on its way into Integrations.
- A14. Nerd stats opens with an about line: the app's name and version, the version of hobkin it runs, the kind of build, and whether it runs in the Mac window or a browser tab. The app is called hobkin everywhere the Mac shows its name.

## Proof

- A1. `ui/test/keys.test.ts` › "command comma opens settings from anywhere"
- A2. check: choose each theme, reload, then change the Mac's appearance with follow the Mac chosen.
- A3. `ui/test/settings.test.ts` › "agents stay between one and eight"
- A4. check: open the lightbox from the tile, change a tier, Apply, read the tile.
- A5. `ui/test/still.test.ts` (the rule); check: set still, change screens and watch the avatar. Set lively with the Mac's reduce motion on. Seen 2026-11-10: under still, changing to Routines and to Pages moved the screen and its pieces by 0px in every frame while they faded. Motion's own reduced motion leaves whole `transform` strings alone, so each moving part asks `useStill()` (ui/src/app/still.ts). Done for the screen travel, Hero and Rise, the canvas growing over the chat, the menu's second row, the agents list, the veil, the question sheet, chat messages and the blocks of a reply being written, the agent canvas, and the Reports rows; `holdStill` and `stillVariants` (ui/src/app/still-rule.ts, tested) drop the travel from both ends, so nothing grows from nothing. Seen 2026-11-10 under still: 0px in the question sheet, the menu's second row and an agent preview. GitHub and Integrations hold still on their own. Left: Routines' own movement, not checked.
- A6. `ui/test/settings.test.ts` › "the budget moves in steps and stays in range"
- A7. check: flip each switch, reload.
- A8. check: walk the whole screen with Tab and the arrow keys in both themes.
- A9. `host/test/settings.test.ts` › "hobkin's settings round trip through hobkin's own config"
- A10. `host/test/client-tool.test.ts` › "a settings command reaches the open window"
- A11. check: choose each face, read the conversation and the menu, reload.
- A12. check: open Settings and watch the frames line change. With the host connected, compare the tokens line with `hobkin telemetry`.
- A13. `ui/test/overlays.test.ts`; check: Cmd+I from Work, Escape, Escape (seen 2026-11-09: Settings › Integrations, then Settings with the keyboard on "Open integrations", then Work).
- A14. check: read the about line in the window and in a browser tab (seen 2026-11-09 in a tab: "hobkin 0.0.1, core 0.1.6, development build, browser tab"), and the name in the Mac's menu bar.

## Steps

- [x] S1 (A1). The Settings screen on the canvas, its key, its header button, and the return to the previous screen.
- [ ] S2 (A2, A5, A11). The client's own settings: theme with follow the Mac, type, and movement.
- [ ] S3 (A3, A4, A6, A7, A12). The tiles for hobkin's settings and the nerd stats on sample values, with their rules tested.
- [x] S4 (A8). Keyboard through every tile.
- [ ] S5 (A9, A10). Host: hobkin's settings as state and commands.

## Open questions

- Which of hobkin's settings belong here beyond these? Work mode has more (the folder, the pull request default, reviews on finish, auto pick), and so do routines (how many run at once).
- Should the budget tile also show the subscription's own limits when Pi reports them?
