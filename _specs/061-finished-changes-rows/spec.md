---
{
  "id": "061-finished-changes-rows",
  "title": "Finished changes as rows that open",
  "kind": "work",
  "status": "doing",
  "depends": ["011-work", "053-work-control-room", "060-make-it-a-stack"],
  "updated": "2026-11-24"
}
---
# Finished changes as rows that open

## Outcome

A finished change on Work is a short row: what it is, the one sentence that says why it waits for the user, a few facts, and the one action that fits it. Fourteen of them fit where two cards stood. A row opens in place to everything a card held, laid out in two columns so no line runs the width of the page. Nothing a card could do is lost.

The user, 2026-11-24, with a picture of two "Left for you" cards filling a screen, out of fourteen: "too much information here, i need this reorganized, so information is easily consumed, this can have a much better UX/UI, occupying less space. lets think deeply on this".

## Decisions

### What was wrong

- A card was about 700 pixels tall. Fourteen of them are a scroll of 10,000 pixels.
- Everything had the same weight: what it did, the note, the size, the proof, why it is in its group, and what a yes does, each a paragraph the width of the page, up to 180 characters a line.
- The reason a card was there came fifth. On a "Left for you" card that is the note, which is the only thing the user has to read.
- Two lines were the same on every card of a group: why it is in the group, and what closing it does. The group's heading already says the first.
- A card showed four or five buttons whatever the user was there to do.

### What the user is there to do

- Sort through the list: for each change, see what it is and what it needs, then act or move on. Most are decided from one sentence. A few need the proof.
- So a row carries what decides most of them, and the rest is one press away.

### A row

- Three lines at most, in this order:
  1. A quiet line of facts: the project, its issue, its size, how far behind it is, its checks and its pull request, which opens on GitHub from here.
  2. The title, on one line, with the priority before it and the review's state after it.
  3. (Replaced by spec 066-work-one-list: one sentence by what matters for the change, not by group.) The sentence that matters for its group, on two lines at most: in "Left for you" the note its run left, marked as the agent's words; in "Needs you" why it needs the user; in the other groups what the change did.
- At the right, the one action that fits its group, then the way to open the row: in "Left for you" Answer, which opens the row with the reply box under the note; where it can merge, its yes, in the words it has today; where neither applies, Review.
- A row's height does not change while it is closed, whatever happens to it.
- What a yes does is the button's own tooltip, and is in the open row.
- Model checks are one small chip in the facts line, with their count, and each check is in the open row.

### An open row

- It opens in place, under its own three lines, which do not move. What is under it moves down once.
- Two columns where the page is wide enough, one where it is not. On the left, what the change did, whole, and the note, whole, with the reply box under it when the user answers. On the right, the proof on four lines with Show all, the review's scores, the proof check and each model check.
- Under both, one quiet line with why it is in its group and what a yes does, then every action the card had, in the order it had them.
- Opening a row closes no other. A row stays open until it is closed or leaves.

### Keys and presses

- Enter on a row, and a press on it, open it in Change Review, as on a card.
- Space opens and closes the row. So does its chevron, which Right reaches with the row's other controls.
- Up and Down walk rows as they walk cards. Left and Right walk a row's controls: closed, its one action, its pull request and its chevron; open, every action.

### Stacks and groups

- A stack keeps its one quiet heading. Its bottom layer is a row like any other, with "1 of 5" before its title, and the layers above stay one line each. A layer's line opens as it does today.
- A group keeps its heading, its count and its one yes. (Replaced by spec 066-work-one-list: Work has no groups, no group sentence and no group yes.)
- The lines that say what hobkin answered, and a refusal, stay where a card had them.

## Out of scope

- A second pane beside the list that shows the selected change.
- Sorting or filtering the rows.
- The rows of the queue, of AI Reviews and of the projects list.
- Keys of their own for a row's actions.

## Acceptance

- A1. A closed row has its facts, its title on one line with its priority and its review's state, the sentence for its group on two lines at most, the one action for its group and the chevron. A change with no note, no size or no issue leaves that part out and keeps the rest in place.
- A2. The sentence is the run's note in "Left for you", the reason in "Needs you", and what the change did elsewhere. The action is Answer in "Left for you", the change's own yes where it has one, and Review otherwise.
- A3. An open row shows what the change did and the note whole, the proof on four lines with Show all, the scores, the proof check and the model checks, why it is in its group and what a yes does, and every action a card had. Its first three lines stand where they stood.
- A4. Answer opens the row with the reply box under the note and the keyboard in it. Sending does what Ask for changes did.
- A5. Enter and a press open the change in Change Review. Space and the chevron open and close the row. Up, Down, Left and Right walk rows and their controls.
- A6. Fourteen closed rows of "Left for you" take less height than three of the cards they replace.
- A7. A stack's bottom layer is a row with its place before its title, the layers above are one line each, and a group keeps its heading and its one yes.

## Proof

- A1. `ui/test/work-change-row.test.ts` › "the facts come in order: project, issue, size, behind, the pull request, its checks, then the model checks as one count" and › "a part a change does not have leaves the others in place"; check (2026-11-24, still renders at 1300 and 760 pixels, dark and light): six closed rows of "Left for you".
- A2. `ui/test/work-change-row.test.ts` › "the sentence is the run's note in Left for you, the reason in Needs you, and what the change did elsewhere", › "a change with nothing of its own to say falls back to its reason, and with no reason has no sentence" and › "the action is Answer in Left for you, the change's own yes in its own words where it has one, and Review otherwise"
- A3. check (still renders): the second row open in two columns at 1300 pixels and in one at 760, and a row of the group that can merge open.
- A4. check (a still render): Answer pressed, with the reply box under the note. The press itself and the keyboard landing in the box were not run.
- A5. `ui/test/work-change-row.test.ts` › "Space opens and closes the row, Enter opens it in Review, and a key meant for a control inside it, such as the reply box, is not the row's". The walk with Up, Down, Left and Right was not run: the rows carry the marks the cards had.
- A6. Measured in the still renders at 1300 pixels: a closed row is about 105 pixels, so fourteen are about 1,500, against about 2,100 for three of the user's cards of 700.
- A7. `ui/test/work-change-row.test.ts` › "a layer's place goes before its title, and a change in no stack has none"; `ui/test/work-stacks.test.ts`; check (a still render): the stack of five with its bottom layer as a row and layer 3 open.

## Steps

- [x] S1 (A1, A2). The row's model: its facts, its sentence and its action by group. 484e089.
- [x] S2 (A1, A3, A4, A5, A6). The row and the open row in place of the card. 9935994, and a line height of whole pixels for the sentence after it. Seen in still renders only: no press, key or motion was run.
- [x] S3 (A7). Stacks and groups with rows. 9935994. A layer's line opens to the open row without its closed lines repeated.
- [ ] S4. In the app's window, with the user's own fourteen.

## Open questions

- A second pane. The list on the left and the selected change pinned on the right, as a mail app does, would let Up and Down change what is read with no control moving at all. It costs the Work page its single column and needs its own fallback for a narrow window.
