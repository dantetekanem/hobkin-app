---
{
  "id": "019-keyboard",
  "title": "Everything from the keyboard",
  "kind": "work",
  "status": "doing",
  "depends": ["001-foundation"],
  "updated": "2026-11-25"
}
---
# Everything from the keyboard

## Outcome

The whole app can be used without touching the mouse. The message input is home. From there, keys walk the canvas menu, enter the agents, open the lists and step into the canvas, and Escape always leads back. The keys follow what the user already does in Pi and in hobkin's terminal app. The mouse keeps working for everything.

## Decisions

- The message input is the home position. The app opens with the keyboard there, and Escape walks one step back toward it from anywhere.
- One map, owned by the frame (`ui/src/app/keys.ts`). A screen or panel that uses a key itself calls `preventDefault`, and the frame then leaves that key alone.

  | Where | Keys | What they do |
  | --- | --- | --- |
  | Message input | Enter, Shift+Enter | Send, new line |
  | Frame, when no overlay or completion list owns Tab | Tab, Shift+Tab | Next and previous screen in the canvas menu, wrapping at the ends. Focus moves into the screen being opened. The agents list and an agent's input hold Tab instead. Left and Right never change the screen |
  | Message input, empty | Down | Into the agents list, as in pi-extended-teams |
  | Message input, empty | Up | Earlier messages the user sent |
  | Message input | Ctrl+Option+P | Full prompt focus, as in pi-prompt |
  | Anywhere | Ctrl+Option+S | Nerd stats, over any screen. The same key closes it |
  | Message input, after a slash | Tab, Up, Down, Enter, Escape | Complete the command, move through the list, run it, close the list. Tab does not change the screen while this list is open |
  | Anywhere | Cmd+1 to Cmd+9 | Open that screen and move the keyboard into the canvas |
  | Anywhere | Cmd+J | Move the keyboard into the canvas |
  | Anywhere | Cmd+L | Back to the message input |
  | Anywhere | Cmd+P, Cmd+Y | Projects, History |
  | Anywhere | Cmd+comma, Cmd+I | Settings, Integrations. The same key closes them |
  | Anywhere | Cmd+K | The command list: every command by name, with its keys |
  | Anywhere, no dialog open | Cmd+N | The New hobkin sheet: a durable hobkin the user talks to directly (`034-durable-hobkins`) |
  | Anywhere | Escape | One step back toward the message input |
  | Agents list | Down, Up | Move. The canvas follows the selection |
  | Agents list | Enter | Open the agent with the keyboard in its input |
  | Agent's input | Enter, Escape | Send to the agent, go back onto it in the list |
  | An agent's screen, Hobkin's mind | Control+O | Open every block of the steps, and close them all again |
  | An agent's page, a durable hobkin's or a run's, its talk box, or its row in the agents list | Control+X | End the agent: the first press asks, as End does, and a second ends a durable hobkin or force stops a run (`034-durable-hobkins`) |
  | Agents list | `i`, `x` | Interrupt the agent's running tool command, stop the agent |
  | Agents list | Escape, or Up from the first | Back to the input. The canvas returns to what it showed |
  | Veil open | Down, Up, Left, Right | Move through the list, switch between the two lists, wherever the keyboard is |
  | Veil open | Enter, Escape | Choose, close |
  | Inside a screen | Up, Down | Move between its controls |
  | Inside a screen | Left, Right | Change the control that has the keyboard |
  | Canvas | The open screen's own keys | For example Left and Right through a review's steps |

- Tab never moves between controls, except inside a dialog such as the tiers lightbox, where it keeps its usual meaning. One more exception: an input that is showing completions owns its keys, so after a slash in the message input Tab completes the command. Controls are walked the terminal's way instead: Up and Down move, Left and Right change, Enter presses. A screen marks its controls and uses `ui/src/app/stops.ts`.
- Choosing a screen from the menu, Spotlight, or a review opener takes the keyboard into that screen, even while the user was typing. Loading or refreshing its data does not take the keyboard back after the user has moved away. History and theme buttons keep the keyboard where it was.
- The veil's selected row is state, not focus. Its keys therefore work whether it was opened by key or by click.
- A line under the chat names the keys that matter where the keyboard is now.
- The keyboard position is always visible: a filled row, a ring, or the caret.
- Keys are commands from the registry of `013-hobkin-access`, so hobkin can press them too and the command list can show them.
- Control+X is the way out of an agent's page, and it always asks first (the user, 2026-11-13). It is End on every agent's page, which ends a durable hobkin and force stops a run, and the key and End share one ask, so they confirm each other. This replaces Force Stop on a run's page (2026-11-25, the user: "i want to keep ^X on both, actually, the UI of durable is much better, that should be the only UI", then "and just "End" is better"). hobkin records the stop as the user's, Chat shows it in one line, and the main agent reads it with the user's next message. Only a job started with a wake gets a turn of its own for it. A durable hobkin's turn is not told, as before.

## Out of scope

- Changing the keys in a settings screen.
- Vim-style modes.

## Acceptance

- A1. The app opens with the keyboard in the message input.
- A2. When the frame owns Tab, including from the menu after a click, the veil and the canvas (but not the agents list or an agent's input), Tab moves to the next screen in the menu and Shift+Tab to the previous one, wrapping at the ends and moving focus into the screen being opened. Dialogs, menus and completion lists keep their existing Tab handling.
- ~~A3. With an empty message, Right and Left change the screen as Tab does.~~ Retired on 2026-11-09: the user wants only Tab and Shift+Tab to change the screen. See A12.
- A4. With an empty message, Down moves into the agents list. With text, it moves the caret.
- A5. Cmd+1 to Cmd+9 open the screen at that place in the menu and move the keyboard into the canvas. Cmd+J moves into the canvas without changing the screen. Cmd+L returns to the message input.
- A6. Cmd+P opens the veil on Projects and Cmd+Y on History, with the first row selected. With the veil open, however it was opened and wherever the keyboard is, Down and Up move the selection, Left and Right switch lists, Enter chooses, and Escape closes and returns to the input.
- A7. From any place in the frame, pressing Escape enough times ends in the message input, and never closes the app.
- A8. A key that a screen uses, such as Escape closing a review's code panel, does that and does not also trigger the frame's action.
- A9. Every action that has a button can be done with keys alone. A check lists the commands that have neither a key nor a place in the command list, and the list is empty.
- A10. The element holding the keyboard is visibly marked in both themes.
- A11. Cmd+K opens the command list. Typing filters it, Enter runs the chosen command, and each row shows the command's keys.
- A12. Left and Right in the message input only move the caret, with or without text. They never change the screen.
- A13. Inside a canvas screen, Up and Down move between its controls in reading order, and Left and Right change the control that has the keyboard.
- A14. Choosing a screen from the menu, Spotlight, Settings, or a review opener moves the keyboard into it. Reentering the current screen does the same. Data loading and refreshes do not steal typing focus. History and theme buttons leave the keyboard where it was.
- A15. Tab and Shift+Tab never move between agents. In the agents list, or in the input of an agent being talked to, Tab does nothing and only Up and Down move. Back in the message input, Tab walks the menu again, counting from the screen that was under the agent.
- A16. Cmd+G opens the question of the next agent that waits for the user in the question sheet (022), the same sheet Action Items uses: its choices, the one it recommends, and room to type. With nobody waiting the key is left alone. Cmd+U stays the message input's (attach).
- A17. An Escape that nothing used leaves a screen that is open only for now, even from the message input: a review returns to the screen that opened it, with the keyboard there; Integrations returns to Settings, and Settings to the screen under it. Editors, completion lists and overlays get Escape first. On a menu screen Escape takes the keyboard home.
- A18. Cmd+R reloads the window from anywhere, also from a dialog, and the app reopens on the screen it showed.
- A19. Cmd+N opens the New hobkin sheet from any screen and any zone, and does nothing while a dialog or a screen's own panel has the keyboard.
- A20. While an agent's page is on screen, a durable hobkin's or a run's, with the keyboard in the page, its talk box or the agents list, Control+X asks in place to end it, as a click on End does, and a second press ends it: a durable hobkin ends, a run is force stopped (A23). The key and End share one ask, so either confirms the other, and Escape takes it back. It does nothing while a dialog is open, from the message input, or on any other screen (2026-11-25, one End for every agent).
- A21. Control+Option+S opens Nerd stats from any screen and any zone, matched by where S sits whatever character it types, and with the same guard as Control+Option+P: a dialog over the window keeps it. While the panel is open the same key closes it.
- A22. A key that opens something closes it again, putting the keyboard back where it was: Command+Y closes History, Command+K closes the spotlight, Command+N the New hobkin sheet, Control+Option+P the prompt editor with its draft kept, and Control+Option+S Nerd stats. Command+J, Command+comma and Command+I already did. Every other key inside a dialog stays the dialog's own.
- A23. On a run's page (a work agent, a delegated job, a routine run), End's second press, by click or Control+X, force stops the run. End is off and the key does nothing once the run has finished or can no longer be forced, and nothing while it is being forced. End on a durable hobkin's page ends the hobkin itself, never only its turn (2026-11-25, replacing the run's Force Stop question).
- A24. ⌃X shows on End and on End it on every agent's page, and in the keys list. No control says Force Stop (2026-11-25).

## Proof

- A1. check: reload the app and type. The text lands in the message input.
- A2. `ui/test/keys.test.ts` › "tab walks the menu and wraps", "tab changes the screen from anywhere, with or without text in the message", and "tab from inside the canvas keeps the keyboard in the canvas" assert navigation and canvas-focus handoff. One-shot Lightpanda against `http://localhost:5187/` verified that Tab from the message input opened Routines, prevented the browser default, and left focus inside the new screen; `*:5188/*` and HTTPS requests were blocked.
- A4. `ui/test/keys.test.ts` › "down enters the agents only when the message is empty"
- A5. `ui/test/keys.test.ts` › "command keys open a screen, enter the canvas and return home"
- A6. `ui/test/keys.test.ts` › "with the veil open, the arrows walk its list, enter chooses and escape closes, wherever the keyboard is"
- A7. check: from the canvas, the veil and the agents list, press Escape until the input has the keyboard.
- A8. `ui/test/keys.test.ts` › "a prevented key is left alone"
- A9. `shared/test/commands.test.ts` › "every command has a key or is in the command list"
- A10. check: walk every zone with the keyboard in light and dark.
- A11. `ui/test/command-list.test.ts` › "filters, runs, and shows keys"
- A12. `ui/test/keys.test.ts` › "left and right never change the screen"
- A13. check: open Settings and walk it with Down and Up, changing each control with Left and Right.
- A14. `ui/test/screen-focus.test.ts` covers explicit entry, delayed focus handoff, and typing during refresh. One-shot Lightpanda on the sample UI verified menu entry, Spotlight entry, Settings, and the Actions review button with `document.activeElement`. Delaying review data verified that resumed typing keeps focus when loading finishes; the real host was blocked.
- A15. `ui/test/keys.test.ts` › "among the agents tab is held, and it is the menu's again once the keyboard has left them"
- A16. `ui/test/keys.test.ts` › "command g goes to an agent that is waiting for the user, and is left alone when none is"; `ui/test/asking.test.ts`
- A17. `ui/test/keys.test.ts` › "escape that nothing used leaves a screen that is open only for now"; `ui/test/overlays.test.ts` covers review origins and nested return paths. One-shot Lightpanda verified Escape from chat returning Review to Action Items with canvas focus.
- A18. `ui/test/keys.test.ts` › "command r reloads the window from anywhere, also from a dialog"
- A19. `ui/test/keys.test.ts` › "Command+N opens the New hobkin sheet"
- A20. `ui/test/keys.test.ts` › "Control+X is End on every agent page: once it asks, twice it ends a durable hobkin or force stops a run"
- A21. `ui/test/keys.test.ts` › "Control+Option+S opens Nerd stats from anywhere"; check: press it from Home, from Settings and from an agent, then press it again inside the panel.
- A22. `ui/test/keys.test.ts` › "a key that opens something closes it again"; check: press each key twice and see where the keyboard lands.
- A23. `ui/test/agent-talk.test.ts` › "End is one control for every agent: a durable hobkin the host has is ended, and a run is force stopped while it can be"; check: on a running agent's page press Control+X from the page and from its talk box, see End ask, press Escape, then press Control+X twice and see the run end.
- A24. `ui/test/key-list.test.ts` › "each frame key in the list resolves in the key map"; check: a run's page and a durable hobkin's page show ⌃X on End and on End it (still renders, dark and light, 2026-11-25), then the live window.

## Steps

- [x] S1 (A1, A2, A4, A5, A7, A12). The frame's map: input keys, command keys, Escape home. The mapping is a pure function from a key and a focus zone to a command, with tests.
- [x] S2 (A6). Keys inside the veil.
- [ ] S3 (A8). The contract for screens that use keys, applied to the review and the agent canvas.
- [x] S6 (A13, A14). Walking a screen's controls with Up and Down, and deliberate screen entries that take the keyboard.
- [ ] S4 (A10). Visible keyboard position everywhere.
- [ ] S5 (A9, A11). The command list on Cmd+K, fed by the command registry.
- [x] S7 (A15, A16, A17, A18). Agents outside the Tab walk, the jump to a waiting agent, Escape one step out of an open-for-now screen, and reload.
- [ ] S8 (A20, A23, A24). Control+X as End on every agent's page, 2026-11-25: one store for the ask (`ui/src/features/work/end-agent.ts`), what End ends as a pure function (`endTarget` in `ui/src/features/work/talk.ts`), the key map's `end-agent`, End on the one page's header and the keys list: 8a8ad21; the run's Force Stop and `forceStopStep` went in 28caebf. Left: the live checks.

## Open questions

- The keys above are a first proposal built from hobkin's terminal app and pi-extended-teams. The user's own Pi setup may use different ones for some actions. Where it does, those win.
- Cmd+P and Cmd+Y are the browser's print and history keys. Inside the app they are free, but in a browser tab during development the browser may claim them when the page does not hold the keyboard.
