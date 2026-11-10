---
{
  "id": "7d02c9-say-what-hobkin-is-doing",
  "title": "Say what the main agent is doing, above the input",
  "kind": "work",
  "status": "done",
  "depends": [],
  "updated": "2026-11-09"
}
---
# Say what the main agent is doing, above the input

Sample input for Change Review. hobkin commit 7d02c99 has no spec of its own, so this one was written after the fact from the commit, its message and its tests.

## Outcome
While the main agent works, the row above the input reads like its next message: hobkin is thinking, writing, researching, delegating, working, retrying or compacting, with how long the turn has run. The word follows each step of the turn, and the row goes when the turn ends.

## Decisions
- Plain code picks the word from each event of the main agent's turn, so the same event always gives the same word. An event that says nothing new keeps the word it had.
- A tool that reads or searches counts as researching, by the rule the face already uses. A `hobkin session` command counts as delegating, wherever hobkin is installed. Any other tool counts as working.
- The runtime holds the word for the turn and clears it when the turn ends. The snapshot carries it as `doing`, or null.
- The row shows in Chat only, with the input on screen, while hobkin is connected and busy. Before the first event it says thinking.
- The time on the row is the working timer that left the footer earlier the same day.

## Out of scope
- Saying what work agents and checks are doing. The row is about the main agent only.
- Stopping the turn from this row.
- Naming the tool or showing what it was given. The row says one word.

## Acceptance
- A1. While the model streams, the word is thinking for its thinking and writing for its reply.
- A2. A tool says what kind of work it is: reading and searching read as researching, a `hobkin session` command as delegating, and anything else as working. When the tool ends, the word is thinking again.
- A3. A retry reads as retrying and a compaction as compacting. An event that says nothing new keeps the word it had.
- A4. The word reaches the snapshot as `doing` while the turn runs, and is null once the turn ends.
- A5. In Chat, while the main agent works, the row above the input reads "hobkin is researching…" with how long the turn has run. Before any event it says thinking, and the row goes when the turn ends.
- A6. The row gives way when a question or a card takes the input's place.

## Proof
- A1. `test/cli-doing.test.mjs` › "what the model streams says whether it is thinking or writing its reply"
- A2. `test/cli-doing.test.mjs` › "a tool says what kind of work it is, and the step after it is thinking again"
- A3. `test/cli-doing.test.mjs` › "a retry and a compaction say so, and anything else keeps the word it had"
- A4. `test/cli-event-recording.test.mjs` › "what a turn is doing reaches the screen in a word, and goes when the turn ends"
- A5. `test/cli-ui.test.mjs` › "while the main agent works, the row above the input says what it is doing and for how long"

## Steps
- [x] S1 (A1, A2, A3). The word: one function from an event of the turn to a word.
- [x] S2 (A4). Hold the word in the runtime and carry it on the snapshot.
- [x] S3 (A5, A6). The row above the input.
- [x] S4 (A5). Say it in the guide and the changelog.

## Open questions
- Thinking is the word before the first event and again after every tool. Should the wait before the first event read differently?
- Should the row also say what a work agent is doing, or stay about the main agent?
