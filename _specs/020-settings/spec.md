---
{
  "id": "020-settings",
  "title": "Settings",
  "kind": "work",
  "status": "doing",
  "depends": ["001-foundation", "017-model-tiers", "019-keyboard"],
  "updated": "2026-11-14"
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
  | Open by default | Which kinds of an agent's blocks arrive open: code changes (on), commands, reads and searches, and other tools (off) (`021-agent-rendering`) | Four switches, each with what its blocks show |
  | What leaves this Mac | Usage events and feedback, each on or off | Two switches with the plain sentence from hobkin's README |
  | Subscriptions | Nothing to set. Every provider Pi reaches and how, and Claude Code | One row each. Claude Code shows its version and plan, or a link to get it (`033-claude-code-agents`) |
  | Claude Code | Whether Work, delegated jobs and routines run on Claude Code, with its model, effort and permissions | A switch, the three kinds and three choices, with the line that it spends the Claude subscription (`033-claude-code-agents`) |
  | Keys | The keyboard map | The keys of `019-keyboard`, read only |
  | Backup | Automatic backup of hobkin's records on or off, hourly or daily, and how many to keep. Back up now, and Restore one | The backups kept, newest first, with their time and size |
  | Nerd stats | Nothing to set. Numbers for the curious | How the window is drawing (frames a second, the slowest frame, memory), and what hobkin spent and ran today (tokens in, out and cached, context used, compactions, cost, runs by outcome, host and versions) |

- Account, data folder and versions get a tile once the host supplies them. Until then they are left out rather than shown empty.
- Settings that belong to the client alone (theme, type, movement) are kept by the client and work at once. Settings that belong to hobkin (agents, budget, models, usage events, feedback, account) are hobkin's own: the host reads and writes them through hobkin's code, and the terminal app sees the same values. Until the host supplies them, the tiles run on sample values and say so.
- A custom theme stays until the user changes it (the user, 2026-11-14: "custom theme doesnt persist when i ask to change, or we dont keep a history of them"). The host keeps every theme hobkin makes in `client/themes.json`, beside the theme on now in `client/custom.css`: newest first, at most 12, each with its name, the user's own words when hobkin passed them on, its colors, its photo and when it was made. The same colors again are the same theme, not a new one. Light, Dark and Follow the Mac stop showing the custom theme but keep it in the list, and Custom puts back the one shown last. Under Custom, Settings shows the kept themes as small swatches in their own colors. Picking one puts it on, and it opens from its swatch; Edit renames them or removes them, but not the one on now. hobkin reads and changes the same list with `appearance.themes`, `appearance.pick`, `appearance.rename` and `appearance.remove`, so "go back to yesterday's theme" works from the chat.
- Every tile works from the keyboard, by the rule of `019-keyboard`: Up and Down move between controls, Left and Right change a choice or a number, Enter opens what a tile opens. Opening Settings puts the keyboard on the first control.
- Every change is a command (`013-hobkin-access`), so hobkin can make it, and a change hobkin makes plays the same scene.
- A change that costs money or reaches outside the Mac (budget up, usage events on) says so in one line under the control. Nothing here asks "are you sure".
- A backup holds hobkin's own records and nothing else (the user, 2026-11-13: "i said only hobkin data", and "so if i restore a backup, i go back in time"): settings, memory and notes, routines, reports, decisions and answers, conversations, durable hobkins, canvases, the work queue and each project's records with its pull requests and each run's brief and report, the runtime's store and the client's own files. One rule, `leftOut` in `host/src/backup.ts`, leaves out the rest: each project's working trees, the clone hobkin makes of a project with no folder on this Mac (`work/<project>/repo`), review checkouts and release builds, what runs leave beside their reports (folders named `<x>-evidence`, `<x>.evidence`, `<x>-artifacts` or `<x>.artifacts` in `runtime/handoffs/`, a project's folder or its `prs/`, and all of a project's `runs/` but the briefs and reports; the same names elsewhere, such as `memory/tax-evidence`, are the user's records), the Change Review checkouts and clones (`client/review-trees`, `client/review-clones`), the run transcripts in `jobs/`, the notes index, and the two files of the running process. Any other folder holding `.git` is left out too: a checkout is code, and rolled back it would lose its commits. Each SQLite store goes in as SQLite's own whole copy (`VACUUM INTO` from a read-only connection), without its `-wal`, `-shm` or `-journal`. What a backup could not take (a file it could not read, a name with a control character, which zip cannot be given) is told in the tile and the log. On 2026-11-13 the records were 88 MB of the 15 GB home. The Restore dialog is the only way to restore, after a typed word.
- A restore puts the records back as the backup has them and leaves all the rule leaves out exactly as the home has it now: never moved, deleted or taken from an archive, so an agent working in a tree keeps its folder. Only records move, one rename each: the home's own are set aside in `<home>.replaced`, then the backup's go in. When a step fails everything moves back. When moving back fails too, what could not go back stays in `<home>.replaced` and the error names it; the next restore stops while that folder is there. A copy of the records is saved first as a backup marked before-restore; the newest three of those are kept apart from the limit, and the next automatic backup comes a whole cadence after a restore, so no prune follows it at once. A record that copy could not take stays where it is, so a restore never deletes a record it cannot give back. A backup inside the home, also through a link, is refused. A restore swaps records under a running hobkin, so the window lets it start only while nothing runs and restarts the host right after it. The host's own check (`busy` in `Backups`) is there, but `host/src/host.ts` does not pass it yet.

## Out of scope

- Changing keys.
- Per-project settings. Those live with the project in work mode.
- Themes beyond light and dark.

## Acceptance

- A1. Cmd+comma and the header button open Settings on the canvas with the conversation still visible. Close and Escape return the canvas to the screen it showed before, and the Settings item leaves the menu.
- A2. Choosing light, dark or follow the Mac changes the theme at once with the reveal of `001-foundation`, the sun and moon move to match, and the choice holds after a reload and after a restart, also when a custom theme was showing before it: the host is told and starts on that base too, and the custom theme stays in its kept list. With follow the Mac, changing the Mac's appearance changes the app.
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
- A15. Open by default has a switch for each kind of an agent's blocks, with code changes on and the rest off at first. A switch changes the blocks on screen that were not opened or closed by hand at once, and holds after a reload. Settings saved before it load with code changes on.
- A16. Nerd stats is a solid panel, 80% of the window's width and 60% of its height, that does not show the screen through it. Its groups sit side by side as columns of label and value rows, and the panel scrolls inside when they do not fit. It opens from the button in Settings, from Command+K ("Nerd stats") and from Control+Option+S, on any screen.
- A17. A backup holds every record and nothing the rule leaves out. Names with spaces, quotes, other alphabets and a leading dash, empty folders, and links (kept as links, never followed) come back as they were. A file gone before zip reads it is skipped and the backup is still made, and a home with no records still makes one.
- A18. A restore puts the records back and leaves what the rule leaves out exactly as the home has it, each at its path through every step, and takes none of it from the archive, even one that holds it.
- A19. A restore that fails at any one step leaves the home as it was. One that cannot move things back deletes nothing, and its error names where the pieces are. A `<home>.replaced` left by a restore cut short stops the next restore, and is not deleted.
- A20. The Backup tile says in one line what a backup holds and what it leaves out, and the restore dialog says the records go back to that moment while working copies stay as they are now.
- A21. hobkin's clones and every other git checkout in the home are in no backup and never moved by a restore: a tree made after the backup still works after it, with its branch and commits.
- A22. Each SQLite store is in a backup whole and alone, even when a checkpoint falls while zip reads, and a restored store is never paired with the write-ahead log of the one hobkin has open.
- A23. A backup says what it could not take, and a restore leaves those files where they are. A folder of the user's named like run evidence is a record.
- A24. The copies a restore takes first outlive ordinary pruning, the newest three of them, and no automatic backup runs right after a restore, also after a host restart. The dialog says how long the copy is kept.
- A25. A restore waits while hobkin answers or anything runs, and the host restarts right after it. A backups folder that is in the home through a link is refused for backups and restores.
- A26. A custom theme hobkin made keeps its colors, name and photo after a reload, a host restart and an app restart, until the user or hobkin changes it. Every one is kept, newest first, up to 12, and the list holds after a restart. After a built-in theme, Custom brings back the one shown last. From Settings and from the chat, a kept theme can be put back on, renamed or removed, except the one on now, which cannot be removed.

## Proof

- A1. `ui/test/keys.test.ts` › "command comma opens settings from anywhere"
- A2. check: choose each theme, reload, then change the Mac's appearance with follow the Mac chosen. `ui/test/theme-host.test.ts` › "the user's own choice of a built-in theme reaches the host, so a restart does not bring the custom theme back"; `host/test/appearance.test.ts` › "hobkin puts the app back on a built-in theme, and a restart does not bring the custom one back"
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
- A15. `ui/test/settings-appearance.test.ts` › "the store loads settings saved at version 1 without losing them"; `ui/test/agent-blocks.test.ts` › "a block arrives open or closed as Settings says for its kind, and a change in Settings applies at once"; check: flip each switch with an agent open, reload.
- A16. check: open it from Settings, from Command+K and from Control+Option+S on Home, and read it over a busy screen at a narrow and a wide window. Keys: `ui/test/keys.test.ts` › "Control+Option+S opens Nerd stats from anywhere".
- A17. `host/test/backup.test.ts` › "a backup holds hobkin's own records, and leaves out working copies, artifacts, run transcripts and indexes"; › "a run's brief and report are records, and what the run left beside them is not"; › "the zip takes names as they are, empty folders, and links as links, and a restore brings them all back"; › "a file that goes away between the walk and the zip is left out, and the backup is still made"; › "a home with no records still backs up, and restoring that backup takes only the records away"; › "fifty thousand names all reach the zip"
- A18. `host/test/backup.test.ts` › "a restore puts the records back and keeps everything a backup leaves out as the home has it now"; › "every working copy stays at its path through every step of a restore"; › "what a backup leaves out stays as the home has it now, whatever the archive holds of it"
- A19. `host/test/backup.test.ts` › "a restore that fails at any one step puts the home back exactly as it was"; › "a restore that fails and cannot put things back deletes nothing, and its error says where the pieces are"; › "a restore never deletes what an unfinished one left beside the home"
- A20. check: read the tile and the restore dialog in the window. Not yet seen.
- A21. `host/test/backup.test.ts` › "hobkin's own clones and every other git checkout in the home stay out, and a tree made after the backup still works after a restore"
- A22. `host/test/backup.test.ts` › "a backup takes each SQLite store whole even when a checkpoint falls while it reads, and leaves its write-ahead log out"; › "a restore never pairs the restored store with the write-ahead log of the one hobkin has open"
- A23. `host/test/backup.test.ts` › "a name zip cannot take, and a file it cannot read, are said, and a restore leaves both where they are"; › "only hobkin's own evidence and artifact folders are left out, not the user's folders named like them"
- A24. `host/test/backup.test.ts` › "the copy a restore takes first outlives ordinary pruning, and no automatic backup follows a restore at once"; check: read the dialog.
- A25. `ui/test/settings-backup.test.ts` › "a restore waits while hobkin answers or anything runs, and says what"; `host/test/backup.test.ts` › "a restore waits while anything runs, and changes nothing" (the host's check, not yet passed by `host.ts`); › "a backups folder that is a link into the home is refused, and a restore never takes the backups with it"; check: restore in the window and see the host restart. Not yet seen.
- A26. `host/test/appearance-history.test.ts` › "a custom theme keeps its name across a restart"; › "every custom theme is kept, newest first, and a built-in theme does not throw them away"; › "renaming the theme on now changes its title at once; removing keeps the one on now"; › "a photo belongs to the theme it was chosen for"; › "a theme saved before the list existed joins it, and a damaged list never stops the theme"; › "hobkin lists the kept themes with their dates and puts one back on from the chat"; `host/test/theme-history.test.ts` (the list's rules: add, reuse, cap, wear, rename, remove, file); `host/test/state-sync.test.ts` › "the kept themes travel whole on changes and resets, and stay while a built-in theme shows"; `ui/test/theme-kept.test.ts` › "choosing Custom after a built-in theme puts the last kept theme back on, through the host"; `ui/test/settings-kept-themes.test.ts`. Seen 2026-11-14 only as a still render of the Day and night tile (normal and Edit), made with vite and QuickLook. check: in the window, pick a kept theme, rename one, remove one, restart the app, and ask hobkin for "the theme before this one". Not yet seen.

## Steps

- [x] S1 (A1). The Settings screen on the canvas, its key, its header button, and the return to the previous screen.
- [ ] S2 (A2, A5, A11). The client's own settings: theme with follow the Mac, type, and movement.
- [ ] S3 (A3, A4, A6, A7, A12). The tiles for hobkin's settings and the nerd stats on sample values, with their rules tested.
- [x] S4 (A8). Keyboard through every tile.
- [ ] S5 (A9, A10). Host: hobkin's settings as state and commands.
- [ ] S6 (A17 to A25). Backup: the rule, backup and restore in the host, and the tile. The host side is tested; the tile is not yet seen, and `host.ts` does not yet pass the host's own check that nothing runs.
- [ ] S7 (A26). Kept custom themes: the host's list and its four commands, Custom bringing back the theme shown last, and the swatches with Edit under Custom. The rules are tested and the tile is seen in a still render; not yet seen in the window.

## Open questions

- Which of hobkin's settings belong here beyond these? Work mode has more (the folder, the pull request default, reviews on finish, auto pick), and so do routines (how many run at once).
- Should the budget tile also show the subscription's own limits when Pi reports them?
