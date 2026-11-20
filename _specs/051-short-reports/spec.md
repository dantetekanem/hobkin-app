---
{
  "id": "051-short-reports",
  "title": "Short reports",
  "kind": "work",
  "status": "doing",
  "depends": ["012-reports-actions", "017-model-tiers", "020-settings"],
  "updated": "2026-11-20"
}
---
# Short reports

## Outcome

Settings has a Short reports switch, off until the user turns it on. While it is on, hobkin writes a short version of each new report on its fast tier: about 100 words, read in under 30 seconds, with the point first. The report view shows that short version first, and the full report sits under it behind "Show the full report". While the switch is off, or while a short version is still being written or could not be written, a report shows exactly as it does today.

## Decisions

### The user's words

- "In Settings I want an option (30 Seconds only what matters reports) or something better said, this will be a switch, if on, reports will run a fast agent to get an under 30sec reading version of the content (with a collapsed option to see the rest)"

### Where it is made

- hobkin makes the short version, not the window, so every surface reads the same text. It is kept beside the report as `reports/<sha256 of id>.short.md`, private like the report itself, and hobkin's snapshot gives each report that has one an optional `short` field. Deleting a report deletes its short version too.
- The short version comes after the report is saved, in the background, one report at a time. Saving or showing a report never waits for it. When it is saved, hobkin refreshes its snapshot so the window sees it.
- hobkin looks for reports without a short version as it builds its snapshot. Each report is asked for at most once per hobkin process, so a model that fails costs one try per report and never loops.
- Only reports that finished after the switch was turned on get one. Turning it on does not rewrite old reports. A report already 100 words or shorter gets none, because it is already short.
- The switch lives in hobkin's `config.json` as `shortReports: { enabled, since }`, where `since` is when it was last turned on. hobkin reads it on each pass, so a change counts from the next report. A config that cannot be read counts as off.

### The model

- It reuses the path hobkin's report editor already takes (`src/cli/report-editor.mjs`): one `runHarness` job with no tools, no extensions, no skills and no context files, and its own system prompt, `src/prompts/short-report.md`, under the new purpose `short-report`. No new model client.
- It runs on the fast tier as hobkin resolves it (`tierBinding(config, 'fast')`): the fast tier's own model and thinking level, or the checks model when the fast tier has none. With no model there, nothing is asked.
- A job that runs longer than 3 minutes is stopped. A report longer than 64 KB is read up to its first 64 KB.

### What counts as a short version

- The answer is trimmed, a code fence around it is dropped, and so is one lead-in label at its start, such as `Summary:`, `TL;DR:` or `Useful:`.
- It is thrown away when it is empty, longer than 130 words, or carries a number, link or piece of code that the report does not have. A short version may leave facts out. It may not add one.

### The window

- Settings gets a Short reports tile with one switch: "A short version first", and under it "A version you read in 30 seconds first, the full report under it." The tile reads hobkin's switch when it mounts and saves it on a click. With no host the switch is disabled and the tile says why. A save that fails puts the switch back and says why.
- The switch is the user's: hobkin's own agents cannot turn it on, since each short version spends a model call.
- In the reader, a report with a short version shows its heading, then the short version in its triage tone, then "Show the full report". The full report opens under that control, so the control and everything above it stay where they are. The control turns into "Hide the full report".
- The reader picks its layout when a report opens. A short version that lands while the report is open shows the next time it opens, so nothing moves under the user's eyes.
- The `short` field is optional on the wire. An older hobkin sends none, and an older window ignores it.

## Out of scope

- Short versions in the report list, Chat's notice lines, the Overview and the terminal app.
- Short versions for reports from before the switch was turned on.
- A choice of tier or length for the short version.
- A `hobkin` command for the switch.

## Acceptance

- A1. With the switch off, which is how a new home starts, no short version is made, no model is asked, and a report reads as it does today.
- A2. With the switch on, a report that finished after it was turned on and is over 100 words gets a short version made on the fast tier's model, with no tools, and saved beside the report. The report in hobkin's snapshot then carries it as `short`.
- A3. Making the short version never delays the report: the report is listed before the short version exists, and a failed, empty, too-long or fact-adding answer leaves the report with no short version and its body unchanged.
- A4. Reports from before the switch was turned on, and reports of 100 words or fewer, get no short version, and no report is asked for twice in one hobkin process.
- A5. Deleting a report deletes its short version.
- A6. Settings shows the Short reports switch with hobkin's value, saves a click through the host, and puts the switch back with the reason when the save fails. With no host the switch is disabled.
- A7. A report with a short version opens with the short version first and the full report collapsed under "Show the full report". Opening it does not move the control or anything above it. A report without one reads as it does today.
- A8. The new wire fields are optional, so an older host or window still works.

## Proof

- A1. `hobkin/test/cli-short-reports.test.mjs` › "with the switch off nothing is asked and no report carries a short version"
- A2. `hobkin/test/cli-short-reports.test.mjs` › "a new report gets a short version on the fast tier, saved beside it and carried in the list"
- A3. `hobkin/test/cli-short-reports.test.mjs` › "an answer that is empty, too long or adds a fact is thrown away and the report stays as it was"
- A4. `hobkin/test/cli-short-reports.test.mjs` › "old reports and short ones are left alone, and none is asked for twice"
- A5. `hobkin/test/cli-short-reports.test.mjs` › "deleting a report deletes its short version"
- A6. `ui/test/settings-short-reports.test.ts` › "the switch reads hobkin's value, saves a click and puts it back when the save fails"
- A7. `ui/test/reports-short.test.ts` › "a report's short version reaches the reader, and one without reads as before"; check: a still render of the reader with the full report collapsed and open, the control in the same place.
- A8. `host/test/short-reports.test.ts` › "the switch is read and saved through hobkin's own functions"

## Steps

- [ ] S1 (A1, A2, A3, A4, A5). Runtime: the switch, the prompt, the `short-report` purpose, making and checking the short version, the background queue, `short` in the snapshot, and the delete. Files: new `hobkin/src/cli/short-reports.mjs`, new `hobkin/src/prompts/short-report.md`, `hobkin/src/cli/harnesses.mjs`, `hobkin/src/cli/reports.mjs`, `hobkin/src/cli/application.mjs`.
- [ ] S2 (A6, A8). Host and protocol: the `short-reports.read` and `short-reports.set` commands. Files: `host/src/reports.ts`, new `host/src/hobkin-short-reports.d.ts`, `shared/commands/registry.ts`.
- [ ] S3 (A6). Window: the Short reports tile in Settings. Files: new `ui/src/features/settings/short-reports.ts`, new `ui/src/features/settings/ShortReportsTile.tsx`, `ui/src/features/settings/SettingsScreen.tsx`.
- [ ] S4 (A7, A8). Window: the reader shows the short version first and the full report collapsed. Files: `ui/src/features/reports/report.ts`, `ui/src/features/reports/Reader.tsx`.
- [ ] S5 (A2, A7). What the tests cannot show: one real short version from the fast tier, read in the live window, with the user's go-ahead.

## Open questions

- Should the report list's one line read from the short version when there is one? It would change what the list says for every report, so it waits for the user's word.
- Should turning the switch on offer short versions for the latest few reports too? Each one costs a model call.
