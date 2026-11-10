---
{
  "id": "025-onboarding",
  "title": "First-run setup",
  "kind": "work",
  "status": "doing",
  "depends": ["004-signin", "017-model-tiers", "020-settings"],
  "updated": "2026-11-10"
}
---
# First-run setup

## Outcome

The first time the app opens, a short animated setup covers the window before the app shows. hobkin's character says hello, says in two lines what hobkin does, helps connect a model through Pi, and proposes the first settings: hobkin's model and the four tiers on the model Pi itself starts the chosen provider on, plus theme and movement. One key accepts them. Then the setup gives way to the app as the character flies to its place by the message input. Settings can run it again. Every step works from the keyboard and by mouse.

## Decisions

- The setup is one layer over the whole window, above the frame and under the app's dialogs, so the Models window can open over it. The frame stays mounted behind it, with no keyboard and no pointer while the setup is open (`inert`). The layer is `role="dialog"`, which the frame's key map (`ui/src/app/key-map.ts`) already leaves alone, so the frame's keys never change screens behind it.
- It opens by itself on the first run. The mark lives in the app's own storage (`hobkin-client-setup`, value `seen`) and is written when the setup ends, finished or skipped. `?setup=1` in the address opens it whatever was saved, so a browser tab can show it. Run setup again, a tile in Settings, opens it on its first step.
- Five steps, in order: Welcome, What hobkin does, Connect a model, First settings, Ready. Going on from Ready ends the setup as done. Skip, at the top right, ends it from any step and applies nothing that was not applied already. There is nothing behind Welcome. Once it has ended no key moves it.
- Keys while it is open: Enter goes on, unless a field or a button has the keyboard, which then uses it. Escape goes back, and stops a sign-in that is under way first. Left goes back, unless the control uses Left and Right itself (a choice, a field). Up and Down move between the step's controls. Tab keeps its usual meaning, as in any dialog (`019-keyboard`). Keys held with Command, Control or Option are not the setup's. Every step also has its buttons for the mouse: Back and the step's own, which takes the keyboard as the step arrives.
- The keyboard never rests on the page behind the setup, where the frame's keys would take it. When the control that had it goes away (Sign in as a sign-in starts, the Models window closing) it goes back to the control it was last on, or to the step's own button.
- Connect a model is the chat lane's `ConnectScreen` (`004-signin`), as it is: providers that sign in first with the subscriptions leading, then API keys, then cloud credentials, each marked connected or not. A provider Pi already reaches has no sign-in, a sign-in runs Pi's own, and an API key shows the variable and the Keychain route, never a field. It runs with `face={false}`, since the setup's character is on screen.
- On the two steps that fill the window, Connect a model and First settings, the content scrolls in a box that ends above the hills, and the hills sink further there, so no text ever sits on them.
- First settings proposes from one connected provider, chosen among the connected ones: the last one connected during the setup, or else the first subscription, or else the first. The proposal follows Pi. Pi keeps one default model per provider (`defaultModelPerProvider`, pi-coding-agent `dist/core/model-resolver.js`), switches to it after a sign-in (`dist/modes/interactive/interactive-mode.js`) and starts it at medium (`DEFAULT_THINKING_LEVEL`, `dist/core/defaults.js`). hobkin starts on that model at medium, and the tiers on the same model at low (fast), medium (mid), high (high) and the most the model allows (max), each moved to the nearest level the model has. The levels are the tiers' own (`EFFORTS`, off to xhigh, as hobkin's main model takes them), so max is xhigh at most, and a model that cannot think runs every tier with thinking off. With no default for the provider, or one Pi cannot use now, they start on the first model Pi lists that thinks, as Pi itself falls back to the first model it lists (`findInitialModel`). The rule is `shared/tiers/presets.ts`, and it takes the models from `choicesFromPi`.
- The host sends Pi's default with each provider (`ProviderAccess.defaultModel` in the models slice, from Pi's own `defaultModelPerProvider`, and only when Pi's catalog has that model). The client keeps no copy of Pi's table.
- The proposal is said in plain words. Each tier's thinking changes with Left and Right where it is shown. Models change in the Models window (`017-model-tiers`), which opens over the setup on the proposal. Theme and movement change at once, as they do in Settings.
- Accepting writes the tiers through the tiers store (`ui/src/features/tiers/store.ts`), which keeps them in the app's storage until the host reads and writes hobkin's own (`017-model-tiers`, S3). It also chooses hobkin's own model through hobkin's settings (`selectMainModel`, the `models.select` command), which the user's Enter on First settings stands for. Ready says how that went: the model hobkin talks on now, or the host's reason in its own words when it keeps the one it has, as the scripted host always does.
- Motion: each step crosses the window and settles on a spring, sideways in the direction of travel, while the one leaving falls back and fades, and its pieces land one after another. The character stays on screen from the first step to the last and changes mood with each (hello, thinking, listening, working, celebrating), hopping as the steps change. It looks for something while a sign-in runs and cheers when a provider connects. Hills along the bottom move at different speeds as the steps go by, and the sun or moon follows the theme. At the end the character rises a little and dives to the avatar by the message input while the setup fades away around it, and the keyboard lands in the message input. Run again from Settings, it leaves that seat and flies up to lead the setup.
- Movement set to still, or the Mac asking for less while movement follows the Mac, turns all of it into short fades, and the character holds still. The setup says so itself: Motion's reduced motion leaves a whole `transform` string alone (motion-dom 14.10.1 reduces only its own positional values, `keys-position.mjs`), and every movement here is one.

## Out of scope

- Writing the tiers into hobkin's `config.json` (`017-model-tiers`, S3).
- A lighter model for fast or a heavier one for max. Pi's models slice says nothing about a model's weight.
- Steps for routines, projects or integrations.
- Showing the setup again when a later version of it changes.

## Acceptance

- A1. On a first run the setup covers the window before the app shows. Once it has ended, finished or skipped, a reload opens the app without it.
- A2. With `?setup=1` in the address, a browser tab shows the setup whatever was saved.
- A3. The steps come in order: Welcome, What hobkin does, Connect a model, First settings, Ready. Enter or the step's button goes on, and going on from Ready ends the setup.
- A4. Escape or Back goes one step back, and Welcome has nothing behind it.
- A5. Skip ends the setup from any step.
- A6. Enter in a field or on a button is that control's, not the setup's.
- A7. Escape during a sign-in stops the sign-in and stays on Connect a model.
- A8. Left in a choice or a field changes it instead of going back.
- A9. Up and Down move between the step's controls.
- A10. While the setup is open, the frame's keys do nothing behind it: Tab, Command with a number and Command+comma leave the screen under it as it was.
- A11. Connect a model lists Pi's providers with subscriptions first, each marked connected or not. A provider Pi already reaches shows connected with no sign-in, Sign in starts Pi's sign-in, and an API key shows what to set, with no field to type it in.
- A12. For a connected provider, First settings proposes hobkin and the four tiers on Pi's default model for that provider: medium for hobkin, and low, medium, high and the most the model allows (xhigh at most) for fast, mid, high and max.
- A13. A proposed thinking level the model does not have moves to the nearest one it has.
- A14. With no Pi default that Pi can use, the proposal starts on the first model Pi lists that thinks.
- ~~A15. The copy of Pi's default models in the client matches the Pi that hobkin runs.~~ Retired on 2026-11-10: the host sends Pi's default with each provider, so the client keeps no copy to match. A12 covers the default.
- A16. First settings says the proposal in plain words. Left and Right change a tier's thinking, Change models opens the Models window on the proposal, theme and movement change at once, and Enter accepts all. Settings › Models then shows the accepted values, also after a reload.
- A17. The character stays on screen through every step and changes mood, each step arrives and leaves with travel, and on Ready the setup gives way to the app as the character flies to the avatar by the message input. The keyboard is then in the message input.
- A18. With Movement set to still, the steps and the hand-off fade without travel and the character holds still.
- A19. Settings has Run setup again, which opens the setup on its first step over the app.
- A20. Every step reads well in light and in dark.
- A21. Enter on First settings also chooses hobkin's own model through hobkin's settings. Ready then says the model hobkin talks on, or, when the host keeps the one it has, the host's reason in plain words.

## Proof

- A1. `ui/test/onboarding.test.ts` › "the setup shows on the first run, and not once it has been seen"
- A2. `ui/test/onboarding.test.ts` › "?setup=1 in the address shows it whatever was saved"
- A3. `ui/test/onboarding.test.ts` › "the steps come in order, and going on from the last one ends the setup as done"
- A4. `ui/test/onboarding.test.ts` › "back goes one step back, and the first step has nothing behind it"
- A5. `ui/test/onboarding.test.ts` › "skip ends the setup from any step, as skipped"
- A6. `ui/test/onboarding.test.ts` › "Enter goes on, except in a field or on a button, which use it themselves"
- A7. `ui/test/onboarding.test.ts` › "Escape goes back, and cancels a sign-in that is under way first"
- A8. `ui/test/onboarding.test.ts` › "Left goes back unless the control uses Left and Right itself"
- A9. `ui/test/onboarding.test.ts` › "Up and Down move between the controls, except in a list that walks itself"
- A10. check: open the setup over a screen, press Tab, Command+2 and Command+comma, then read the screen under it (seen 2026-11-10 in a browser tab, with the setup mounted by hand before the frame mounts it: the screen under it stayed as it was and Tab stayed inside the setup).
- A11. check: on the scripted development host, OpenAI shows connected with no sign-in, Anthropic's Sign in starts the scripted sign-in, and How under an API key shows the variable and the Keychain command (seen 2026-11-10: the list, the marks, and How under OpenRouter showing `OPENROUTER_API_KEY` and the Keychain route. The sign-in was not started on the shared development host; a sign-in state set in the tab showed Pi's panel, and Escape kept the setup on this step).
- A12. `shared/test/tiers-presets.test.ts` › "the tiers start on Pi's default model for the provider, each thinking a little more"
- A13. `shared/test/tiers-presets.test.ts` › "each tier's thinking is moved to what the model allows, and max takes the most it allows"
- A14. `shared/test/tiers-presets.test.ts` › "with no default for the provider, or one Pi cannot use now, the first model Pi lists that thinks"
- ~~A15. `shared/test/tiers-presets.test.ts` › "the copy of Pi's default models matches the Pi that hobkin runs"~~ Retired with A15.
- A16. check: change a tier's thinking with the arrows, open Change models, accept with Enter, then open Settings › Models before and after a reload (seen 2026-11-10: Max moved to xhigh with Left, the Models window opened on the proposal and its change came back, and after a reload the Models tile listed the accepted tiers, by id rather than name).
- A17. check: walk every step forward and back with the keyboard alone, then finish and watch the character land by the message input (seen 2026-11-10: sampled each frame, the character landed on the face by the input, 52 pixels at its center, in about 0.8 seconds, and the keyboard was in the message input).
- A18. check: set Movement to still, walk the steps, finish (seen 2026-11-10: the arriving step kept its place and faded in, the character changed seats at once, and the hand-off was a fade in place).
- A19. check: press Run setup again in Settings (seen 2026-11-10: the setup opened on Welcome over Settings, the character flying up from the input).
- A20. check: walk the steps in light and in dark (seen 2026-11-10: Welcome, First settings and Ready in dark, every step in light).
- A21. check: accept First settings on the scripted development host (seen 2026-11-10: Ready said the scripted host keeps its model, in the host's words).

## Steps

- [x] S1 (A3, A4, A5). The step machine.
- [x] S2 (A6, A7, A8, A9). The setup's key map.
- [x] S3 (A1, A2). The first-run mark and `?setup=1`.
- [x] S4 (A12, A13, A14). Tiers proposed from Pi's default model, as the host sends it with each provider.
- [x] S5 (A10, A11, A16, A17, A18, A20, A21). The setup layer and its five steps.
- [x] S6 (A19). Run setup again in Settings.
- [x] S7 (A1, A10, A17). The frame mounts the setup and stays mounted behind it, then each check is seen again in the window. Mounted in the frame on 2026-11-10; walked in a browser tab with real keys from Welcome to the hand-off: the tiers were saved, the scripted host refused the main model with its reason, and the keyboard landed in the message input. The Mac window shows it on its next load.

## Open questions

- A lighter model for fast and a heavier one for max would need a measure of weight. Pi's catalog has a cost per token for each model, which the models slice does not carry. With it, fast could take the lightest model of the default's line.
- Should the mark live in hobkin's home (`014-continuity`), so a second window profile or a new Mac does not show the setup again?
- Should Skip still apply the proposal for a provider that was already connected, so a skipped setup also gets good defaults?
