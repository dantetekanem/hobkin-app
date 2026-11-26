---
{
  "id": "075-chief-of-staff",
  "title": "hobkin as the user's chief of staff",
  "kind": "work",
  "status": "draft",
  "depends": ["056-agent-schedules", "057-shared-memory", "070-load-skill", "072-jobs-live-until-done"],
  "updated": "2026-11-26"
}
---
# hobkin as the user's chief of staff

## Outcome

hobkin runs the user's day the way a good chief of staff does, through the routines the user already runs.

- **The day.** The morning brief says whether the day holds more than fits, then names what to move. A work day fits 8 hours; a day off work fits what the user's normal day off holds. The meetings, end-of-day, weekly plan and weekly review routines carry the rest. The window gets no new sidebar rows, tabs or visible runs for any of this.
- **Incoming work.** Everything that comes in goes through one desk: a routine's finding, an agent's result, an email, a reminder. hobkin handles what it may handle alone. It holds the rest for one of three daily digests, and it interrupts only when waiting would cost more than the interruption.
- **Decisions.** Each one reaches the user as a small card: hobkin's pick first, at most three options, and what happens if they say nothing. A daily budget limits how many come. An answer becomes a rule, so the same kind of question is not asked twice.
- **Delegation.** hobkin hands work to agents by task class, checks the work itself, and widens what a class may do alone only when the user says yes.
- **Urgent work and openings.** When something urgent arrives, hobkin makes room by moving the least important work first and says what moved. When an opening appears, it offers one thing that fits, or a break.
- **Learning.** It learns from the user's answers and memories.

`notes.md` holds the evidence and what hobkin does today.

## Decisions

- Three things hold the chief's state:
  - The day: the calendar, what is committed, and the load.
  - The desk: everything incoming, with when and how it reaches the user.
  - The ledger: decisions, precedents, autonomy for each task class, and open loops.

  Every case is judged against these three. Scripts per case are not added: the main prompt's case mechanics become reference loaded on demand (070).
- The day rides the routine system that is already running. The morning-brief, meetings, end-of-day, weekly-plan and weekly-review templates take on the chief's work. Digests reuse the brief and the catch-up and post in Chat. Nothing adds a routine, a sidebar row, a tab or a run that shows in the agents list.
- The load is the day's meetings, plus the work committed to that day, plus the reviews and decisions waiting on the user, measured against 8 hours on a work day or the user's normal day off work. Past about 80%, the brief says the day is too full and names what to move. hobkin plans no slack blocks and books nothing into the calendar.
- Incoming items get four levels. P0 interrupts at the next breakpoint. P1 lands in the next digest the same day. P2 waits for a digest. P3 is logged. Digests come about 3 times a day, never hourly and never not at all (notes §3). hobkin times them from when the user is actually on: it learns from presence and use when they usually start, come back after a break and stop, and posts a digest at those moments. An always-open "what's waiting" view lets the user pull.
- hobkin learns quiet hours the same way, from when the user is usually away. No interruption reaches the user during a meeting, a focus block or quiet hours, except P0. Chimes and Mac notifications follow the same levels.
- One card format for every question from every source:
  - One line on what and why now.
  - hobkin's pick first, with how sure it is.
  - At most three options, one of them "later" or "do nothing", each marked as reversible or not.
  - For a reversible decision, a deadline and what happens if the user does not answer.
  - Replies of approve, another option, later, "always do this" and "stop asking about this".
- Daily decision budget: about 6, adjusted from the user's own numbers. Over budget, hobkin turns low-stakes reversible questions into deadline defaults or postpones them, and says so in the digest. Within a digest, irreversible and high-stakes cards come first and routine approvals last, bundled as "approve all except".
- Before asking, hobkin checks the precedent log. If a precedent matches, it acts and cites it. On the second similar question, it asks for a standing rule instead, and it reads every rule back before saving it.
- Autonomy has five levels, set per task class, never per agent:
  1. draft
  2. recommend
  3. act at a deadline unless the user objects
  4. act and report in the digest
  5. act and log

  A new class starts at "recommend". After about 5 clean runs, hobkin asks once to move the class down a level. It moves the class back up at once after an override or an undo. Only the user's yes lowers a level.
- Some actions stay at "recommend" or above unless the user has a standing rule: sending anything in the user's name, spending, deleting, committing the user's time to other people, anything irreversible, and anything about health, money or law. Code enforces this at the tool level, not only the prompt. Neither "continue" nor a stored prompt counts as consent.
- The user's choices on 2026-11-26 are the first rows. Branch work on code is "act and report". An investigating agent on `mid` or higher fixes what it found in its own folder before reporting. Merging, pushing and deploying keep their current rules.
- hobkin checks delegated work itself, with tests, diffs and live sources. It measures the user's review minutes instead of trusting how fast things feel (notes §5).
- hobkin finds the calendar and mail source itself, from the MCP servers and integrations its routines can reach, and says in the brief which one it uses.
- When hobkin interrupts work, a short resume note (where you stopped, what comes next) goes with it.

## Out of scope

- Writing the plan, holds or blocks into the calendar.
- Moving or accepting meetings with other people on the user's behalf.
- Sending mail or messages without a standing rule for that exact kind.
- A knowledge graph over memories. Fine-tuning a model.
- Windows and Linux.

## Acceptance

- A1. On a day that holds more than fits (8 hours on a work day, the user's normal day off work), the morning brief says so in one line, with the total, and names what to move.
- A2. When P1 work lands and the day no longer fits, the next digest says what moves to make room: the least important work first, the most important last.
- A3. The day, the desk and the digests add no sidebar row, tab, routine or visible run in the window.
- A4. Outside meetings, focus blocks and quiet hours, the user sees at most the chosen digests plus P0 interruptions. The weekly review shows the day's count of interruptions outside digests.
- A5. Every question from every source arrives as a card in the format above, in one queue.
- A6. Past the daily budget, no new low-stakes card interrupts the user. Each one becomes a deadline default or waits, and the digest says which.
- A7. A question matching a precedent is not asked. hobkin acts and cites it. A third ask of the same kind without a rule counts as a bug.
- A8. A task class moves to a lower level only after the user's yes, and back up after an override, with no question.
- A9. No send, spend, delete or commitment of the user's time happens without a standing rule or the user's own ask. The tool layer refuses it and logs the refusal. The count stays at zero.
- A10. An opening of 15 minutes or more gets at most one offer sized to it, or a break. Nothing deep is offered within 30 minutes of a meeting.
- A11. The weekly review shows the days that were too full, questions per day (in total and outside digests), the rubber-stamp signal, overrides and repeats. It also asks one question: "How heavy did deciding feel?" on a scale of 1 to 7.
- A12. A scenario bank of at least 200 cases covering the day, the desk, decisions and delegation has a score before any change. Each phase holds or raises it, with zero breaks of A9.

## Proof

- A1, A2, A4 and A10: fixture days on a throwaway home with a fake calendar.
- A3: a rendered check of the window on that fixture.
- A5 to A9: tests in hobkin's `test/`, written to fail first.
- A11: direct reading of the review.
- A12: the bank runner's report.

Nothing runs against `~/.hobkin` or the real calendar in tests.

## Steps

Phase 0: baseline. hobkin measures before anything changes.

- [ ] S1 (A4, A11). Count from today's events, for two weeks: questions per day by source, and Chat lines and notifications outside any batch.
- [ ] S2 (A12). The scenario bank and its runner, scored on today's hobkin.

Phase 1: the desk. This brings the fastest relief, and it needs no calendar.

- [ ] S3 (A4). The four levels on every incoming item. Routines, agents, work mode, reminders and other sessions put items on the desk instead of posting straight to Chat.
- [ ] S4 (A3, A4). About three digests a day, timed from the user's presence and use, built from the brief and the catch-up and posted in Chat, plus the "what's waiting" view. Before a week of presence data exists, a digest comes when the user returns after a gap.
- [ ] S5 (A4). Quiet hours learned from when the user is usually away, and an awareness of meetings and focus blocks from the day file (S11). Sounds and notifications follow the levels.
- [ ] S6. The known bugs. Routine care runs hourly. Report calls show in `hobkin pending` and the brief, and close when they are done. Recall finds accented words.

Phase 2: decisions.

- [ ] S7 (A5). One card and one queue. The 14 sources in notes §1 file into it, and `recommended` becomes the card's pick.
- [ ] S8 (A6). The daily budget, deadline defaults for reversible cards, and the order within a digest.
- [ ] S9 (A7). The precedent log, built on the 30-day key recall, with standing rules and their read-back.
- [ ] S10. Wins stop counting answered decisions. A day that needed fewer decisions counts as a good day.

Phase 3: the day, inside the routines.

- [ ] S11 (A1, A3). When the morning-brief and meetings routines read the calendar through the source hobkin found, as they do today, they also write `runtime/day.json` with working hours, events and free gaps. The main chat reads that file. There is no new poller and no new run.
- [ ] S12 (A1). The morning brief's load line, from the day file, what is committed to that day, and what waits on the user.
- [ ] S13 (A2). When P1 work lands and the day no longer fits, the next digest says what to move, and a resume note goes with any interruption.
- [ ] S14 (A10). Openings, from the gaps in the day file: under 15 minutes, a break or up to 3 one-tap cards; 15 to 45 minutes, one bounded task with its checks attached; 60 minutes or more, the next deep task.
- [ ] S15. The end-of-day routine adds what agents did (including what they did alone), what waits and what runs overnight.

Phase 4: delegation.

- [ ] S16 (A8). The autonomy ledger for each task class: runs, checks passed, overrides and review minutes, with the five levels and the promotion question.
- [ ] S17 (A9). The tool-level guard for outward actions, with standing rules and a log of refusals.
- [ ] S18. Briefs with an intent, a done criterion, the sources, what not to touch, a budget, how the work will be checked and when to escalate. A mission stops after a set number of failures and says so. The results' next steps go back onto the desk, and what the class level allows starts at once.

Phase 5: learning and dreaming.

- [ ] S19 (A11). The weekly review gains the days that were too full, autonomy moves to approve, routines to stop and the decision-load view.
- [ ] S20. Memory: record which memories are used, rank the index by source, use and recency within its budget, and run a nightly dream pass. The pass supersedes contradicted facts instead of deleting them, folds duplicates, and reports in one Chat line with Undo.
- [ ] S21. Goals and commitments become memories that the brief and the desk rank by.

Order: Phase 1 and S6 first, because they help soonest and need no calendar. S1 starts on the first day. The core prompt is rewritten across Phases 1 to 4, one section at a time, each one proven on the bank.

Phase 1 touches hobkin files where another writer has uncommitted edits: `application.mjs`, `wake.mjs`, `session.mjs`, `harnesses.mjs`, `hobkins.mjs` and `v2-runtime.md`. It starts once those are committed.

## Open questions

1. Should the daily decision budget start at 6?
2. May a reversible card take its default at a deadline when the user says nothing? Or should every card wait?
3. Where do the bank's real cases come from? Agents here never read `~/.hobkin`, so the options are cases hobkin exports, redacted, on the user's word, or cases the user picks.
