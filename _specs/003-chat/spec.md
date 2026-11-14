---
{
  "id": "003-chat",
  "title": "Conversation with hobkin",
  "kind": "work",
  "status": "doing",
  "depends": ["002-host"],
  "updated": "2026-11-14"
}
---
# Conversation with hobkin

## Outcome

The conversation column is the real, persistent hobkin conversation. The user reads the history, sends messages with images, watches the reply arrive, stops a turn, and answers hobkin's questions. The avatar beside the input reacts to what hobkin is doing.

## Decisions

- History, sending, steering and stopping use hobkin's application methods unchanged (`send`, `interrupt`, `clear`, `reset`). hobkin stays the owner of the conversation and its file.
- Live text comes from the `turn` events of `002-host`. The stored message replaces the live text when the turn ends.
- A reply being written shows its finished lines, and the line still being written up to its last whole word (`ui/src/features/chat/stream-buffer.ts`). It grows by at most one step every 100 ms, and its first step shows at once. What would draw as something else once more arrives waits. A blank line waits for what follows it. A code block's opening waits for its first word of code. A table's lines show only once whole, and its header only with its divider. A heading, list item or quote waits for its first word. An emphasis, code span or link that is still open holds back the rest of its line until it closes or the line ends. A new block rises once and new words fade in once, so what already shows stays still.
- Tool calls and thinking are not printed in the conversation. The line above the input says what hobkin is doing, with the elapsed time, as the terminal app does (`src/cli/doing.mjs`). A click on that line opens the turn's activity on the canvas.
- Markdown is rendered with a sanitizer. Raw HTML shows as text. Code blocks use the Shiki setup from `008-review-code`.
- Images are pasted, dropped or picked with a button, and sent as bytes. hobkin's limits on count and size apply.
- The input grows with its text. Enter sends and Shift+Enter adds a line.
- Ctrl+Option+P opens full prompt focus: a large editor over the window that takes the current draft, modeled on pi-prompt's prompt editor (`~/Poetry/pi-prompt/README.md`). In it, Enter adds a line, Ctrl+Enter sends, Escape asks whether to keep the draft or discard it, and Ctrl+Option+P returns the text to the small input.
- The prompt editor shows the Markdown it will send, rendered live beside the text.
- Down in an empty input moves the keyboard to the running agents under it (`011-work`).
- A message that starts with a slash shows the commands in a short list above the input, on a blurred backing so it reads over the conversation. It shows five at most. With nothing typed after the slash they are the five the user runs most. As the user types, the list narrows to the commands that match, best match first.
- In that list Tab completes the input to the selected command, Up and Down move the selection, Enter runs it, and Escape closes the list and leaves the text. While the list is open the message input is a combobox with its list expanded, which is how the frame knows to leave Tab alone (`019-keyboard`).
- The commands are hobkin's own (`/setup`, `/clear`, `/reset`, `/work`, `/learning`, `/feedback`, `/help`) and whatever Pi reports for the session (prompt templates, skills, extension commands). Each shows its name and one line on what it does. How often each is run is counted in the home, so the most used follow the user to the terminal app's data.
- A question from hobkin opens as a card above the input for 30 seconds, then waits under Action items. This is hobkin's rule (`src/cli/decisions.mjs:7`).
- The avatar's mood is the `mood` in hobkin's snapshot. Pointer reactions are handled in the UI with the same rules as `src/cli/face-reactions.mjs`.
- Slash commands (`/setup`, `/clear`, `/reset`, `/work`, `/learning`, `/feedback`) behave as in the terminal app.

## Out of scope

- More than one conversation. Earlier sessions are read-only in the sidebar's History section (`014-continuity`).
- Voice.

## Acceptance

- A1. The conversation shows hobkin's stored messages grouped by day. It opens at the newest message.
- A2. While a reply streams, text appears as it arrives. The view stays pinned to the bottom unless the user has scrolled up, and a control then offers to jump back down.
- A3. The line above the input names what hobkin is doing (thinking, writing, working, researching, delegating, retrying, compacting) and the elapsed time. Esc pressed twice stops the turn, and so does Control+C at once: the first Esc only asks, and the line says "esc again to stop, or ctrl c" (changed by the user on 2026-11-12, since one press stopped runs by mistake). Any text that was queued but not sent returns to the input.
- A4. A message sent while a turn is running is shown as queued, steers the turn, and loses the queued mark once hobkin accepts it.
- A5. Notices from background runs appear with their tone (critical, blocked, useful, quiet). Identical notices in a row collapse into one with a count.
- A6. A question from hobkin shows its numbered choices and a field for another answer. A number key or a click answers it. After 30 seconds without an answer it leaves the conversation and appears under Action items.
- A7. A pasted or dropped PNG, JPEG, GIF or WebP shows as a thumbnail that can be removed before sending, and the model receives it. A file over hobkin's limit is refused with the limit in the message.
- A8. Markdown renders headings, lists, tables, links and highlighted code. A link opens in the system browser. A message that contains `<script>` or an inline event handler shows it as text and runs nothing.
- A9. The avatar's mood changes with hobkin's, and clicking or hovering it triggers the reactions listed in `000-product/design.md`.
- A10. When the host is read-only or disconnected, the input is disabled and says why.
- A11. The input grows from one line up to a maximum height as text is added, then scrolls. Enter sends, and Shift+Enter adds a line.
- A12. An image can be attached with a button as well as by paste and drop, and each attachment shows a thumbnail with a remove control.
- A13. Ctrl+Option+P opens the full prompt editor with the current draft and attachments. Ctrl+Enter sends from it. Escape offers to keep or discard the draft. Ctrl+Option+P again closes it and the small input holds the same text.
- A14. In the full prompt editor, the rendered preview shows headings, lists, tables, links and code blocks from the draft as the user types, and the sent message renders the same way in the conversation.
- A15. Typing a slash as the first character shows a list above the input with at most five commands, each with one line on what it does. With nothing after the slash they are the five most used, most used first. A slash later in the text shows nothing.
- A16. Typing after the slash narrows the list to matching commands, best match first. With no match the list says so and Enter sends the text as a message.
- A17. With the list open, Tab completes the input to the selected command and the screen does not change. Up and Down move the selection, Enter runs the selected command, and Escape closes the list with the typed text left in the input. With the list closed, Tab changes the screen again.
- A18. Running a command adds to its count, and the count survives a restart.
- A19. A message that arrives while the user is looking rises into place on the same spring as the pieces of a canvas screen, and the messages above make room without a jump. Each new block of a streaming reply rises the same way, and text inside a block appears smoothly as it grows. History that was already there when the app opened does not move.
- A20. A reply's first whole word shows within one step of reaching the window, before the reply ends, and the reply then grows a few words at a time, the line still being written included. A code block's opening, a table's header before its divider, a heading or list item with no word yet, and an emphasis, code span or link still open never show half drawn. Words already shown do not rise or fade in again as the reply grows, and the view keeps following it.

## Proof

- A1. `ui/test/conversation.test.ts` › "groups stored messages by day"
- A2. `ui/test/conversation.test.ts` › "applies deltas to the open message and replaces it with the stored one"
- A3. `host/test/chat.test.ts` › "interrupt returns unsent text"
- A4. `host/test/chat.test.ts` › "a send during a turn steers it"
- A5. `ui/test/conversation.test.ts` › "collapses identical notices"
- A6. `host/test/questions.test.ts` › "a question times out to action items and an answer resolves it"
- A7. `host/test/images.test.ts` › "passes image bytes to the model and refuses oversize files"
- A8. `ui/test/markdown.test.ts` › "renders markdown and neutralizes html"
- A9. check: in the browser, run the scripted moods and poke the avatar.
- A10. check: stop the host. The input disables and names the reason.
- A11. check: type and add lines until the input stops growing, then send with Enter.
- A12. `host/test/images.test.ts` › "an attachment picked with the button reaches the model"
- A13. `ui/test/conversation-draft.test.ts` › "the draft and attachments move into the prompt editor and back"
- A14. `ui/test/markdown.test.ts` › "the preview and the sent message render the same markdown"
- A15. `ui/test/conversation-slash.test.ts` › "an opening slash lists the five most used, and a later slash lists nothing"
- A16. `ui/test/conversation-slash.test.ts` › "typing narrows to the best matches"
- A17. `ui/test/conversation-slash.test.ts` › "tab completes, enter runs, escape keeps the text"
- A18. `host/test/commands.test.ts` › "running a command counts it, across restarts"
- A19. check: send a message to the scripted model and watch the reply stream in. Reload and see the history stay still.
- A20. `ui/test/stream-buffer.test.ts` › "the line still being written shows up to its last whole word", "a paragraph grows a word at a time, and what showed stays", "a heading, list item or quote waits for its first whole word", "a code block waits for its first word of code, then grows as it arrives until it closes", "a table appears with its header and divider together, then a whole row at a time", "emphasis, code and links still open hold the rest of their line back", "no character is lost and the order holds, however the text arrives"; check: ask for a one paragraph answer and watch its first words show before it ends, the earlier words stay still while new ones fade in, and the view follow it. Not yet seen.

## Steps

- [ ] S1 (A1, A2, A5, A19, A20). Message list fed by the state store: day groups, notices, live text, scroll pinning, and messages that rise in as they arrive.
- [ ] S2 (A3, A4, A10). Input: send, queue and steer, stop, the doing line, disabled states.
- [ ] S3 (A8). Markdown renderer with sanitizing and code highlighting.
- [ ] S4 (A6). Question card and its hand-off to Action items.
- [ ] S5 (A7). Images: paste, drop, thumbnails, upload. hobkin branch `client-host`: accept image bytes without the clipboard.
- [ ] S6 (A9). Avatar wired to the snapshot's mood, plus pointer reactions.
- [ ] S7 (A11, A12). The growing input and the attach button.
- [ ] S8 (A13, A14). Full prompt focus with its live Markdown preview.
- [ ] S9 (A15, A16, A17, A18). The slash list: commands from hobkin and Pi, most used first, matching, completion, and the count.
