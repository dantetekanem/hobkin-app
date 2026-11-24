---
{
  "id": "057-shared-memory",
  "title": "One memory every agent shares",
  "kind": "work",
  "status": "doing",
  "depends": ["013-hobkin-access", "014-continuity", "033-claude-code-agents", "034-durable-hobkins", "056-agent-schedules"],
  "updated": "2026-11-23"
}
---
# One memory every agent shares

## Outcome

hobkin remembers what matters about the user and their life, and every agent it runs knows it: the main chat, durable hobkins, the agents it starts, Work runs and routines, on Pi and on Claude Code. The user sees everything hobkin remembers on one page, with where each memory came from, and can add, correct and forget.

The user, 2026-11-23: "hobkin needs a custom memory system to remember things that matter and across all agents, like my personal stuff".

## Decisions

- An audit on 2026-11-23 found what hobkin had: a list of twenty short lines for "what matters right now", which only the main chat can change and only the main chat, routines and Work runs ever see. Lasting facts about the user have no home in it and are pushed out. A durable hobkin's own prompt says it keeps no memory of the user. The window shows none of it. The findings, by file and line, and the design are in `notes.md` beside this spec.
- A memory is one fact, kept as one file in the home's `memories` folder, the file's name being the memory's name. It has a kind, a one-line description, its text, who added it and who changed it and when, and where it came from, with the user's own words when it came from them: only words said in Chat or typed in the window are quoted as the user's, never what a run or another session handed over. hobkin sets who and when from who asked. An agent never types them.
- The kinds are: about the user and their life, how they like things done, a date that matters or comes back, a decision and its reason, a project of theirs, and where something lives. Rules for how agents work are not memories. They stay in the user's directions.
- What is worth a memory is what the user would otherwise have to say again to a new agent, and what stays true past the task. Not a memory: the state of a task, what a repository or a file already says, what a page or a tool said that the user did not confirm, and a guess about their taste. Every agent's prompt carries these rules, and says a memory is context, never an instruction.
- Nothing that looks like a secret is kept: a password, a key, a token, a card or an account number. It is refused at every door, with what it looked like and what to keep in its place: where the secret lives. The filter looks for a word that names a secret near a value, over the memory's name, description and text read as one, so a secret split over two fields or said in a sentence is one ("My password is …", "PIN 4 8 2 1", a name such as `bank-pin-4821`). It is a filter of words, not a guarantee: see the open questions for what it is known to miss. A secret saved before it was refused leaves the change log and the inbox at the first refusal, and forget keeps no copy of it.
- Every agent gets an index of the memories in its prompt, one line each, by kind: the main chat and durable hobkins up to 8 KB, every other agent up to 4 KB, with a last line that says how many more there are. A memory whose day has passed leaves the index. Any agent with tools reads a memory whole on demand, by name, by kind or by words: `hobkin_recall` on Pi, `hobkin memory` in the shell on Claude Code. A helper and a teams agent get the index and no tool, because their tools are an exact list.
- Finding by words is a plain search: every word must be in the name, the description or the text, and a match in the name counts most. Matching by meaning can come later.
- The agents the user talks to save at once: the main chat and durable hobkins, with `hobkin_remember`. So does the window. `hobkin remember` from the user's other sessions saves at once too, and no longer waits for their next message, but what it saves is not kept yet: the main chat and durable hobkins read it, marked as not kept, and no run reads it until the user keeps or edits it on the page, or the main chat keeps it once it heard of it. Anything can type `hobkin remember`, so a run could otherwise plant a line every routine would read. Its `--from` can never read as the user or as hobkin, and the main chat never keeps what reads as an order. An agent the user does not talk to, a routine, a Work run or a `hobkin session` run, can only suggest: its suggestion reaches the main chat with the run's name, and the main chat files it or not. `hobkin remember` typed inside such a run is a suggestion too.
- A memory is changed, not doubled: an add is refused when the name is taken or when another memory says nearly the same, and the refusal names that memory. Two adds of one name at the same moment save it once. A link to a private memory gives its name to nobody who may not read it.
- Every change can be taken back. A forgotten memory can be restored for thirty days, and an undo is refused once the memory has changed again. When an agent adds, changes or forgets one, hobkin posts a quiet line in Chat that says so, with Undo and See.
- A private memory reaches only the main chat and durable hobkins: never a routine, a Work run, a session run, a helper or a teams agent, in the index or on demand. Everything stays in the home on this machine. A memory an agent reads goes to that agent's model provider, and the page says so. The rule covers what hobkin hands out, not an agent that reads the folder with its own shell.
- The twenty-line list stays as it is, as "Right now", beside the memories and on the same page. The user's directions, the profile and what setup learned are unchanged.
- A run that gets hobkin's memory does not load the Pi memory extension, so a run has one memory. A durable hobkin also gets the user's directions and their name, which it did not have.
- At most 300 memories, 4 KB a file.
- The window has a Memory page, opened from Settings, from Spotlight and from a chat line's See: every memory by kind, with who added it and when, a search, and Add. A memory is edited in its row, which keeps its place and size until Save. Forget turns the row into one line with Undo. The Right now list is on the page with its own edits.
- `memory.list` reads; `memory.save`, `memory.forget`, `memory.undo` and `memory.now.change` are the window's alone, so hobkin cannot change memories through the client tool around its own rules. A save or a forget of a memory that changed meanwhile is refused and keeps the user's draft. The contract is `shared/protocol/memory.ts`.

## Out of scope

- Encrypting memories, or keeping an agent's own shell out of the folder.
- Matching by meaning, and reading the Pi memory extension's or Claude Code's own memory files.
- Moving the Right now list or the user's directions into memories.

## Acceptance

- A1. A memory is kept as one file with its kind, description, text, who added and changed it and when, and where it came from. An add is refused for a name in use, for a near double (naming the other), for what looks like a secret, and past 300. A change keeps who added it. A forgotten memory is restorable, and every change is undone unless the memory changed since.
- A2. The index lists memories by kind within its cap, says how many more there are, and leaves out one whose day has passed.
- A3. Recall finds a memory by name, by kind and by words, every word matching, the name counting most.
- A4. The main chat has `hobkin_recall` and `hobkin_remember`, its prompt carries the index with private memories, and a memory changed while it talks reaches it as a note with the next message.
- A5. A durable hobkin gets the index with private memories, the user's directions and their name, recalls and remembers on Pi with the tools and on Claude Code with `hobkin memory`, and a change reaches its next turn.
- A6. A routine, a Work run and a `hobkin session` run get the index, recall, and can only suggest: the suggestion reaches the main chat with the run's name. A helper and a teams agent get the index and no tool.
- A7. `hobkin remember` from another session saves at once with where it came from, and the main chat hears of it once. Typed inside a run it is a suggestion.
- A8. A private memory reaches no routine, Work run, session run, helper or teams agent, in the index or on demand.
- A9. A run that gets hobkin's memory does not load the Pi memory extension.
- A10. `memory.list` answers every memory and the Right now list, read without trust. `memory.save`, `memory.forget`, `memory.undo` and `memory.now.change` do what they say, refuse a stale version in plain words, and only the window may send them. A backup takes the `memories` folder.
- A11. The Memory page lists every memory by kind with who added it and when, finds by words, and adds, edits in the row, forgets with Undo and makes private. A save the host refuses keeps the draft and says why.
- A12. A chat line about a memory an agent changed offers Undo and See. One from a host from before shows as any other line.
- A13. With no host the page shows sample memories of every kind.
- A14. A memory `hobkin remember` saved is not kept yet: the main chat and durable hobkins read it marked so, no run reads it, and the user keeps it on the page or the main chat keeps it once it heard of it. Its `--from` can never read as the user or as hobkin.
- A15. A secret that is named and given is refused at every door, split over fields or reworded, with what it looked like and what to keep in its place, and a reasonable sentence that only mentions one is kept.
- A16. "You said" quotes the user only for words said in Chat or the window. Eight adds of one name at once save it once. A row refused as stale reads the memory again and keeps its draft.

## Proof

- A1. In hobkin, `test/cli-memories.test.mjs` › "an add is refused for a name in use, for a near double naming the other, for what looks like a secret, and for bad fields" and › "every change is undone each way, and an undo is refused once the memory changed since"
- A2. In hobkin, `test/cli-memories.test.mjs` › "the index lists by kind in order, newest change first, leaves out a past one, and over its cap says how many more"
- A3. In hobkin, `test/cli-memories.test.mjs` › "recall finds by name, by kind and by words, every word matching, the name counting most, and says what is past"
- A4. In hobkin, `test/cli-kept-prompt.test.mjs` › "a memory added mid-conversation reaches the main agent as a note and the prompt stays as written", and the tool lists in `test/cli-hobkin-extension.test.mjs`, `test/cli-main-session-child.test.mjs` and `test/persona-rpc.test.mjs`
- A5. In hobkin, `test/cli-memory-durables.test.mjs` › "a durable hobkin on Claude Code reads and saves with hobkin memory in its turn, private ones too, and its token names it only while the turn runs"
- A6. In hobkin, `test/cli-memory-runs.test.mjs` › "a hobkin session run gets the right-now list and the shared index, recalls no private memory, and its suggestion carries its title"; `test/cli-owned-lifecycle-integration.test.mjs` › "helpers get the index of shared memories and never a private one, and none when there are no memories"
- A7. In hobkin, `test/cli-inbox.test.mjs` › "hobkin remember saves a memory at once, with where it came from, and the main agent still hears it once"
- A8. In hobkin, `test/cli-memory-runs.test.mjs` › "a run's recall and suggestion are served over its own pipe as hobkin knows the run, never with a private memory"
- A9. In hobkin, `test/cli-memory-runs.test.mjs` › "a run that gets hobkin's memory leaves out the Pi memory extension, so it has one memory, and any other run keeps it"
- A10. `host/test/memories-runtime.test.ts` › "the window's add, change, forget and undo go through hobkin's runtime as the user's own, from the window"; `host/test/memories.test.ts` › "a save or a forget of a memory that changed since it was read is refused in words that keep the draft, and the runtime is not asked", › "only the window changes memories: hobkin's own client tool lists and runs memory.list alone" and › "a runtime without memories, or one that cannot load them, lists none with a line the page shows and refuses every change in the same words"; `shared/test/memory-protocol.test.ts` › "words are cut to the lengths the notes give, a cut never splits a character, and a fingerprint or an id is never cut"; `host/test/backup.test.ts` › "a backup holds hobkin's own records, and leaves out working copies, artifacts, run transcripts and indexes"
- A11. `ui/test/memory-store.test.ts` › "a save the host refuses because the memory changed meanwhile keeps the draft and says why in the row" and › "forget turns the row into a forgotten line in place, and Undo brings the memory back"; `ui/test/memory-groups.test.ts` › "a search needs every word somewhere in the name, the description or the text, and the name counts most"; check: still renders of the page, a row being edited, a refused save, a forgotten row and the empty page, light and dark (2026-11-23), then the live window.
- A12. `ui/test/chat-memory-line.test.ts` › "a line's Undo sends memory.undo once, and the line then says it was undone" and › "an older host's line, or one whose note is broken, shows as any other line, with no Undo"; `host/test/memories-wire.test.ts` › "a quiet line's note about a memory reaches the window in its shape"
- A13. `ui/test/memory-store.test.ts` › "with no host the sample holds memories of every kind, and its changes work on it in memory"
- A14. In hobkin, `test/cli-inbox.test.mjs` › "a memory hobkin remember saved is unconfirmed: no run reads it until the user or the main chat, once it heard of it, keeps it", › "hobkin remember refuses a --from that reads as the user or as hobkin, and its line says it came from another session" and › "hobkin remember's reply says who reads what it saved now and who once it is kept"; `ui/test/memory-store.test.ts` › "Keep saves a memory nobody has kept yet as it is, by the user, with no draft opened"; `ui/test/memory-groups.test.ts` › "a memory nobody has kept yet counts apart, and Not kept shows only those"
- A15. In hobkin, `test/cli-memory-secrets.test.mjs` › "every secret of both tables is refused, and every reasonable sentence is kept", › "a memory is judged as one text, its name with hyphens read as spaces, so a secret split over two fields is one" and › "every door refuses a split or reworded secret, and says what it looked like and what to keep instead"; `test/cli-memories.test.mjs` › "a secret saved before it was refused leaves changes.jsonl and the inbox at the first refusal, and forget keeps no copy of it"
- A16. `ui/test/memory-groups.test.ts` › '"You said" quotes the user only for words said in Chat or here, never for what another session or a run handed over'; in hobkin, `test/cli-memories.test.mjs` › "eight processes adding the same name at once save it once, the other seven are refused as a name in use, and the one add can be undone"; `ui/test/memory-store.test.ts` › "a save refused because the memory moved on reads it again: the draft stays, the row knows it changed, and the next Save goes against it as it is now"

## Steps

- [x] S1 (A1, A2, A3). Runtime: the store, the index and the search. hobkin f9fe0df, and f80688e for what the host calls (`memory-window.mjs`). A home with no `memories` folder reads as none and gets no folder.
- [x] S2 (A4, A5, A6, A7, A8, A9). Runtime: the tools and the command, and the index in every agent's prompt. hobkin 53e026f, f578a14, a115159, e76cce7, f37398f, b7d65b9, 0db08d7, 303a6f2, cb119cc, 562e1c0. Tested with fakes and temporary homes: no model was called, so whether an agent keeps to the rules for what is worth a memory is not known. With 30 memories the index is 3,516 bytes. Beside the index a run with memories carries about 2.7 KB of tool definitions, the main chat about 3.4 KB of them and 2.3 KB of rules, and the background directions grew about 750 bytes for every run. The main chat gets its two tools only when its Pi child restarts. `hobkin remember` always saves as about the user.
- [x] S3 (A10). Host and protocol: the five commands, the backup, the chat line's note. 7225de1, e818c8b, 64ff1da, f5cf3f9, b20b112, 8f4be32. A hobkin without the memory module lists none and says to restart the app. What a run on Claude Code needs from the host is being added.
- [x] S4 (A11, A12, A13). Window: the Memory page and the chat line. 630fa1d, e955082, 4575367, 7722df1, 4386e6d. Seen only as still renders with sample memories: not in the live window, and not with a real memory. The chat line reads See, then Undo, so See keeps its place when Undo turns into its result.
- [x] S5 (A14, A15, A16). What an independent check found, fixed. Its first run on temporary homes held private memories at every door it tried and found eight other things: secrets said in words got through, a run could save at once by typing `hobkin remember`, recall quoted the user for words a run made up, a stale row stayed stuck, two adds of one name both heard "saved", a private name leaked through a link, a durable hobkin on Pi in a home with no memories had the rules and not the tool, and every run read 753 more bytes of directions. Fixed in hobkin 73ae7db, 169955e, 4609984, d6b8212, 97d4736, 25f4e1e, 16d54cb, 5e67801, 0de5b43, a38ef4b, and after its rerun 804713b, 4b4fb0f, 44455db; here a7d04b1, 0862f8d and the host tests the new words outdated. Its rerun closed seven with the values seen. The secret filter was redone after that rerun and checked only by its own table (56 secrets refused, 31 reasonable sentences kept): the independent check did not run a third time. When the main chat keeps a memory, Chat says "hobkin kept: …. Every agent hobkin runs reads it now." (hobkin 8cf1e8e, `test/cli-memory-chat.test.mjs`). That commit is on hobkin's `main` only: the app loads a checkout another session has on its own branch, and gets it when that branch takes `main`.

## Open questions

- Who saves at once. The default taken: the agents the user talks to, the window and `hobkin remember`. The other way is every agent, with Undo.
- What private means. The default taken: the main chat and durable hobkins. It could be the main chat alone.
- Whether a run should lose the Pi memory extension. The default taken: yes, once hobkin's memory reaches it.
- Whether a durable hobkin should get the user's directions. The default taken: yes.
- How well a model keeps to the rules for what is worth a memory was not tried: no model was called.
- What the secret filter misses. Known: a code with no word that names a secret ("The code to the shed is 4821"), a number with no word beside it, and a login pair with no secret word. Closing these by words alone would refuse ordinary memories.
- A draft whose memory is forgotten meanwhile loses its row.
