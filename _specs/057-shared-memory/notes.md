# Notes for spec 057: what the audit of 2026-11-23 found, and the design

A read-only audit of hobkin's runtime (`~/Poetry/hobkin`), of this app and of the two memories the user already uses, made on 2026-11-23. Line numbers are of that day. `[code]` was read in the code, `[test]` seen in a test run, `[inferred]` worked out. No home was read and nothing of the user's own notes is here: the examples are invented.


Read-only. Nothing in either repository was changed. No home, host, browser or model was used.
Tags: [code] read in the code, [test] seen in a test run here, [inferred] worked out, not seen.
Tests run: hobkin `test/cli-memory.test.mjs` 13/13 pass; `test/cli-inbox.test.mjs` + `test/cli-kept-prompt.test.mjs` 17/17 pass.
No content of the user's private notes is copied here, only shapes.

---

## 1. What hobkin keeps today

| Store | Where in the home | Format | Written by, when | Read by, when | Caps | Correct / forget |
|---|---|---|---|---|---|---|
| Memory list ("what matters right now") | `memory.md` | `- ` bullets, plain lines | main chat only, `hobkin_memory` add/replace/remove (`src/cli/memory.mjs:64-83`); user by hand | main chat system prompt every turn; routines and Work runs as the request's `memory` field | 20 items x 200 chars (`memory.mjs:12-13`), refuses add when full (`:55-57`), file 64 KB | replace/remove by exact text (`:59`); no undo, no history, no who/when/source |
| Directions | `AGENTS.md` | Markdown rules, 64 KB whole-or-nothing | main chat (file tools), user (Settings > Directions tile, `host/src/directions.ts`) | main chat, routines, Work, session runs, helpers, teams agents | 64 KB | edit the file |
| Profile | `profile.json` | name, callMe, email, computer | setup, `hobkin profile` (`src/cli/profile.mjs:13`) | as a line in front of the directions (`directions.mjs:22-23`) | 120 chars a field | `hobkin profile clear` |
| Setup facts | `setup.json` | up to 12 `{about, said}` | the app's setup | in front of the directions (`directions.mjs:22`, `setup-facts.mjs:5-6`) | 12 x 300 chars | setup again |
| Decided lately | from `decisions.jsonl`, `answers.jsonl`, card actions | lines | hobkin | main chat only, last 14 days (`decided.mjs:8-12`) | 20 lines, 4 KB | n/a |
| Check memory | `checks/<id>/memory.md` | free Markdown | that routine's own run | that routine's next run (`checks.mjs:79-86`) | 8 KB (background.md "Continuity") | the run, or the user by hand |
| Notes, taste | `notes/**/*.md` | free | main chat by file tools (`taste.md`) | main chat when it chooses; qmd | none | by hand |
| Lessons | `runtime/learning.json` -> `runtime/lessons.md` | lines | hobkin's learner | check requests (`learning`) | n/a | `hobkin learning clear` |
| Inbox (`hobkin remember`, `remind`) | `runtime/inbox.jsonl` | JSONL events | other sessions, by command (`inbox.mjs:118-137`) | main chat, with the user's next message, 10 at a time (`inbox.mjs:206-210`) | 1000 chars | none: the main agent files it into `memory.md` or `AGENTS.md` (`v2-runtime.md:167`) |
| Search | `runtime/.qmd` | qmd index over memory.md, checks, AGENTS.md, work directions, notes, lessons, answers (`memory-index.mjs:24-36`) | hobkin, when files go quiet 20 s | agents taught `qmd` (main `v2-runtime.md:117-123`, background `background.md:74-80`) | needs qmd installed; a missing qmd is one quiet line (`memory-index.mjs:261, 283`) | n/a |

The memory prompt itself sets the scope: "Keep a short list of what matters to the user right now ... Only hobkin uses this list" (`src/prompts/memory.md:3`), "commitments, deadlines, open decisions, things being waited on, and ongoing concerns" (`:7`), "Remove an item once it is resolved or stale. When the list is full, merge or remove the least important item" (`:11`). [code]

`v2-runtime.md:85` keeps AGENTS.md to behavior rules: "No dates, no quotes, no story", and "a one-off decision or the state of a task in memory". [code]

So a lasting personal fact (where the user lives, a date that comes back every year, how they like replies, a decision and why) has no home made for it: the 20-line list is told to drop it once it stops being "right now", AGENTS.md is for rules, the profile has four fields. [code + inferred]

## 2. What reaches each agent today

| Agent | Directions (with name line) | Memory list | Can write memory | How it runs |
|---|---|---|---|---|
| Main chat (Pi, always) | yes, every turn | yes, system prompt kept as written + `<hobkin-since>` notes (`prompt-parts.mjs`, `rpc-session.mjs:407-415`) | yes, `hobkin_memory` | `hobkin-extension.mjs:39-47` |
| Routine (Pi or CC) | yes, request `directions` | yes, request `memory` (`runner.mjs:361`, `context.mjs:52-53`) | no, "this job cannot change it" (`background.md:16`) | background.md system prompt |
| Work run (Pi or CC) | yes | yes (`work/director.mjs:994`) | no | background.md + work-*.md |
| `hobkin session` run (Pi or CC) | yes (`session-jobs.mjs:130`) | **no**: prompt is `{task, directions}` only, yet its system prompt is background.md, which talks of a `memory` field it never gets (`background.md:16`) and finds qmd's folder through `checkMemory.path` it never gets (`:74`) | no | background.md |
| Durable hobkin (Pi or CC) | **no**: its system prompt is durable.md + canvas + its id (`hobkins.mjs:71-73`); catalog lists only `durable`, `canvas` (`resource-catalog.mjs:37`) | **no**: "you keep no memory of the user" (`durable.md:3`) | **no**: `hobkin remember` refused inside a turn (`main.mjs:21, 178-180`, `durable.md:13`) | own conversation |
| Helper of the main chat | yes (`runtime.mjs:1142-1143`) | no | no | read/write role tools only (`owned-agent-extension.mjs:6-13`, `pi-extensions.mjs:87-91`) |
| Agents a run spawns with teams | yes (`agent-directions-extension.mjs:21-28`) | no | no | |
| Any run on Claude Code | what its request prompt holds; directions are `directions.md` + background/work prompt (`host/src/claude-code/route.ts:173, 213`, `directions.ts:9-12`) | only routines and Work, inside the request JSON | no | `--append-system-prompt` (`harness.ts:157`) |

Two more memories already run beside hobkin's, and they do not meet:
- `pi-memory` is left out of the main chat only and "stays installed and in every other run" (`src/cli/pi-extensions.mjs:13-17`; asserted by `test/cli-harnesses.test.mjs:806-819`). The user's Pi settings name it (counted, not read). So routines, Work, session runs and durable hobkins on Pi likely get pi-memory's own `## Memory` section (up to 16K chars) and its write tools, writing to `~/.pi/agent/memory`, while durable.md tells them they keep no memory. [code + inferred; no run seen]
- Claude Code runs are started without `--setting-sources` (`harness.ts:149-159`), so they likely load the user's own Claude Code memory for their folder and not hobkin's. [inferred]

## 3. What the window shows

- Nothing of `memory.md`: the host never reads it (only `host/src/backup.ts:70` names it). [code]
- A routine's working memory: "Working memory is not supplied to this screen" with host data (`ui/src/features/routines/Detail.tsx:149`, `host-data.ts:52`). [code]
- AGENTS.md: editable in Settings (DirectionsTile, `host/src/directions.ts`, version-checked save). Profile: through setup (`host/src/profile.ts`). [code]
- `hobkin remember` gets a quiet line "Noted from X: ..." (`inbox.mjs:158-167`), no Undo, no way to see where it was filed. [code]
- The tour says "I keep our conversation, what you told me in setup, and notes from every run" (`ui/src/features/tour/steps.ts:30-32`). [code]
- Specs 013 and 014 say nothing of a user memory; 014 keeps "a run gets its routine's working memory" as is (`_specs/014-continuity/spec.md:35-37`). [code]

So the user cannot see, correct or remove what hobkin remembers from the window, and cannot tell who added a line or when. [code]

## 4. The two references (shapes only)

pi-memory 0.4.2 (`README.md`, `index.ts`):
- Files in `~/.pi/agent/memory/`: `MEMORY.md` (long term), `SCRATCHPAD.md` (checklist), `daily/YYYY-MM-DD.md` (append-only log), `recovery/<id>.json`.
- Tools: `memory_write` (long_term append|overwrite, or daily), `memory_forget` (case-insensitive substring, writes a recovery record), `memory_restore`, `memory_read`, `scratchpad` (add/done/undo/clear/list), `memory_search` (qmd keyword/semantic/deep), `memory_status`.
- Injects before every turn: scratchpad 2K, today's log 3K, MEMORY.md 4K middle-cut, yesterday 3K; 16K chars total (`index.ts:151-159`). Default "stable" snapshot refreshed at session start, compaction, long-term write, day change, for prefix caching.
- At session end it asks a model for an exit summary into the daily log (`index.ts:1465-1525`), with a timeout and a filter for empty "None." summaries.
- `#tags` and `[[links]]` are content conventions only.

Claude Code file memory:
- A folder of small Markdown files, one fact each. Front matter: `name`, `description` (one line), `metadata.type` (user, feedback, project, reference), `metadata.originSessionId`, `metadata.modified`. Body: the fact, often with "Why:" and "How to apply:" lines; `[[name]]` links.
- `MEMORY.md`: one line a memory, `- [Title](file.md) — hook`; about 5 KB for about 30 files; loaded into every session. All files had an index line when checked.
- Project and personal facts sit in one index; it is per project folder, so a personal fact saved while working in one repository is not known in another.

What to take: one fact a file with a one-line description that builds the index (Claude Code); recoverable forget (pi-memory); a prompt that stays as written between checkpoints (pi-memory, and hobkin's own `prompt-parts.mjs`). What to leave: one long file cut in the middle, append-only daily logs, model-written exit summaries (cost and noise), a hand-kept index.

---

## 5. Design

### 5.1 A memory

One fact, one file. The file name is the memory's name, so it can never disagree with the file. JSON front matter between `---` lines, as hobkin's routines use, so no YAML parser is needed.

```
<home>/memories/                      0700
  <name>.md                           one memory, 0600, at most 4 KB
  private/<name>.md                   a private one (outside qmd's pattern)
  changes.jsonl                       every add, change, forget, restore: id, at, by, name, before, after
  forgotten/<name>-<stamp>.md         what forget took, restorable for 30 days
<home>/memory.md                      the "right now" list, unchanged (read as it is)
```

Example (invented):

```
---
{
  "kind": "user",
  "description": "Lives in Lisbon since 2025; use Portuguese sites, prices and rules first",
  "added": { "at": "2026-11-15T18:18:48Z", "by": { "kind": "outside", "title": "Claude Code" } },
  "changed": { "at": "2026-11-20T09:02:00Z", "by": { "kind": "main" } },
  "source": { "kind": "remember", "said": "I live in Lisbon, look up the Portuguese one" },
  "private": false
}
---
The user lives in Lisbon. For anything that depends on place (prices, laws, stores, a maker's service site), look up the Portuguese version first.

See [[car-insurance-renewal]].
```

Fields:
- name: `^[a-z0-9][a-z0-9-]{1,59}$`, unique across `memories/` and `memories/private/`.
- description: 1 to 150 characters, one line. This is the index line.
- kind: `user` (about the user and their life), `preference` (how they like things done), `date` (a deadline, a renewal, an appointment, a date that recurs), `decision` (what was decided and why), `project` (an ongoing thing in their life or work, which repo is which), `pointer` (where something lives: a folder, a site, a person to ask). Standing rules for how agents work stay in AGENTS.md, as today.
- text: 0 to 2000 characters, plain sentences. `[[name]]` links to another memory.
- until: optional `YYYY-MM-DD`; past it, the memory leaves the index and shows as past in the window.
- private: optional boolean; stored under `private/`.
- added / changed: `{ at, by }`, `by` = `{ kind: user | main | hobkin | outside | suggested, id?, title? }`, always set by hobkin from who asked, never typed by an agent.
- source: `{ kind: chat | window | remember | suggested | moved, said?, from? }`; `said` keeps up to 300 characters of the user's own words when the memory came from them.
- Caps: 300 memories; a file over 4 KB is skipped and named as unreadable in the window; `changes.jsonl` keeps the newest 1 MB.
- Refused at save, with the reason: anything that looks like a secret. Reuse `SECRET_PATTERNS` from `src/cli/feedback/draft.mjs:28-38` without the email and home-path ones (refuse, do not redact).

Index line: `- <name>: <description>` grouped under the kind's heading. Typical 110 characters.

### 5.2 Worth remembering (rules for agents)

Remember what the user would otherwise have to say again to a new agent, and what stays true past this task:
- About them: "The user lives in Lisbon", "Their partner is called Ana", "They work for a bank and use a work Mac on weekdays".
- A date that matters or comes back: "Car insurance renews every March 3", "Passport expires 2027-03-10" (the date, never the number).
- How they like things: "Replies under 100 words, point first", "Prefers train over flying under 600 km", "Wants appointments before noon".
- A decision and its reason: "Kept the old laptop for travel instead of selling it, because the new one is too heavy (2026-10)".
- Where things are: "Tax papers are in ~/Documents/Taxes, one folder a year", "The landlord answers on WhatsApp, not email".
- A project of theirs: "Moving house in January; boxes and quotes tracked in notes/move.md".

Do not remember:
- The state of a task ("the build is red", "PR 412 waits for review"): that is a report, a schedule, or the right-now list.
- What the repository or a file already says (scripts, conventions): it is there, and it changes.
- What a web page, an email or a tool said, unless the user confirmed it: evidence is not a fact about the user.
- Passwords, keys, tokens, card or account numbers, ID numbers, health details the user did not ask to keep.
- Rules for how agents work: those go in AGENTS.md.
- A guess about the user's taste: say it is a guess, or leave it to the taste profile.

Write it so it reads alone: absolute dates, who "they" is, one fact. Before adding, recall by words; change the memory that already says it instead of adding a second. When the user corrects one, change it at once. When it stops being true, forget it, or set `until`.

### 5.3 Reading, per agent

Always in the prompt: the index, built from the files, never kept by hand. Order by kind (user, preference, date, decision, pointer, project), then newest change. Leave out past `until`. Over the cap, the last line says "N more: find them with hobkin_recall".

| Agent | Index in prompt | Cap | Private | On demand |
|---|---|---|---|---|
| Main chat | system prompt section, kept as written, changes as `<hobkin-since>` lines ("Memories now also say: ...", "No longer: ...") | 8 KB (about 2k tokens, about 70 lines) | yes | `hobkin_recall` |
| Durable on Pi | appended to its directions at process start; changes as a since-note ahead of the next turn's words, the way the main chat gets them | 8 KB | yes | `hobkin_recall` via `memory-extension.mjs` over its pipe |
| Durable on CC | same, in its directions at the first turn; since-notes in each turn's message | 8 KB | yes | `hobkin memory get|search|list` (HOBKIN_TURN is set, so private shows) |
| Routine, Work (Pi or CC) | request JSON `memories` beside `memory` | 4 KB | no | Pi: `hobkin_recall`; CC: `hobkin memory ...` |
| Session run (Pi or CC) | request JSON `memories` (and `memory`, closing today's gap) | 4 KB | no | same |
| Helper | prompt JSON `memories` | 4 KB | no | none (its tool list is a boundary) |
| Teams agents | `agent-directions-extension.mjs` adds the index after the directions | 4 KB | no | none |

Search: plain word search is enough to start: tens to a few hundred short files; every word must match somewhere in name, description or text; score name x3, description x2, text x1; ties by newest change. No model, no qmd, instant, testable. Later: add a `memories` collection to the existing qmd index (`memory-index.mjs:24`, folder `memories`, pattern `*.md`, one level, so `private/` stays out) for meaning matches ("where do I live" finds "lives-in-lisbon").

`hobkin_recall` parameters: `{ name?, kind?, words?, limit? (1-20, default 5) }`, one of the first three. Answers each memory whole, with kind, who added it and when, links, and whether it is past.

### 5.4 Writing

Three verbs:
- recall: every agent.
- remember (save at once): the agents the user talks to. The main chat (`hobkin_remember`), durable hobkins (`hobkin_remember` on Pi, `hobkin memory add|change|forget` on CC, known by HOBKIN_TURN through `askRunning` like `hobkin tell`), the user in the window, and the user's own sessions elsewhere through `hobkin remember`, which now saves at once instead of waiting for the next message in Chat.
- suggest: agents the user does not talk to (routines, Work runs, session runs). Pi: `hobkin_suggest_memory`; CC: `hobkin memory suggest` (JSON on stdin). It goes into the inbox as today's `remember` entry with `from` = the run's title, and the main chat files it with the user's next message. Helpers and teams agents only read.

`hobkin_remember` parameters: `{ action: add | change | forget, name, description?, text?, kind?, until?, private?, said? }`.
- add refuses a name in use ("use change"), and refuses when an existing description shares most words, naming it ("change that one, or pass a different name").
- change keeps added, sets changed, writes the before and after to `changes.jsonl`.
- forget moves the file to `forgotten/`, restorable for 30 days.
- Every change by an agent posts a quiet line in Chat with Undo (5.6). The main chat no longer needs to say each change in its reply; it says it when it matters.
- Undo of add = forget; of change = the before text; of forget = restore. Refused when the memory changed since ("changed since; edit it instead").

What hobkin holds today:
- `memory.md`: read as it is, as "Right now"; `hobkin_memory` unchanged; the main chat's memory prompt now sends lasting facts to memories and keeps the list for what matters now.
- `AGENTS.md`, profile, setup facts: unchanged; the window's Memory page points at them.
- `hobkin remember` entries already in the inbox: heard as today.
- pi-memory, Claude Code memory: not read (user choice 4).

### 5.5 Privacy

- Everything stays in the home on this machine, 0600 files in a 0700 folder.
- A memory an agent reads goes to that agent's model provider. Private means: only the main chat and durable hobkins get it, in the index and from `hobkin_recall` / `hobkin memory`; never a routine, Work run, session run, helper or teams agent, and never qmd's index. Local backups do include it, as they include the rest of the home.
- That boundary holds in what hobkin hands out, not against an agent that reads `memories/private/` with its own shell. The prompts say to use the tool, and the folder name says private. Say so to the user; real separation needs encryption, which is out of scope.
- Secrets are refused at every door (tool, command, window) by pattern, and the rules tell agents never to try.

### 5.6 The window

A contextual screen "Memory" in the Settings group (like Integrations, Skills), opened from a Settings tile, from Spotlight, and from the quiet line's "See".

```
+-- Memory -------------------------------------------------- [ Add ] --+
| What hobkin remembers for every agent it runs.        [ Search..... ] |
| All 42 . About you 9 . Preferences 7 . Dates 6 . Decisions 8 .        |
| Projects 5 . Pointers 7 . Right now 12 of 20 . Past 3                 |
+-----------------------------------------------------------------------+
| ABOUT YOU                                                             |
|  Lives in Lisbon since 2025; use Portuguese sites first   [Edit] [..] |
|  The user lives in Lisbon. For anything that depends on place ...     |
|  From Claude Code, Nov 15 . changed by hobkin, Nov 20                 |
|                                                                       |
|  Partner is called Ana                          private   [Edit] [..] |
|  From you, in Chat, Nov 2                                             |
| DATES                                                                 |
|  Car insurance renews every March 3; bring it up two weeks before     |
|  From hobkin, Oct 30 . links: car-insurance-quotes                    |
| ...                                                                   |
| RIGHT NOW (memory.md, 12 of 20)                                       |
|  - Reply to the landlord about the deposit by Nov 28        [Edit][x] |
+-----------------------------------------------------------------------+
| Also known to every agent: your directions (Settings > Directions)    |
| and what you told setup (Settings > Set up again).                    |
+-----------------------------------------------------------------------+

[..] menu: Forget . Make private / Share with every agent . Copy name

Editing in place (the row keeps its place and size until Save):
|  Description  [ Lives in Lisbon since 2025; use Portuguese sites ... ] |
|  Kind         ( About you v )   Until [ ---------- ]   [ ] Private     |
|  Text         [ ...................................................  ] |
|                                             [ Cancel ]   [ Save ]      |

After Forget, the row turns into one line in place:
|  Forgot "Lives in Lisbon ..."                                [ Undo ]  |

Chat, when an agent changes one:
   Remembered from Claude Code: Lives in Lisbon; use Portuguese sites first . Undo . See
   hobkin changed: Car insurance renews every March 3 . Undo . See
```

Sample data with no host: `ui/src/features/memory/sample.ts`, about 12 invented memories across every kind, one private, one past, one from each author kind, and a right-now list of 5.

Protocol (all fields optional but `name`), `shared/protocol/memory.ts`:

```ts
export const MEMORY_KINDS = ['user', 'preference', 'date', 'decision', 'project', 'pointer'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]
export interface MemoryAuthor { kind?: 'user' | 'main' | 'hobkin' | 'outside' | 'suggested'; id?: string; title?: string }
export interface MemoryEntry {
  name: string
  description?: string
  kind?: MemoryKind
  text?: string
  private?: boolean
  until?: string
  added?: { at?: string; by?: MemoryAuthor }
  changed?: { at?: string; by?: MemoryAuthor }
  source?: { kind?: 'chat' | 'window' | 'remember' | 'suggested' | 'moved'; said?: string; from?: string }
  links?: readonly string[]
  past?: boolean
  /** sha256 of the file; a save or forget sends it back and is refused when the file moved on. */
  version?: string
}
export interface MemoryList { memories: readonly MemoryEntry[]; now?: readonly string[]; nowVersion?: string; unreadable?: readonly string[] }
export function readMemoryList(value: unknown): MemoryList // without trust, words cut short
```

`ChatMessage.memory?: { change: string; name: string; did?: 'added' | 'changed' | 'forgot' | 'restored' }` on the quiet line; a host from before sends none and the line shows as today.
Snapshot: `memoriesStamp?: string` (changes when any memory file or memory.md changes), so an open page reads the list again. A host from before sends none: the page reads on open only.

Commands (`shared/commands/registry.ts`, runs: host, writes `outside: true` so hobkin cannot change memories through the client tool around its own):
- `memory.list` -> `MemoryList`
- `memory.save { name?, description, text?, kind, until?, private?, version? }` -> `{ saved: true, memory } | { saved: false, message }` (add when no version)
- `memory.forget { name, version }` -> `{ change }`
- `memory.undo { change }` -> `{ ok: true } | { ok: false, reason }`
- `memory.now.change { action: add | replace | remove, item?, text?, version }` for the right-now list, through `memory.mjs`'s own rules.

---

## 6. Lanes

### Lane R: runtime (hobkin)

Files (new): `src/cli/memories.mjs` (store, rules, index, search, changes, undo), `src/cli/memory-tools.mjs` (`hobkin_recall`, `hobkin_remember`, `hobkin_suggest_memory`, handler by owner), `src/cli/memory-extension.mjs` (runs' bridge, like `schedule-extension.mjs`), `src/cli/memory-command.mjs` (`hobkin memory ...`), `src/prompts/recall-tool.md`, `remember-tool.md`, `memories.md` (the rules of 5.2).
Files (changed): `hobkin-extension.mjs`, `bridge.mjs` (op `memories`), `rpc-session.mjs`, `pi-session.mjs`, `memory.mjs` (in-process extension sections), `prompt-parts.mjs` (kept index + since-lines), `harnesses.mjs` (load the extension for tool runs; serve bridged memory calls), `application.mjs` (`ownedHarness` passes a memory handler by owner, like `schedules`; posts change notices; `memoriesStamp`), `context.mjs`, `runner.mjs:361`, `work/director.mjs:994`, `session-jobs.mjs:130`, `runtime.mjs:1143`, `hobkins.mjs:71` and its turn message, `agent-directions-extension.mjs`, `inbox.mjs` (`remember` saves at once; suggestion entries), `main.mjs` (`memory` command, help, not in NOT_IN_A_TURN), `memory-index.mjs` (later: `memories` collection), `resource-catalog.mjs` (a `memories` part for each kind), prompts `memory.md`, `v2-runtime.md:83,85,117,167`, `durable.md:3,13`, `background.md:16,74`, `hobkin-skill.md:46,133`, `docs/guide.md:67,448`.

The exact lists a new main-chat tool goes in, in one commit (a Pi child whose hello lacks a tool in `session.tools` fails to start, `rpc-session.mjs:480`):
1. `src/cli/hobkin-extension.mjs:16-17` `HOBKIN_BRIDGE_TOOLS`, and the `tools` array at `:27-28`.
2. `src/cli/rpc-session.mjs:419-436` `session.tools`.
3. `src/cli/pi-session.mjs:101-102` in-process `customTools` (`:342` follows `HOBKIN_BRIDGE_TOOLS` by itself).
4. Tests: `test/helpers/fake-rpc-pi.mjs:6`, `test/cli-main-session-child.test.mjs:239` and `:305`, `test/persona-rpc.test.mjs:91`, `test/cli-hobkin-extension.test.mjs:130`.
Runs: `namingExtensions` in `harnesses.mjs:127-137` (add `memoryExtension` for every `usesTools` run), and the bridged-call branch at `harnesses.mjs:509-516` (an `isMemoryCall` beside `isScheduleCall` at `:512`).

Tests first, in this order:
1. `test/cli-memories.test.mjs`: add, change, forget, restore, undo each way; a name in use and a near-duplicate refused with the other's name; a secret refused; private stored apart and absent from the run index; the index order, caps and "N more" line; `until` past leaves the index; a hand-edited file read; a broken or oversized file skipped and listed; 300 cap.
2. `test/cli-memory-tools.test.mjs`: recall by name, kind, words; remember from the main chat and from a durable stamps `by`; suggest from a run lands in the inbox with the run's title; change and forget refused for a run.
3. `test/cli-memory-command.test.mjs`: read without HOBKIN_TURN never shows private; add inside a durable turn goes through `askRunning`; add elsewhere refused with "use hobkin remember"; suggest files an inbox entry.
4. `test/cli-kept-prompt.test.mjs`: "a memory added mid-conversation reaches the main agent as a note and the prompt stays as written".
5. The tool-list tests above; `test/cli-harnesses.test.mjs`: a tool run loads the memory extension and its recall is served as its owner.
6. `test/cli-hobkins.test.mjs`: a durable turn's directions carry the index; a change reaches its next turn as a note.
7. `test/cli-memory.test.mjs:225` and `session-jobs`: routines, Work, sessions and helpers get `memories`.
8. `test/cli-inbox.test.mjs:253`: `hobkin remember` saves a memory at once and the main agent still hears it once.
Order of commits: store; tools and command (nothing imports them); main chat (one atomic commit with all lists); runs; durables; inbox; prompts and guide; snapshot stamp and notices.

### Lane H: host and protocol (hobkin-client)

Files: `host/src/backup.ts` (add `'memories'` to `OWN_AT_HOME`, line 59 on; first, before lane R's first commit, or `host/test/backup-guard.test.ts` fails as soon as hobkin's source joins `memories`), new `shared/protocol/memory.ts`, `shared/protocol/snapshot.ts` (`ChatMessage.memory`, `memoriesStamp`), `shared/commands/registry.ts` (five commands and results), new `host/src/memories.ts` (handlers importing `hobkin/src/cli/memories.mjs` the way `host/src/profile.ts` imports `profile.mjs`), `host/src/host.ts` (register). Claude Code: none needed if the runtime's prompts carry the `hobkin memory` paragraph (background.md and durable.md already serve CC runs); check `route.ts:173,213`.
Tests first: `shared/test/memory-protocol.test.ts` (reader without trust: bad kinds dropped, words cut, missing fields), `host/test/memories.test.ts` (list, save, conflict by version, forget, undo, refusal words, private on a temporary home), `host/test/backup-guard.test.ts` passes, `shared/test/commands.test.ts` passes.
Risk: whether the host passes the runtime's chat messages through with unknown fields (inferred yes; check where the snapshot's `messages` are built).

### Lane W: window (hobkin-client ui)

Files: new `ui/src/features/memory/` (`MemoryScreen.tsx`, `MemoryRow.tsx`, `MemoryEditor.tsx`, `groups.ts`, `store.ts` with its slot on `globalThis`, `sample.ts`, `actions.ts`), new `ui/src/features/settings/MemoryTile.tsx`, `SettingsScreen.tsx` (one line), `ui/src/app/screens.ts` (contextual `memory`, settings group in `walkScreens`), `ui/src/app/location.ts` if the screen keeps a place, `ui/src/features/chat/MessageList.tsx` and `conversation.ts` (Undo and See on a quiet line with `memory`), `ui/src/app/spotlight-entries.ts`, `ui/src/features/tour/steps.ts:30-32` copy.
Tests first: `ui/test/memory-groups.test.ts` (grouping by kind, order, search, past, private), `ui/test/memory-store.test.ts` (a save refused for a newer version keeps the draft; forget then undo; sample data with no host), `ui/test/chat-memory-line.test.ts` (Undo sends `memory.undo` once and the line says so; an old host's line has no Undo).
Only in a still render or the live window: the page's look in both themes, the editor not moving the row's controls, the quiet line's Undo and See, the tile.

---

## 7. Risks

- Tool lists: four places and five tests (6, lane R). Half of it in one commit stops the main chat from starting. The main chat only sees new tools after its Pi child restarts, which needs the user's word.
- Prompt size: main chat today ~4 KB memory + ~4 KB decided; adds up to 8 KB (about 2k tokens). Each routine, Work and session run adds up to 4 KB (about 1k tokens) on top of a 17 KB background.md. Durables add up to 8 KB. The index stays out of system prompts that runs share, as lessons do (`context.mjs:63`), so caches hold.
- A wrong memory, now everywhere: only agents the user talks to save at once; runs suggest; every change is a quiet line with Undo; the source and author are on each memory; memories are "context, not instructions" in every prompt; the user's words now win; `until` ages things out; forget is restorable for 30 days.
- Privacy is a soft boundary against an agent's own shell (5.5).
- A run on Claude Code can still type `hobkin remember`, which now saves at once; only its prompt stops it. A marker in every run's environment (say `HOBKIN_RUN`, set by the runtime for Pi runs and by the route for Claude Code runs) would let the command turn it into a suggestion. Worth doing in the same batch.
- Two memories in one run: pi-memory keeps loading in hobkin's other Pi runs unless left out (choice 4).
- The backup guard test (lane H first).
- The installed hobkin skill in other agents' skill folders keeps the old words until reinstalled. [inferred]

## 8. Not determined

- Whether pi-memory really loads in the user's runs and what it holds (its settings were only counted).
- Whether Claude Code runs load the user's Claude Code memory (inferred from flags).
- The real size of the user's `memory.md` and AGENTS.md (the home was not read).
- How well a model keeps to the rules of 5.2, or uses an 8 KB index (no model call).
- Whether the host forwards unknown chat message fields (not traced).

## 9. The user's choices (default first)

1. Who saves at once: the main chat, durable hobkins, the window and `hobkin remember` from their other sessions; routines, Work and session runs only suggest. (Other: every agent saves, with Undo.)
2. Private means: only the main chat and durable hobkins. (Other: the main chat only; or only agents on the main chat's provider.)
3. The 20-line right-now list: kept beside memories and shown on the page. (Other: folded in as a kind with a one-time move.)
4. pi-memory in hobkin's runs: left out of every hobkin run once memories reach them, so each run has one memory. (Other: leave it.)
5. Durable hobkins also get AGENTS.md with the user's name line, which they lack today. Default yes, as its own commit.
6. Caps: 8 KB index for the main chat and durables, 4 KB for other runs, 300 memories.
