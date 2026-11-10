# Notes

## 2026-11-09

- The map is a pure function in `ui/src/app/key-map.ts`. `ui/src/app/keys.ts` reads the page (where the keyboard is, whether the message is empty, which screens the menu shows) and carries out what the map returns.
- The user first had Left and Right on an empty message change the screen, as hobkin's terminal app does, then asked for only Tab and Shift+Tab. The arrows are never taken now.
- Escape is read in the bubble phase so that whatever holds the keyboard can use it first and call `preventDefault`.
- The veil and the agents list are the frame's own, so the frame's command keys keep working inside them. Other dialogs, menus and lists keep every key.

### Evidence

- `node --test ui/test/keys.test.ts`: 10 tests pass. They cover A2, A4, A5, A8 and A12.
- In the browser, with simulated key presses: the app opened with the keyboard in the message input (A1). Tab went from Work to Routines. Right left it on Routines. Down entered the agents and Escape restored Routines. Cmd+3 opened Reports with the keyboard in the canvas, and Escape returned to the input. Cmd+P opened the veil on its first row, Tab inside the veil was not taken by the frame, and Escape closed it with the keyboard back in the input (A6, A7).
- Simulated key presses do not prove that the browser or the Tauri window delivers Cmd+P and Cmd+Y to the page. That needs real key presses in the app window.
