---
{
  "id": "047-pets",
  "title": "Four pets in place of the hood",
  "kind": "work",
  "status": "doing",
  "depends": ["020-settings", "025-onboarding"],
  "updated": "2026-11-19"
}
---
# Four pets in place of the hood

## Outcome

hobkin's character is no longer a pointed hood. The user picks one of four pets in Settings: Round, Ears, Antenna or Sprout. Ears is the default. Every place that drew the hood draws the chosen pet, with all 18 moods, the pointer reactions and the small agent faces, and each pet's own part (ears, antenna, sprout) moves with the mood. hobkin.dev shows the same four pets, starts on Ears, and has a button that changes the pet and remembers it.

## Decisions

- The art comes from the user's sheet (`opt_sheet2.png`, 2026-11-19), in the same units as the old art: eyes at 84 and 116, height 138, radius 8. The four share one body, a dome from 34 to 166 wide with its top at 70 and two feet below it, and differ only in the part on top. The paths were checked against the sheet: under 0.5% of pixels differ, all at edges.
- The pets' paths, the part each pet adds and how that part moves are defined once in `ui/src/avatar/pets.tsx` and `ui/src/avatar/hob.css`. hobkin.dev copies them.
- A pet's part is drawn behind the body, so it can turn about its base without showing a gap.
- Pointer reactions, moods and the rules for reduced and still movement stay as they are. A part's pose for a mood (drooped ears when sad) holds when movement is still. Only its loops stop.
- The choice is kept with the other settings in the window's storage. Settings saved before this load with Ears.
- Agent faces, the wordmark and the Mark all draw the chosen pet.
- The app icon becomes the Ears pet. It is a native change, so it waits for a restart the user agrees to.
- On hobkin.dev the choice is kept in `localStorage` under `hobkin-pet` and set before the first paint, as the theme is.

## Out of scope

- hobkin's terminal art in `~/Poetry/hobkin/assets/animations`. The terminal app is no longer used.
- Letting the user draw or upload a pet of their own.

## Acceptance

- A1. No hood shape is left in the client's UI source, its window favicon or the hobkin.dev pages and images.
- A2. Settings has a Pet tile with the four pets. Choosing one changes the character everywhere in the window at once, and the choice survives a reload.
- A3. With nothing saved, the client and hobkin.dev both show Ears.
- A4. Each of the 18 moods draws correctly with each pet: no mood's extras (sound waves, dots, question mark, Zs, hands) overlap the pet's part.
- A5. Each pet's part moves with the mood: ears droop when sad, the antenna's bulb pulses while thinking, the sprout wilts when sad. With movement set to still, the part holds its pose.
- A6. The setup's character still stands on its hills: its feet touch the ground line.
- A7. hobkin.dev has a button that changes the pet, its choice survives a reload, and the page shows the chosen pet from the first paint.
- A8. The app icon shows the Ears pet after the restart.

## Proof

- A1. check: `rg` for the hood path `100 22 Q160` in `ui/`, `src-tauri/app-icon.svg` and `~/Poetry/hobkin.dev` finds nothing.
- A2. `ui/test/pets.test.ts` › the settings store keeps the pet and defaults to Ears; check: still renders of the Pet tile.
- A3. `ui/test/pets.test.ts` › a saved state without a pet loads Ears; check: hobkin.dev with empty storage.
- A4. check: a still render of every pet in every mood.
- A5. check: the same renders show the posed parts; reading `hob.css` for the still rules.
- A6. `ui/test/onboarding-world.test.ts`, with the new art's measurements.
- A7. check: hobkin.dev read through and rendered.
- A8. check: the user sees the icon after the restart.

## Steps

- [x] S1 (A4). Measure the sheet and write the four pets' paths.
- [ ] S2 (A1, A4, A5). The pets and their parts' movement in `pets.tsx` and `hob.css`; the mood extras moved clear of the parts.
- [ ] S3 (A2, A3). The Pet tile and the stored choice; Hob, the Mark and agent faces read it.
- [ ] S4 (A6). The setup's character measurements follow the new art.
- [ ] S5 (A1, A3, A7). hobkin.dev: the pets, their movement, the button, the favicon and share images.
- [ ] S6 (A8). The app icon, as a patch applied at the user's restart.
