---
{
  "id": "025-onboarding",
  "title": "First-run setup",
  "kind": "work",
  "status": "doing",
  "depends": ["004-signin", "017-model-tiers", "020-settings", "031-home"],
  "updated": "2026-11-13"
}
---
# First-run setup

## Outcome

The first time the app opens, a story covers the window before the app shows. The window holds empty for a moment, then a world builds itself: the sky comes, by day in the light theme and by night in the dark one, and mountains rise. hobkin comes up from behind them, hops to the middle of the window in four or five hops, and says hello in speech bubbles, as a character in a game talks. It asks whose computer this is, the user's name and, if they want to give it, their email. It installs Pi and the Pi packages its agents use when they are missing, finds an account Pi already reaches or signs in to the OpenAI subscription, and offers five more questions to build the first routines from. It says where the settings are and hands over to the app, where a short tour says what each part does. Settings can run the setup and the tour again. Every step works from the keyboard and by mouse.

This replaces the five-step setup of 2026-11-10 (Welcome, What hobkin does, Connect a model, First settings, Ready) on the user's word of 2026-11-13.

## Decisions

- The setup is one layer over the whole window, above the frame and under the app's dialogs. The frame stays mounted behind it, with no keyboard and no pointer while the setup is open (`inert`). The layer is `role="dialog"`, which the frame's key map (`ui/src/app/key-map.ts`) already leaves alone, so the frame's keys never change screens behind it.
- It opens by itself on the first run. The mark lives in the app's own storage (`hobkin-client-setup`, value `seen`) and is written when the setup ends, told to the end or skipped. `?setup=1` in the address opens it whatever was saved, so a browser tab can show it. Run setup again, in Settings, opens it from its start.
- The opening, in order: the window's own background for 1.4 seconds (0.45 when run again), so nothing starts the instant the app does; the sky comes, with the sun rising in light, or the moon rising and the stars coming out one after another in dark; a short rest; the mountains rise from below the window, the far ridge first, then the hill in front; and as the last ridge settles hobkin rises behind a middle ridge at about 72% across until its eyes show, looks around, and hops to the middle: five hops in a window at least 1100 wide and four in a narrower one, each landing on a nearer ridge and bigger than the last, passing in front of a ridge at the top of each hop. The last hop lands on the crest of the front hill, in the middle of the window. The land is `World.tsx`, and where hobkin hides, hops and stands is `world-geometry.ts`, pure and tested.
- A key or a click before hobkin has landed skips the wait: the world is there at once and hobkin jumps to its seat.
- The story is beats, and a beat is one or more speech bubbles above hobkin's head (`story.ts`). A bubble's words arrive one after another. Enter, Space, Right or a click anywhere goes on: first to the whole bubble, when its words are still arriving, then to the next one. Escape or Left goes one bubble back, then to the beat before. A beat's question comes with its last bubble and holds the story until it is answered. Back never passes an install or a sign-in that was done.
- The beats, in order: hello; whose computer this is, personal or work; thanks; the user's name; the name said back; the email, which can be skipped; that a subscription is needed, that hobkin runs under Pi and supports Claude, and that it costs nothing; Pi, only when something of it is missing; the account; go in now or five more questions; the questions; where the settings are (Command+comma); and the walk to the app. The words are the user's own of 2026-11-13, with their grammar set right (`all lowercase`, `many more questions`, `an existing subscription`, `a user`, `at any time`).
- A choice between two things is two round bubbles, one each side of hobkin, floating at their own pace. They balance: the one the pointer nears grows a little, at most 7%, and the other gives up the same, on a spring (`balance.ts`). The keyboard landing on one does the same. Left and Right reach for them, Enter picks, and the picked one flies into hobkin.
- A typed answer goes in one field at the bottom of the window, in the middle. Enter sends it. An answer that may be left out has Skip. A question with common answers shows them to pick from, and picking one adds it to what is written.
- Whose computer this is, the name and the email are kept in hobkin's own profile (`profile.json` in its home, through the host's `profile.set`), which hobkin puts in front of every agent's directions. The email question says so: the model's provider sees them too. A name is needed. An email is held to hobkin's own rule for one. A browser tab on sample data keeps nothing.
- Pi. The host says what is on this Mac (`setup.pi`): whether `pi` is installed, its version against the one hobkin runs on, whether npm is there to install it, and which of the packages hobkin's agents use Pi has (`shared/setup/pi-packages.ts`). Nothing is said about Pi when all of it is there, or when no host has answered. Otherwise hobkin offers to install what is missing: Pi first (`setup.install-pi`, the pinned version, with npm's scripts off), then each package by its name (`setup.install-package`), one at a time, each shown as it goes. A failure says the program's own last lines and can be tried again. Without npm the window gives the command to run and looks again. Not now puts it off, and hobkin says its routines and agents cannot run until Pi is here. Installs run only on the user's press, never in the scripted development host, and hobkin's own `client` tool cannot run them.
- The packages are the six the user named on 2026-11-13: `pi-coder`, `pi-extended-teams`, `pi-agentic-search`, `pi-ask-user`, `pi-solid-tasks` and `pi-search-hub`. The search package comes from the user's fork, on the branch that holds its fix for Pi 1.5 (`git:github.com/dantetekanem/pi-search-hub@fix/openai-codex-model-runtime`, pushed on 2026-11-13), since the published one's OpenAI search imports what Pi 1.5 no longer has. A package may need a setting: once it is installed, the host writes that file into Pi's own folder, only when no such file is there, and never with a key in it. The search package's setting makes it search through the OpenAI subscription (`extensions/search.json`, default backend `openai-codex`), as the user has it, without the backends that need a key. Only the app's own host names Pi's folder, so a host started for a check writes nothing there.
- The account. A provider Pi already reaches is found and named. With none, hobkin offers the one sign-in the setup has for now, the OpenAI subscription (`accounts.ts` finds it in Pi's list), which runs Pi's own sign-in (`004-signin`): the browser opens, and what Pi says and asks shows in the window. A provider that turns connected ends it. Not now puts it off, and the app's own Connect a model screen asks again. With Claude Code installed and signed in, hobkin says its agents can run on it and that Settings turns that on. It turns nothing on.
- The questions are five, by whose computer this is (`questions.ts`). Personal: where the projects live, which ones hobkin may work on by itself, how work is proven before it is called done, what to keep an eye on, and where to read for context. Work: what the team builds and the user's part, where the work is tracked, how a change ships, which tools to connect, and what to watch every day. Each can be skipped. They are only offered once a model is connected, since they are handed to hobkin. When the setup ends, the answered ones go to hobkin as one message in the chat, which asks it to propose two or three first routines and to ask before it creates or connects anything. Nothing answered, nothing sent.
- There is no first-settings step. hobkin starts on its own defaults for the model and the tiers (`017-model-tiers`), and the story says the settings are one key away.
- The hand-off: hobkin rises a little and dives to the avatar by the message input while the setup fades away around it, and the land sinks. Told to the end, the tour then opens on Home (`ui/src/features/tour`): it dims the app, cuts a hole around one part at a time, and says in a small card what the part does: the chat, why hobkin knows things, its mind, Home, Reports, Routines, Action Items, Work, Settings, and search. Enter, Space or Right goes on, Left goes back, Escape leaves, and the keyboard lands in the message input. A skipped setup has no tour.
- Movement set to still, or the Mac asking for less while movement follows the Mac, turns all of it into short fades: the world is there at once, hobkin stands on its seat, a bubble's words are simply there, the choices hold their size, and the hand-off and the tour's hole change place without travel. The setup says so itself: Motion's reduced motion leaves a whole `transform` string alone (motion-dom 14.10.1 reduces only its own positional values, `keys-position.mjs`), and every movement here is one.

## Out of scope

- Sound.
- Choosing models or tiers in the setup, and writing the tiers into hobkin's `config.json` (`017-model-tiers`, S3).
- Any sign-in in the setup but the OpenAI subscription. The app's Connect a model screen has the rest.
- Turning Claude Code on for hobkin's agents (`033-claude-code-agents`).
- Creating routines in the setup. hobkin proposes them in the chat and asks first.
- A folder picker for the projects folder. It is typed.
- Showing the setup again when a later version of it changes.

## Acceptance

- A1. On a first run the setup covers the window before the app shows. Once it has ended, told to the end or skipped, a reload opens the app without it.
- A2. With `?setup=1` in the address, a browser tab shows the setup whatever was saved.
- ~~A3. The steps come in order: Welcome, What hobkin does, Connect a model, First settings, Ready. Enter or the step's button goes on, and going on from Ready ends the setup.~~ Retired on 2026-11-13: the five steps gave way to the story. A27 covers the order.
- ~~A4. Escape or Back goes one step back, and Welcome has nothing behind it.~~ Retired on 2026-11-13 with the steps. A29 covers going back.
- A5. Skip setup ends the setup from anywhere in the story.
- ~~A6. Enter in a field or on a button is that control's, not the setup's.~~ Retired on 2026-11-13 with the old key map. A30 covers it.
- ~~A7. Escape during a sign-in stops the sign-in and stays on Connect a model.~~ Retired on 2026-11-13 with the old key map. A30 covers it.
- ~~A8. Left in a choice or a field changes it instead of going back.~~ Retired on 2026-11-13 with the old key map. A30 and A31 cover it.
- ~~A9. Up and Down move between the step's controls.~~ Retired on 2026-11-13: a beat has one control, so there is nothing to move between.
- A10. While the setup is open, the frame's keys do nothing behind it: Tab, Command with a number and Command+comma leave the screen under it as it was.
- ~~A11. Connect a model lists Pi's providers with subscriptions first, each marked connected or not.~~ Retired on 2026-11-13: the setup offers one sign-in, and the app's own screen (`004-signin`) keeps the list. A36 and A37 cover the account.
- ~~A12. For a connected provider, First settings proposes hobkin and the four tiers on Pi's default model for that provider.~~ Retired on 2026-11-13 with the first-settings step.
- ~~A13. A proposed thinking level the model does not have moves to the nearest one it has.~~ Retired on 2026-11-13 with the first-settings step.
- ~~A14. With no Pi default that Pi can use, the proposal starts on the first model Pi lists that thinks.~~ Retired on 2026-11-13 with the first-settings step.
- ~~A15. The copy of Pi's default models in the client matches the Pi that hobkin runs.~~ Retired on 2026-11-10: the host sends Pi's default with each provider, so the client keeps no copy to match.
- ~~A16. First settings says the proposal in plain words, and Enter accepts all.~~ Retired on 2026-11-13 with the first-settings step.
- ~~A17. The character stays on screen through every step and changes mood, each step arrives and leaves with travel, and on Ready the setup gives way to the app as the character flies to the avatar by the message input.~~ Retired on 2026-11-13 with the steps. A26 and A41 cover the character.
- A18. With Movement set to still, nothing travels: the world and hobkin are there at once, bubbles and questions fade in, and the hand-off is a fade.
- A19. Settings has Run setup again, which opens the setup from its start over the app, and Take the tour, which opens the tour alone.
- A20. Every part reads well in light and in dark: by day with the sun in light, by night with the moon and stars in dark.
- ~~A21. Enter on First settings also chooses hobkin's own model through hobkin's settings.~~ Retired on 2026-11-13 with the first-settings step.
- A22. The opening comes in order, after a wait in which the window is empty: the sky, then the mountains from the far ridge to the front hill, then hobkin.
- A23. hobkin hides wholly behind a middle ridge at about 72% across, then shows its eyes over the crest and no more.
- A24. hobkin reaches the middle in five hops in a window at least 1100 wide and four in a narrower one. Each hop goes toward the middle, lands with its foot on a ridge's crest, is no smaller than the one before, and never puts hobkin behind something it was in front of. The last lands on the hill's crest in the middle of the window, at full size.
- A25. A key or a click before hobkin has landed brings the world and hobkin at once.
- A26. hobkin stays on screen from its first hop to the hand-off and changes face with each beat.
- A27. The beats come in order: hello, whose computer, thanks, name, the name said back, email, the subscription, Pi when something of it is missing, the account, go in or five questions, the questions, the settings, the walk to the app. Going on from the last one ends the setup as done.
- A28. A question holds the story until it is answered, and a bubble that only asks to go on is passed by going on.
- A29. Back goes one bubble back, then to the last bubble of the beat before. The first bubble has nothing behind it, and nothing before an install or a sign-in that was done can be gone back to.
- A30. Enter, Space and Right go on, and Escape and Left go back. A field keeps its Enter, its Space and its arrows, a button keeps its Enter and Space, Escape during a sign-in stops the sign-in first, and nothing goes back during an install. Keys held with Command, Control or Option, and Tab, are not the story's.
- A31. With two choices up, Left and Right reach for them. The one the pointer nears grows as the other shrinks by the same amount, by 7% at most, and both rest when the pointer is far from both or between them.
- A32. A name is needed, an email can be left out, and each is held to what hobkin's profile keeps.
- A33. The computer, the name and the email are saved in hobkin's profile, and a save hobkin refuses is said with its reason. The name is said back: "Hi, Ada!".
- A34. Pi is brought up only when Pi, the version hobkin runs on, or one of its packages is missing, and hobkin's words follow which. With no host answering, it is not brought up.
- A35. Install installs Pi, then each missing package by its name, one at a time, and a failure can be tried again from the step that failed. Without npm the window shows the command instead. Not now puts it off and says what waits on it. Nothing is installed without the user's press.
- A36. An account Pi already reaches is found and named, and none leads to the sign-in. With Claude Code signed in, hobkin says its agents can use it.
- A37. Connect OpenAI Codex starts Pi's sign-in for the OpenAI subscription Pi lists, and the story goes on by itself when a provider connects. Not now puts it off, and then the questions are not offered.
- A38. Asked for, the questions are five and differ by whose computer this is. Not asked for, the story goes to the settings. Any of them can be skipped, and picking a suggestion adds it to what is written, or takes it out again.
- A39. When the setup ends, the answered questions go to hobkin as one message that names the computer, gives each answer with its question, and asks it to ask before creating or connecting anything. With nothing answered nothing is sent.
- A40. A bubble's words arrive one after another, a key between backticks is drawn as a key, and a screen reader hears each bubble whole.
- A41. Told to the end, the setup gives way to the app as hobkin flies to the avatar by the message input, and the tour opens on Home. Skipped, there is no tour.
- A42. The tour stops at the chat, why hobkin knows things, its mind, Home, Reports, Routines, Action Items, Work, Settings and search. Next from the last stop ends it, Back at the first does nothing, leaving ends it from any stop, and then nothing moves. A stop whose part is not on screen is passed over.
- A43. In the tour Enter, Space and Right go on, Left goes back and Escape leaves. Every key a stop names is one the app binds.
- A44. The tour's card is always wholly inside the window and never covers the part it points at.
- A45. Installing the search package also writes its setting into Pi's own folder, so it searches through OpenAI. A setting that is already there is left as it is, a failed install writes none, a host that was not given Pi's folder writes none, and no setting the setup writes holds a key.

## Proof

- A1. `ui/test/onboarding.test.ts` › "the setup shows on the first run, and not once it has been seen"
- A2. `ui/test/onboarding.test.ts` › "?setup=1 in the address shows it whatever was saved"
- A5. `ui/test/onboarding-story.test.ts` › "skip ends the story from anywhere, the last bubble ends it as done, and then nothing moves"
- A10. check: open the setup over a screen, press Tab, Command+2 and Command+comma, then read the screen under it. Not seen since the rewrite of 2026-11-13.
- A18. check: set Movement to still, open the setup, answer a question, finish. Not seen since the rewrite of 2026-11-13.
- A19. check: press Run setup again, then Take the tour, in Settings. Not seen since the rewrite of 2026-11-13.
- A20. check: open the setup in light and in dark. Seen on 2026-11-13 as still pictures made without a browser: the settled world with hobkin on its hill, a bubble, the two choices and the field, in light and in dark, at 1440 by 900 and 900 by 600. The Pi and sign-in panels and the tour were not pictured.
- A22. check: open the setup and watch the opening. Not seen: motion cannot be seen in a still picture.
- A23. `ui/test/onboarding-world.test.ts`
- A24. `ui/test/onboarding-world.test.ts`
- A25. check: press a key during the opening. Not seen since the rewrite of 2026-11-13.
- A26. check: walk the story and watch hobkin's face. Not seen since the rewrite of 2026-11-13.
- A27. `ui/test/onboarding-story.test.ts` › "a new Mac: who the user is, Pi, a sign-in, then the app"
- A28. `ui/test/onboarding-story.test.ts` › "a question holds the story until it is answered"
- A29. `ui/test/onboarding-story.test.ts` › "back never undoes an install or a sign-in"
- A30. `ui/test/onboarding-story.test.ts` › "Escape and Left go back, Escape stops a sign-in first, and nothing goes back during an install"
- A31. `ui/test/onboarding-story.test.ts` › "the two choices balance: the one the pointer nears grows as the other shrinks"
- A32. `ui/test/onboarding-story.test.ts` › "a name is needed and an email can be left out, each held to what hobkin keeps"
- A33. `host/test/profile.test.ts`
- A34. `ui/test/onboarding-story.test.ts` › "Pi is only brought up when something of it is missing"
- A35. `host/test/pi-install.test.ts`
- A36. `ui/test/onboarding-story.test.ts` › "an account Pi already reaches is found, and none leads to the sign-in"
- A37. `ui/test/onboarding-story.test.ts` › "the sign-in the setup offers is the OpenAI subscription Pi lists"
- A38. `ui/test/onboarding-story.test.ts` › "the questions are five for each kind of computer, and they differ"
- A39. `ui/test/onboarding-story.test.ts` › "the answers are handed to hobkin as one message, with only what was answered"
- A40. `ui/test/onboarding-story.test.ts` › "a bubble is split into words, and a key between backticks stays one piece"
- A41. check: finish the setup and watch hobkin land by the message input and the tour open. Not seen since the rewrite of 2026-11-13.
- A42. `ui/test/tour.test.ts`
- A43. `ui/test/tour.test.ts`
- A44. `ui/test/tour.test.ts`
- A45. `host/test/pi-install.test.ts` › "a package that needs a setting gets it written in Pi's folder once it is installed, and a setting that is there is left as it is"

## Steps

- [x] S1 (~~A3, A4,~~ A5). The step machine. Replaced by S8 on 2026-11-13.
- [x] S2 (~~A6, A7, A8, A9~~). The setup's key map. Replaced by S8 on 2026-11-13.
- [x] S3 (A1, A2). The first-run mark and `?setup=1`.
- [x] S4 (~~A12, A13, A14~~). Tiers proposed from Pi's default model. Out of the setup since 2026-11-13.
- [x] S5 (A10, ~~A11, A16, A17,~~ A18, A20 ~~, A21~~). The setup layer and its five steps. Replaced by S11 on 2026-11-13.
- [x] S6 (A19). Run setup again in Settings.
- [x] S7 (A1, A10 ~~, A17~~). The frame mounts the setup and stays mounted behind it.
- [x] S8 (A5, A27, A28, A29, A30, A32, A34, A36, A37, A38, A39, A40). The story's rules: its beats and their order, its keys, the questions and the message that hands them over.
- [x] S9 (A22, A23, A24, A20). The world and where hobkin hides, hops and stands.
- [x] S10 (A33, A35, A45). The host keeps the profile and finds and installs Pi and its packages, with the setting a package needs.
- [x] S11 (A25, A26, A31, A40). The story's layer: the opening, hobkin's hops, the bubbles, the choices, the field, the Pi and sign-in panels, the hand-off.
- [x] S12 (A42, A43, A44). The tour.
- [ ] S13 (A10, A18, A19, A22, A25, A26, A41). Each check seen in the window. Nothing of the rewrite has been seen moving yet.

## Open questions

- The search package is installed from a branch of the user's fork, which moves when it is pushed to. Should the list point at a tag or a published package instead, so a new Mac always gets the same code?
- The five packages named with `npm:` were not looked up on npm. If one is not published under that name, its source should be its git address.
- The search setting names the model the user runs (`gpt-6.1-sol`). Should a new Mac get the package's own default model instead?
- Should the mark live in hobkin's home (`014-continuity`), so a second window profile or a new Mac does not show the setup again?
- Should the setup offer Claude's and the other sign-ins once hobkin supports them there, or keep sending those to Connect a model?
- Should the projects folder be picked with the Mac's own folder window instead of typed?
