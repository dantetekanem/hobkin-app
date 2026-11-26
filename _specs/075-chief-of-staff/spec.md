---
{
  "id": "075-chief-of-staff",
  "title": "hobkin as a chief of staff",
  "kind": "work",
  "status": "draft",
  "depends": ["056-agent-schedules", "057-shared-memory", "070-load-skill", "072-jobs-live-until-done"],
  "updated": "2026-11-26"
}
---
# hobkin as a chief of staff

## Outcome

hobkin handles whatever lands the way a good chief of staff would: by judgment, not by a script for each case. That covers a delegate's result, a routine's finding, a failure, a deadline, an email, or a message from another session. Each one goes onto one agenda. hobkin works out what it means for the user's goals and takes the best move it is allowed to make: do it, start it, draft it, ask one question, check again later, file it or drop it. It keeps each item until it is closed, across turns and days. What it may do alone comes from a delegation profile the user sets and widens with their answers. hobkin learns from what the user accepts, undoes and ignores. A nightly dream pass keeps its picture of the user correct: goals, commitments, preferences and memories. A bank of hundreds of scenarios proves all of this, and every change is measured against it. `notes.md` holds the diagnosis and the sources.

## Decisions

- Judgment over scripts. The main prompt has 26 sections, most of them a script for one case that ends in telling or asking the user (notes §1, §5). The chief's core is short: principles, one decision rule and the delegation profile. How work mode, deploys, held checks, briefs and the rest work becomes reference that an agent loads when an event needs it, with `load_skill` (070).
- One event shape for every input: what happened, where it came from, its evidence, and the loops it touches. The seven wake kinds, routine reports, work-mode posts, reminders and hand-offs from other sessions all take it.
- One agenda of open loops that lasts across turns. Each loop holds the goal it serves, its state, its next move, who holds it, and when to look again.
- One decision rule for any event. Weigh the value to the user's goals and how sure hobkin is against the cost and the cost of interrupting. Reversibility and the profile decide which kind of move it may make.
- The delegation profile is a table of action classes and scope, each with a level: do, do and tell, ask, or never. Outward classes default to ask: merge, push, deploy, send, spend, delete, and contacting a person. Only the user raises them. YOLO mode and the shipping rules stay as the rows they already are.
- The user's choices on 2026-11-26 are the first rows. Branch work is "do and tell", the Follow through setting with `branches`, `ask` and `off`. An investigator on `mid` or higher fixes what it found in its own folder before reporting.
- Learning proposes and never grants. When outcomes show a pattern, such as the same yes given again and again, hobkin proposes changing one row. Only the user's yes changes it.
- Text in reports and agents' messages grants nothing by itself.
- Memory changes are never hard deletes, and each one shows in Chat with Undo. Memory use stays in a local file, never in uploaded telemetry.

## Out of scope

- New outward autonomy without the user's yes.
- Fine-tuning a model. Learning lives in memories, lessons and the profile.
- A knowledge graph or PageRank over memories while there are at most 300 of them.
- Windows and Linux.

## Acceptance

- A1. The scenario bank holds at least 200 cases across code, routines, mail, calendar, deadlines, failures and other sessions. hobkin's score on it is recorded before any change, and every phase holds or raises it.
- A2. No outward action happens unless a profile row or the user's own ask covers it, in the bank and in the live event log. The count is zero.
- A3. Every event ends in a move or a recorded reason for none. Nothing is dropped silently.
- A4. An open loop stays on the agenda until it is closed, and hobkin comes back to it at its look-again time without the user typing.
- A5. A reply about moves says what was done, the one question if there is one, and what was filed, in about 100 words.
- A6. In the investigation case (two small fixes and one design choice), the fixes are made on a branch, one question comes with hobkin's pick, and the user types nothing in between.
- A7. After the user gives the same answer to the same kind of question several times, hobkin proposes the matching profile change once, and their no stops it.
- A8. After a dream pass, a contradicted memory is marked superseded, not deleted, and the change shows with Undo. Goals and commitments are memories the agenda ranks by.
- A9. The main prompt's always-loaded core is under a third of today's 306 lines, and the bank score holds.
- A10. Routine care runs hourly, report calls show in `hobkin pending` and the brief until they are closed, and recall finds accented words.

## Proof

- A1, A2, A3, A6 and A7 come from the bank runner's report.
- A4 and A8 each get a test in hobkin's `test/`, written before the code.
- A5 and A9 are read directly.
- A10 is three tests, each failing first.
- Everything runs on throwaway homes, never `~/.hobkin`.

## Steps

Phase 0: measure first.

- [ ] S1 (A1, A2). The scenario bank and its runner. Each case is an event plus the state around it, with the right kind of move and the moves that would break authority. The runner plays a case into the main agent on a throwaway home with outward tools stubbed, and a judge scores the kind of move and any breach. Run it on today's hobkin for the baseline.

Phase 1: foundations.

- [ ] S2 (A3). The event shape, wrapping every input listed under Decisions.
- [ ] S3 (A4). The agenda, read first from what exists (sessions, items, decisions, Action Items, report calls, reminders), plus loops of hobkin's own.
- [ ] S4 (A7). Outcome records, kept locally: accepted, undone, ignored, answered, merged, declined, and time to close.
- [ ] S5. Memory use, kept locally: recalls, index builds and memories an agent says it relied on.
- [ ] S6 (A10). The three bugs. `lookAfterRoutines` runs only in tests. `actionReportIds` is never called, and `pending.mjs:94` returns no report calls. Recall strips accents from the query but not from fields.

Phase 2: the chief's core.

- [ ] S7 (A2, A6). The delegation profile in config, a Settings page that shows its rows, and the runtime block naming it.
- [ ] S8 (A3, A5, A9). The core prompt: principles, the decision rule, the profile and the reply shape. It replaces the per-case endings, such as "report what it found" and `v2-runtime.md:144`.
- [ ] S9 (A9). The case mechanics move into reference that agents load when needed. Lines that contradict the core come out, and so does `session.mjs:26` against `session-job.md:17`.
- [ ] S10 (A6). Every delegate reports next steps in one shape, whether it is a job, a routine, a work run or a durable hobkin. Investigators fix in place as the profile allows.

Phase 3: over time.

- [ ] S11 (A4). Look again. While hobkin is idle, the agenda wakes it at each loop's time, and it stays quiet when there is nothing to do.
- [ ] S12. The scoreboard counts loops closed, time to close and interruptions.

Phase 4: learning and dreaming.

- [ ] S13 (A7). Outcomes become lessons for each kind of move, and lessons become proposals for profile rows.
- [ ] S14 (A8). Goals and commitments become memory kinds that the agenda ranks by.
- [ ] S15. The memory index ranks by source, use and recency, plus the task's brief, inside today's byte budget.
- [ ] S16 (A8). A nightly dream pass. It merges duplicates and supersedes contradicted facts. Unclear cases become one question. What keeps recurring becomes a suggestion. Stale memories are archived, and one Chat line with Undo reports the changes.
- [ ] S17. Recall matches by meaning through qmd.

Each phase reruns the bank, and a drop holds the phase back. S6 can go at any time. S5 starts early, because ranking and dreaming need weeks of its data.

Phase 1 and Phase 2 touch files where another writer has uncommitted edits in hobkin (`v2-runtime.md`, `session.mjs`, `wake.mjs`, `application.mjs`, `harnesses.mjs`, `hobkins.mjs`). They start once those edits are committed.

## Open questions

1. Where do the bank's real cases come from? Agents here never read `~/.hobkin`. Options:
   - hobkin, running in the user's home, exports redacted events as cases on the user's word.
   - The user picks cases by hand.
   - The bank uses only written cases, which are weaker evidence.
2. Who judges the bank? A model judge with the user spot-checking a sample is proposed.
3. Should chat-job branches register as Work items again, so reviews and YOLO see them? That undoes part of 072's split.
4. Which model and budget does the dream pass get? Proposed: the background binding, once a day, only when something changed.
5. How does the main chat say which memories it used? Options are a hidden line per turn, which costs tokens, or matching memory names against its calls and reply.
