---
{
  "id": "022-questions",
  "title": "Questions from hobkin",
  "kind": "work",
  "status": "doing",
  "depends": ["001-foundation", "019-keyboard"],
  "updated": "2026-11-13"
}
---
# Questions from hobkin

## Outcome

When hobkin needs an answer, for itself or on behalf of a routine or an agent, the question gets a surface of its own. A sheet rises from the bottom of the window, the way an input does. Everything behind it blurs, so the question reads the same over any screen. The question sits at the top of the sheet with its choices under it. The user picks the best one or types an answer of their own.

## Decisions

- The sheet is a third surface, apart from the chat and the canvas. It spans the bottom of the window, centered, and covers neither side completely.
- Behind it the whole window blurs and darkens a little, in the same movement as the sheet rising. The blur's radius animates, as in the veil, so it never pops in.
- On the sheet, from the top: who asks (hobkin, or the routine or agent it asks for), the question in the heading face, one line of summary when hobkin gave one, the choices as numbered rows, and a field for another answer. The choice hobkin recommends is marked, with its reason.
- Keys: a number picks that choice at once. Up and Down move through the choices and into the field. Enter picks the selected choice, or sends the field's text when it has any. Typing a letter anywhere goes to the field. Escape puts the question off.
- A question put off, or left for 30 seconds, moves to Action Items, as in hobkin's terminal app. A thin line at the top of the sheet shows the time left. While the user is choosing or typing, the time does not run.
- That holds for hobkin's main agent too (2026-11-12, replacing a put-off question that the main agent was told was cancelled and that nothing kept). hobkin files it as an item of kind `chat`, from hobkin, with its words and choices. It never rises on the sheet again, and an answer there, a choice or the user's own words, reaches the main agent in Chat with the question. Asked again and answered on the sheet, the waiting item closes too. A stopped turn or a quit puts nothing off.
- While the first-run setup or its tour is open the sheet steps aside (2026-11-13, `025-onboarding`): the frame under them is out of reach, so the sheet shows nothing and its 30 seconds do not run. Once both are closed it shows what waits, with its whole wait.
- With several questions waiting, one shows at a time, with "1 of 3".
- An answer drops the sheet away. hobkin records it in the conversation in one line, as it does today.
- The question's data and the answer travel through the host: hobkin's `askQuestion(request, signal)` on one side, the UI's sheet on the other. Until the host supplies questions, a sample question can be raised from the Action Items screen.

## Out of scope

- Questions with more than six choices. hobkin allows two to six.
- Answering by voice.

## Acceptance

- A1. A question raises the sheet from the bottom of the window within 300ms of arriving, and the screen behind blurs in the same movement. The question and every choice are readable over the conversation, the canvas and an open review, in both themes.
- A2. Pressing a choice's number, clicking it, or moving to it and pressing Enter answers with that choice, and the sheet leaves.
- A3. Text typed into the field and sent with Enter answers with that text. An empty field sends nothing.
- A4. Escape, or a click outside the sheet, puts the question off: the sheet leaves and the question is under Action Items with the same choices.
- A5. Left alone for 30 seconds, the question moves to Action Items. While the user moves through the choices or types, the 30 seconds do not run.
- A6. With two questions waiting, the sheet shows "1 of 2", and answering the first brings up the second.
- A7. While the sheet is open, the frame's own keys (Tab, Cmd keys, Down into the agents) do nothing, and they work again when it closes.
- A8. With reduced motion, the sheet and the blur appear and leave with a fade and no travel.
- A9. While the first-run setup or its tour is open, the sheet shows nothing and its 30 seconds do not run. Once both are closed it shows what waits, with its whole wait.

## Proof

- A1. check: raise the sample question over each screen in both themes.
- A2. `ui/test/questions.test.ts` › "a number, a click or Enter answers with the choice"
- A3. `ui/test/questions.test.ts` › "typed text answers, and an empty field does not"
- A4. `ui/test/questions.test.ts` › "putting a question off sends it to action items"; for the main agent's questions, hobkin's `test/cli-questions.test.mjs` › "a question the user puts off, or leaves until its time runs out, waits in Action Items with its words and choices" and "a question put off is answered in Action Items, and the main agent hears the answer in Chat with the question"; a quit, `host/test/questions.test.ts` › "a host that closes takes its question away as no answer, and does not put it off"
- A5. `ui/test/questions.test.ts` › "the time runs only while the user is idle"
- A6. `ui/test/questions.test.ts` › "questions show one at a time, in order"
- A7. `ui/test/keys.test.ts` › "a dialog or menu that owns the keyboard keeps every key"
- A8. check: reduced motion on, raise the sample question.
- A9. `ui/test/questions.test.ts` › "while the first-run setup or the tour covers the window the sheet shows nothing, and it comes back with a fresh wait". That the clock does not run behind them: check, with `025-onboarding` A60. Not seen.

## Steps

- [ ] S1 (A2, A3, A4, A6). The question queue and its rules, with tests.
- [ ] S2 (A1, A7, A8). The sheet: rise, blur, layout, both themes.
- [ ] S3 (A2, A3, A4, A5). Keys, the field, and the 30 seconds.
- [ ] S4 (A1, A4). Questions and answers through the host, and the hand-off to Action Items.

## Open questions

- hobkin ends a question's wait after 30 seconds on its own clock (`src/cli/application.mjs`). Holding the time while the user types needs hobkin to let the front end ask for more time. Until then the sheet can only hold its own display, and an answer sent after hobkin's 30 seconds must be routed as an Action Items answer.
