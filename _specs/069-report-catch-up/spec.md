---
{
  "id": "069-report-catch-up",
  "title": "Read reports in the tool call, and a one-minute catch-up when they pile up",
  "kind": "work",
  "status": "doing",
  "depends": ["051-short-reports"],
  "updated": "2026-11-24"
}
---
# Read reports in the tool call, and a one-minute catch-up when they pile up

## Outcome

Agents see which reports the user has read, the same way the Reports list does. When unread reports pile up, and once a day, hobkin writes one short catch-up report: what happened that the user may have missed, what is worth opening, and what looks not useful or is usually skipped. The reports it covered count as caught up, so the pile clears without hiding that they were never opened.

The user, 2026-11-24: "i want reports to have a read/unread, can be just an effect in the ball, so is very small, this should be in the tool call as well. the idea is: if you accumulated too many reports, one 1 minute report will be generate telling all that happened that you might have missed, what really matters to look, what doesnt looks useful (or usually ignore), so the report system works in my favor. this can also be a daily or a dynamic cadence based on accumulation".

The user's two choices the same day: covered reports are caught up, not left unread; the catch-up runs both daily and when unread reports pile up.

## Decisions

### What was there before

- The ball already shows read and unread. `ToneMark` (`ui/src/features/reports/Tone.tsx`) is filled while a report is unread and empties once it has been open in the reader for 3 seconds. hobkin keeps that as a `report_read` event in `runtime/telemetry.jsonl` and sends `readState: 'read'` in the snapshot.
- `report-attention.json` already counts, for each routine over its latest 10 reports, how many were read and whether the routine is `ignored`.
- `hobkin reports` prints every report as JSON with no read state, and no agent tool lists reports at all.

### Read state

- A report is `read`, `caught-up` or `unread`. `caught-up` is a new event in the same log, `report_caught_up`, naming the catch-up that covered it.
- The ball treats `caught-up` like `read`: it is empty.
- Only a real read counts toward what a routine's reports are read for. A caught-up report is still unopened in `report-attention.json`, so "usually skipped" stays true.
- `hobkin reports` gives each report its `read` state, and the `hobkin` skill says what each one means.

### The catch-up

- It is hobkin's own background run, not a routine in the user's folder. Its reports have their own source, `catch-up`, and show in the Reports list like any other.
- It covers the unread reports that no catch-up has covered yet, except those that said nothing new and earlier catch-ups.
- It is given, for each covered report: its id, title, routine, time, triage line, and its short version or else the start of its body. It also gets each routine's read counts and `ignored` from `report-attention.json`.
- It writes under 200 words, a one-minute read. The first line follows the report rules (`Critical:`, `Blocked:`, `Useful:`). Then three parts: what happened, what to open (each report as a link to it), and what looks not useful or is usually skipped, with a suggestion such as pausing or trimming a routine. It never pauses or changes a routine itself.
- When it finishes, hobkin records `report_caught_up` for exactly the reports it was given. A report that arrives while it runs stays unread.
- It runs on hobkin's fast tier, as short reports do, with low effort.

### When it runs

- Two triggers, each on by default and each set in Settings: daily at 08:00 local time when anything is uncovered and unread, and when 8 or more uncovered unread reports pile up. hobkin checks the pile when a report finishes.
- Only one catch-up runs at a time. One that is already running covers what it was given; the next trigger covers the rest.
- The user can ask for one at any time. The Reports home offers Catch me up while anything is unread, and agents can start one.

### In the window

- The catch-up report reads like any report. A link to a covered report opens that report in the reader.
- The Reports home's Catch me up press starts one and says so in place.
- Settings, under Reports: the daily time with a switch, and the pile size with a switch.

## Contract

The lanes build on these names. Changing one is the lead's call.

Runtime, `hobkin/src/cli/catch-up.mjs`:

- `readCatchUp(root)` returns `{ daily: string | null, pileUp: number | null, running: boolean, lastAt: string | null, uncovered: number }`. `daily` is `HH:MM` local time, or null when off. `pileUp` is the count, or null when off.
- `setCatchUp(root, { daily?, pileUp? })` changes the settings and returns `readCatchUp(root)`. It refuses a bad time or a count under 1 in plain words.
- `startCatchUp(root, app)` starts one now and returns `{ message }` in hobkin's words. With nothing uncovered and unread, it starts nothing and says so.
- The snapshot's reports carry `readState: 'read' | 'caught-up'`, and nothing when unread. A catch-up report carries `scheduleId: 'catch-up'`.
- A link to a report in a report's body is written `[title](hobkin-report:<id>)`.
- `hobkin reports` adds `read` to each report: `read`, `caught-up` or `unread`. `hobkin reports catch-up` starts one.

Commands, `shared/commands/registry.ts`, `runs: 'host'`:

- `reports.catchup.read {}` answers the `readCatchUp` shape. `hobkin: true`.
- `reports.catchup.set { daily?: string | null, pileUp?: number | null }` answers the same. User-only, like `short-reports.set`.
- `reports.catchup.run {}` answers `{ message }`. `hobkin: true`.
- A hobkin without the module answers `unavailable`: "This hobkin cannot write a catch-up yet. Update hobkin."

## Out of scope

- A catch-up that marks something read the user never saw in it.
- Pausing or changing a routine from the catch-up.
- A catch-up for Action Items or Work.

## Acceptance

- A1. A report's read state is `read`, `caught-up` or `unread` in the snapshot and in `hobkin reports`. A caught-up report is not a read in `report-attention.json`.
- A2. The catch-up covers exactly the uncovered unread reports, leaving out nothing-new reports and earlier catch-ups, and records `report_caught_up` for exactly those once it has finished. A report that arrives during the run stays unread. A failed run covers nothing.
- A3. The daily trigger runs once a day at its time when something is uncovered and unread. The pile trigger runs when the count reaches its size. Neither starts a second catch-up while one runs. Either can be turned off.
- A4. `startCatchUp` starts one, or says there is nothing to catch up on and starts nothing.
- A5. The catch-up's prompt asks for under 200 words, the triage first line, the three parts, a link to each report it names, and no change to any routine.
- A6. The three commands pass hobkin's answers and refusals on, and answer `unavailable` for a hobkin without the module.
- A7. The ball is empty for `read` and `caught-up` and filled for `unread`. A `hobkin-report:` link opens that report in the reader. Catch me up shows while anything is unread and says what hobkin answered. Settings change both triggers.

## Proof

(Filled in as each step is checked.)

## Steps

- [x] S1. The spec (lead). c011600, 1a688ee (the commands and `CatchUpState`).
- [x] S2 (A1 to A5). Runtime: hobkin 50b4c5d (read state, `read` in `hobkin reports`), de9ce9d, 116c83c, 58626ba, 9e7018f, 9f087d5, e6efa10 (the command's execute bit). `test/cli-report-catch-up.test.mjs` 13 of 13 on an export of main. Settings in `config.json` `catchUp: { daily, pileUp }`; state in `runtime/catch-up.json`. Imported history does not count in `uncovered`.
- [x] S3 (A6, A7). Host and window: f222352, fb49d5d, 5fc3f8b, 07a314c, edab1b3. Host 7 tests, window 9 new tests pass; post-processing skipped.
- [x] S4. The host's three commands against hobkin main's real `catch-up.mjs` on a throwaway home (2026-11-24): defaults read, a change saved, a pile of 0 refused in hobkin's words, Catch me up with nothing unread says so. Stills in the lead's scratchpad. Not seen in the app's window. The daily default is on, so the host's first start after 08:00 writes a catch-up at once.

## Open questions

- Whether the catch-up should learn from which of its own links the user opens.
- The default daily time, 08:00, is a guess.
