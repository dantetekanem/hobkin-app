---
{
  "id": "047-pets",
  "title": "Four pets in place of the hood",
  "kind": "work",
  "status": "doing",
  "depends": ["020-settings", "025-onboarding"],
  "updated": "2026-11-26"
}
---
# Four pets in place of the hood

## Outcome

hobkin's character is no longer a pointed hood. The user picks one of four pets in Settings: Round, Ears, Antenna or Sprout. Ears is the default. Every place that drew the hood draws the chosen pet, with all 18 moods, the pointer reactions and the small agent faces, and each pet's own part (ears, antenna, sprout) moves with the mood. hobkin.dev shows the same four pets, starts on Ears, and has a button that changes the pet and remembers it.

## Decisions

- The art comes from the user's sheet (`opt_sheet2.png`, 2026-11-19), in the same units as the old art: eyes at 84 and 116, height 138, radius 8. The four share one body, a dome from 34 to 166 wide with its top at 70 and two feet below it, and differ only in the part on top. The paths were checked against the sheet: under 0.5% of pixels differ, all at edges.
- The pets' paths, the part each pet adds and how that part moves are defined once in `ui/src/avatar/pets.ts` (drawn by `PetPart.tsx`) and `ui/src/avatar/hob.css`. hobkin.dev copies them.
- A pet's part is drawn behind the body, so it can turn about its base without showing a gap.
- Pointer reactions, moods and the rules for reduced and still movement stay as they are. A part's pose for a mood (drooped ears when sad) holds when movement is still. Only its motion stops.
- A face, its pet's part and the crab move on change (2026-11-23, the user: "Move on change: A face and its crab play their motion for about 2 seconds when the mood changes (starts working, asks, finishes), then rest in the mood's pose. Idle cost near 0. Blinks can stay as a rare single blink."). When the mood changes, its motion plays for about two seconds and the face rests in the frame the motion ends on. A face that mounts already in a mood rests without playing. The eyes blink once every 6 to 10 seconds. Spec 052 has the rule and the measurement behind it.
- The choice is kept with the other settings in the window's storage. Settings saved before this load with Ears.
- Agent faces, the wordmark and the Mark all draw the chosen pet.
- 2026-11-19: the user asked, "i want an option for \"No Pet\"". It is a fifth choice in the Pet tile, stored as `none`, after the four. Decoration draws nothing and the layout closes up. A small face that tells agents apart by color (given a tint) is a dot in that color, in the same box. The wordmark shows the word alone. The setup's story keeps a character and draws Ears. The window favicon and the app icon stay as they are. The pets' own behavior is unchanged.
- The app icon becomes the Ears pet. It is a native change, so it waits for a restart the user agrees to.
- On hobkin.dev the choice is kept in `localStorage` under `hobkin-pet` and set before the first paint, as the theme is.
- A run on Claude Code has a crab pal beside its face (the user, 2026-11-23: "when using Claude Code through hobkin, I want claude crab near hobkin, like 2 pals, animated"). The crab is this app's own drawing in the pets' art square, in a terracotta of its own (`--hb-crab`), and never Anthropic's artwork. It takes the face's mood: it taps its claws when the run starts working, leans toward hobkin while the run waits or asks, and cheers when the run ends well. Both sleep after ten minutes at rest. They bump claws once when the pair first shows for a run, and again when the run finishes. The pair stands at the top of an agent's page and of a durable hobkin's page, and a small still crab stands beside the face in the agents list. The host marks the runs it sends to Claude Code (`onClaudeCode`), and a durable hobkin is told by its engine. A run on Pi, and every run from a host that does not say, looks as before. The main chat is always on Pi, so it has no crab.

## Out of scope

- hobkin's terminal art in `packages/hobkin/assets/animations`. The terminal app is no longer used.
- Letting the user draw or upload a pet of their own.

## Acceptance

- A1. No hood shape is left in the client's UI source, its window favicon or the hobkin.dev pages and images.
- A2. Settings has a Pet tile with the four pets. Choosing one changes the character everywhere in the window at once, and the choice survives a reload.
- A3. With nothing saved, the client and hobkin.dev both show Ears.
- A4. Each of the 18 moods draws correctly with each pet: no mood's extras (sound waves, dots, question mark, Zs, hands) overlap the pet's part.
- A5. Each pet's part moves with the mood: ears droop when sad, the antenna's bulb pulses when hobkin starts thinking, the sprout wilts when sad. With movement set to still, the part holds its pose.
- A6. The setup's character still stands on its hills: its feet touch the ground line.
- A7. hobkin.dev has a button that changes the pet, its choice survives a reload, and the page shows the chosen pet from the first paint.
- A8. The app icon shows the Ears pet after the restart.
- A9. With No Pet chosen, the character is not drawn where it is decoration, agent faces are dots in their color, the wordmark shows the word alone, and setup keeps Ears. The choice survives a reload, and an unknown stored value still loads Ears.
- A10. A run on Claude Code shows the crab beside its face on the agent's page, on a durable hobkin's page and in the agents list, in the mood that goes with the face's. A run on Pi, or one from a host that does not say, shows none. The pair's box is the same size in every mood, and a row with a crab keeps its controls where a row without one has them.

## Proof

- A1. check: `rg` for the hood path `100 22 Q160` in `ui/`, `src-tauri/app-icon.svg` and `~/Poetry/hobkin.dev` finds nothing.
- A2. `ui/test/pets.test.ts` › the settings store keeps the pet and defaults to Ears; check: still renders of the Pet tile.
- A3. `ui/test/pets.test.ts` › a saved state without a pet loads Ears; check: hobkin.dev with empty storage.
- A4. check: a still render of every pet in every mood.
- A5. check: the same renders show the posed parts; reading `hob.css` for the still rules.
- A6. `ui/test/onboarding-world.test.ts`, with the new art's measurements.
- A7. check: hobkin.dev read through and rendered.
- A8. check: the user sees the icon after the restart.
- A9. `ui/test/pets.test.ts` › No Pet is a fifth choice, what a face draws, and the settings store keeps the pet; check: still renders of the Pet tile with No Pet and an agent list row with dots, in light and dark.
- A10. `ui/test/pals.test.ts` › "the crab takes each of hobkin's moods as one of its own" and › "both are happy when a run ends well, and both sleep once they have rested long"; `ui/test/pals-agents.test.ts` › "an agent on Claude Code gets the crab pal, and one on Pi or from an older host gets none" and › "a durable hobkin on Claude Code gets the crab pal, and one on a tier or a Pi model gets none"; `host/test/claude-code-runs.test.ts` › "the route tells which runs it sends to Claude Code, and of no run it leaves on Pi" and › "the window's runs say which are on Claude Code, by the harness id the route was given"; check: still renders of the pair in each mood, of both pages and of the list, light and dark (2026-11-23), then the live window with a run on Claude Code.

## Steps

- [x] S1 (A4). Measure the sheet and write the four pets' paths.
- [x] S2 (A1, A4, A5). The pets and their parts' movement in `pets.tsx` and `hob.css`; the mood extras moved clear of the parts.
- [x] S3 (A2, A3). The Pet tile and the stored choice; Hob, the Mark and agent faces read it.
- [x] S4 (A6). The setup's character measurements follow the new art.
- [x] S5 (A1, A3, A7). hobkin.dev: the pets, their movement, the button, the favicon and share images.
- [x] S6 (A8). The app icon, as a patch applied at the user's restart.
- [x] S7 (A9). No Pet: the fifth choice, `drawingOf` in `pets.ts`, Hob and the Mark follow it, setup draws Ears. Seen in still renders, light and dark. Not yet walked in the window.
- [x] S8 (A10). The crab pal: the drawing and the pair 4be9463, the host's mark 877caed and 2be02f6, the window carrying it de70d1e, the agent's page 8b963b0, the hobkin's page c03b4a1, the agents list 9881ffe, one greeting a run ac842dc. `node scripts/perf/motion.ts` passes with 0 failing. Seen only as still renders: no motion was watched, and no live run on Claude Code was seen. Runs get the crab once the host has reloaded itself. With No Pet chosen the crab still stands beside the dot; the user has not said whether it should.
