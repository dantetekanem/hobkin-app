---
{
  "id": "045-dev-system",
  "title": "hobkin's own development system",
  "kind": "work",
  "status": "draft",
  "depends": ["011-work", "033-claude-code-agents", "038-resources", "039-skills-and-extensions"],
  "updated": "2026-11-14"
}
---
# hobkin's own development system

## Outcome

Every agent hobkin starts works from hobkin's own development system, not the user's. The user's global `~/.pi/agent/AGENTS.md`, their Pi skills and their Claude Code setup stay theirs, for their own terminal. hobkin's runs load hobkin's own AGENTS.md and its own skills: team-leader and teams for hobkin's own agents, a coding flow, an expert for each language, the humanizer, and short guides for the extensions a run loads. A run in a project also reads the project's AGENTS.md or CLAUDE.md, beneath hobkin's text. Before a Work run edits code, it reads hobkin's expert for each language it touches, reads the design, and records a plan on the item that hobkin checks. A change that mixes a refactor with a behaviour change, or passes 300 lines, is split. Before a run writes a commit, a PR or an issue, it has read the humanizer. The user reads and edits each of these texts in Settings › Skills, or asks hobkin to change one. A text the user never edited follows hobkin's releases, and an edited one gets an offer when hobkin ships a newer version. All of this holds on Claude Code too.

## Decisions

### Where the texts come from

- The user, 2026-11-14: "i want the global to stay, hobkin should overwrite that and introduce our own agents.md". No run hobkin starts loads `~/.pi/agent/AGENTS.md` (`038-resources` makes this so for Pi runs) or `~/.claude/CLAUDE.md` (below, for Claude Code).
- Today a run with tools loads both the global AGENTS.md and every skill Pi has: `harnesses.mjs:58-74` passes neither `--no-skills` nor `--no-context-files`, and Pi's loader then reads the AGENTS.md in Pi's own folder (Pi 1.5.0, `dist/core/resource-loader.js:184-188` and `481-486`).
- The user, on what runs load instead: "will use their agents and the set of skills I want, which is almost my own development system. so team-leader, teams.md, how to use the default extensions, the development we talked, find which language and see the expert languages, etc." hobkin ships its own set under `hobkin/src/prompts/`, adapted from the user's managed skills in `~/Poetry/personal-pi/skills/` and from `~/.pi/agent/skills/write-swift`. They are copies, not links, so a change in the user's folder never reaches hobkin's runs. hobkin's copies never name the user: they say "the user".

  | Text | File under `hobkin/src/prompts/` | Adapted from | What it holds |
  | --- | --- | --- | --- |
  | `agents`, hobkin's AGENTS.md | `hobkin-agents.md` | the "Big work" section of `agents-default.md`, and the user's global AGENTS.md §1, §4 and the reporting rules of §7, cut to what fits hobkin | Scope and authorization, evidence, when to delegate, the writing core, comments, precedence |
  | `coding` | `skills/coding/SKILL.md` | the user's words under "The coding flow", below | The coding flow and the plan |
  | `team-leader` | `skills/team-leader/SKILL.md` | the user's `team-leader` | When to split work into lanes, and the lead's job |
  | `teams` | `skills/teams/SKILL.md` | pi-extended-teams `skills/teams.md`, and `018-teams-guidance` | hobkin's mechanics: `owned_agent` and `hobkin session` |
  | `humanizer` | `skills/humanizer/SKILL.md` and `LICENSE` | the guide half of `humanizer.md` (`humanizer.md:42` on) | How to write any text a person reads |
  | `pr-description` | `skills/pr-description/SKILL.md` | `pr-description` and `better-pr-descriptions` | What, why, proof, what was not tested |
  | `ruby` | `skills/ruby/SKILL.md` | `rails-engineer`, `ruby-post-processing`, `rails-test-post-processing` | Ruby and Rails, read before editing |
  | `javascript` | `skills/javascript/SKILL.md` | `javascript-engineer`, `react-typescript-post-processing` | JavaScript and TypeScript outside React |
  | `react` | `skills/react/SKILL.md` | `react-engineer`, the React parts of `react-typescript-post-processing` | React components and hooks |
  | `swift` | `skills/swift/SKILL.md` and `LICENSE` | `write-swift` | Swift |
  | `sql` | `skills/sql/SKILL.md` | `database-engineer` | Schema, migrations, SQL, transactions |
  | `tests` | `skills/tests/SKILL.md` | `test-expert` | Which tests earn their place, and how they assert |
  | `security` | `skills/security/SKILL.md` | `security-expert` | Login, access, tokens, input, secrets |
  | `design` | `skills/design/SKILL.md` | `solid-principles-expert`, `refactor-god-code` | Boundaries, and how to split a large file, read for a refactor layer |
  | `code-mode` | `skills/code-mode/SKILL.md` | Pi's `docs/codemode.md` | When one script beats single tool calls |
  | `agentic-search` | `skills/agentic-search/SKILL.md` | pi-agentic-search's own skill | When to search with it in the coding flow, and when `rg` is enough |
  | `web-search` | `skills/web-search/SKILL.md` | pi-web-access and pi-search-hub | Current facts: search, read the page, cite the URL |

- A manifest, `hobkin/src/prompts/texts.json`, names each text's id, file, version, the kinds it loads in and how, the package a guide goes with, and the file patterns an expert covers (`ruby`: `.rb`, `.erb`, `.rake`, `Gemfile`; `javascript`: `.js`, `.mjs`, `.cjs`, `.ts`, `.mts`; `react`: `.tsx`, `.jsx`; `swift`: `.swift`; `sql`: `.sql` and migration folders). The loader, the guard, Settings and the update story all read it, so a text is added in one place.
- Each skill is one SKILL.md, with a LICENSE beside a vendored one, and no other file. An edited copy in hobkin's home is then complete, with no reference file left behind.
- Licences. The humanizer is vendored from blader/humanizer under MIT (Siqi Chen), and its licence is already in `src/prompts/humanizer.LICENSE`. `write-swift` is MIT (Emil Kowalski, `~/.pi/agent/skills/write-swift/LICENSE`). Each copy keeps its notice and names it in its `license` frontmatter (`docs/skills.md:75`). The rest are the user's own: `personal-pi/SKILLS.md` marks which of its skills are vendored, and none of the others here is.

### Short, and held by code where it can be

- From a talk the user shared (Lauren Tan, "All Code Is Slop (Except Mine)"): written rules stay short and say what an agent would not do by itself. When a correction comes back, a check (a lint rule, a test, a type) beats another rule line. Agents use comments to excuse a bad fix, so a comment says only the reason the code cannot show.
- "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?" (https://arxiv.org/abs/2602.11988) found that context files did not generally raise task success, raised inference cost by over 20% on average, and helped mainly by naming non-standard practice.
- The user's own count points the same way. In the 30 days to 2026-11-13, Pi sessions read the language skill before their first edit in 43 to 71% of cases, and Claude Code subagents in 2 to 3%. The post-processing skills, which the global AGENTS.md names by language, were read more often (`~/Poetry/personal-pi/docs/coding-agent-skills/plan.md`, the baseline table).
- So hobkin's AGENTS.md stays under 500 words, and each other text under 1,500, except the humanizer, which stays whole as vendored, and swift, cut from 6,054 words to under 2,500. An adapted skill keeps what is not obvious and drops what a capable model does anyway.
- Where a rule matters, code holds it, and the text only says what code checks: the expert before an edit, the plan before an edit, the humanizer before a commit, PR or issue. See "The guard".

### What each kind loads

- "In full" is appended to the system prompt. "Listed" is Pi's skill list, the name, line and path of each skill, which the model reads when the task needs it (`docs/skills.md:43-45`). Pi still loads an explicit `--skill` under `--no-skills` (`docs/cli.md:202-203`, "Explicit `--skill` paths still load"; `resource-loader.js:439-441`), so 038's blank runs take hobkin's skills this way.

  | | Main chat | Background | Work discover | Work look | Work do | Durable | Helper of a Work do run |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | hobkin's AGENTS.md | in full | in full | in full | in full | in full | in full | in full |
  | `coding` | | listed | | | in full | listed | listed |
  | `team-leader`, `teams` | listed | | | | listed | | |
  | `humanizer` | listed | listed | listed | listed | listed | listed | listed |
  | `pr-description` | | listed | | | listed | listed | |
  | the eight experts | | listed | | listed | listed | listed | listed |
  | `code-mode` | listed | listed | listed | listed | listed | listed | listed |
  | `agentic-search`, `web-search` | with the package | with the package | with the package | with the package | with the package | with the package | with the package |

- "With the package" means listed only in a run that loads that package, by 038's choice for its kind.
- The main chat checks, confirms and delegates (`agents-default.md:7`), so it lists neither the coding text nor the experts.
- team-leader and teams are listed only where a run can delegate: the main chat, through `hobkin session`, and a Work do run, through `owned_agent`.
- hobkin's fixed runs (reflection, the report editor, migration repair, session patterns, compatibility checks) take none of these, as 038 decides. The one exception is that the report editor writes by the humanizer text.
- Order and precedence: the user's directions win over hobkin's AGENTS.md and skills, and those win over the project's own files. A Pi run's appended text comes in this order: hobkin's AGENTS.md, the run's own prompt (`background.md`, a `work-*.md` or `durable.md`), the coding text in a do run, then the project's files under one line hobkin adds, as 038 decides. Pi puts all appended text before its skill list (`dist/core/system-prompt.js:96-107`).
- In the main chat hobkin's AGENTS.md joins `mainPrompts` (`pi-session.mjs:121-133`) and the skills join its loader's skill paths. A change reaches the chat when it next starts, by 038's rule for the main chat.

### hobkin's AGENTS.md and the user's directions

- Two files with two owners. `hobkin-agents.md` is hobkin's AGENTS.md: how hobkin's agents work, shipped and updated by hobkin, editable by the user. `AGENTS.md` in hobkin's home stays the user's standing directions, in their words, written by main hobkin when they give one (`v2-runtime.md:83`). Settings calls them "hobkin's AGENTS.md" and "Your directions". 038 renames the second from "hobkin's directions" so the two are never confused.
- `agents-default.md` stays the first copy of Your directions (`directions.mjs:8-17`). Its "Big work" section moves to hobkin's AGENTS.md, and the seed keeps a heading and one line.
- Its last line, "A check or a work run is that agent: it does its own work and spawns no subagents" (`agents-default.md:17`), contradicts team-leader. In hobkin's AGENTS.md it says which runs may have helpers, below.
- A home whose directions still hold the old "Big work" paragraphs word for word gets one Action Item, saying they now live in hobkin's AGENTS.md. Remove takes out only those paragraphs, as shipped. Keep leaves the file as it is. Nothing changes the file without that answer.

### The coding flow

- The user: "agent should know which language is working, get the design of the system, think and prepare what is going to change, and make the changes. it should know when to split into stack". The `coding` text says this, and loads in full in every Work do run:
  1. Name the languages the item touches, from its files and the manifest. Read hobkin's expert for each before the first edit.
  2. Read the design: `projectNotes` Architecture and Languages, the project's own AGENTS.md (already above), its `_specs/` when it has them, the nearest tests of each file to change, and two good files nearby that the change should look like. Agents copy whatever looks like the pattern, so pick those two on purpose.
  3. Plan before any edit, and pipe the plan to `work.commands.plan`.
  4. Proof first, as `work-do.md:37` says now. Then the change, with comments only for the reason the code cannot show.
  5. Run the project's own lint, type checks and tests, from `projectNotes` Test and Languages.
  6. When a correction keeps coming back, propose in the description a check that catches it (a lint rule, a test, a type), not another rule line.
- A plan holds the languages, the files, the change and the risk in a sentence each, the check that proves it, up to two example files, and the layers. Each layer has a title, a kind (`refactor`, `mechanical` or `behaviour`), what it changes, its proof, and an estimate of changed lines. A layer has one kind, so a refactor and a change of behaviour are never one layer. `hobkin work plan` refuses a plan with a field missing, or with a layer over 300 lines that is not `mechanical` (a lockfile or generated code, which cannot be split), and says which. It keeps the plan on the item with the run that made it. Today an item is checked only for a title and a brief (`work/store.mjs:494-500`).
- The user: "if no experiment is done, Hobkin can know how to work with this and make the best plans". The sizes come from published practice. Google's review guide calls about 100 lines a reasonable change and puts a refactor in a change of its own (https://google.github.io/eng-practices/review/developer/small-cls.html). SmartBear's study of a Cisco team found reviewers should take in no more than 200 to 400 lines at a time (https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/). The user's line is 300, which is also where hobkin already stops offering a branch to land (`work/patterns.mjs:12`, `:193`). So the coding text aims near 100, the plan check refuses a layer past 300, and no layer it allows is too big to be offered or reviewed.
- Lines are counted as land offers count them, additions plus deletions (`work/patterns.mjs:188`), so the plan and the offer agree.
- The coding text orders the layers: refactors and mechanical steps first, then the change of behaviour with its tests.
- The run does the first layer. Until `042-stacked-work` files the rest as layers of their own, they go in the description, as `work-do.md:38` says now for a larger item. How layers become stacked branches, and how they land, is `042-stacked-work`'s. This spec says when a plan splits and how it names the layers.
- When the run records `branch` or `pr`, hobkin counts the branch's changed lines and keeps them beside the first layer's estimate. The description names both. A later tuning of these numbers starts from that record.
- Every Work do run plans before its first edit, a review run and a `pr-fix` item included: `041-review-feedback` sends review feedback through this flow. A run that edits nothing, such as a clean rebase or a review that finds nothing to fix, needs no plan. So recording `branch` or `pr` is refused only when the run made a commit and the item has no plan from it.

### The guard

- The user: "the post-processing idea was good but we need to drop, it should be instructions before addressing." hobkin ships no post-processing skill and no pass after the change. Most of each of today's three post-processing skills is guidance on how to write the code (naming, the shape of methods, honest types, what a test asserts), and that moves into the experts, read before the first edit. What is left, a look over the whole change, is the coding flow's last step: lint, types and tests.
- The user: "prose also must be a must, humanizer must always be used to write any text". Every commit message, PR body, issue, card text, doc and report is written with the humanizer read first.
- One pure module decides, and each harness asks it before a tool runs:
  - In a run that lists the experts, an edit or write of a file an expert covers waits, with the expert's path in the reason, until the run has read that expert. A file no expert covers never waits.
  - In a Work do run, any edit or write waits until the item has a plan from this run.
  - `git commit`, `gh pr create`, `gh pr edit`, `gh pr comment`, `gh pr review`, `gh issue create`, `gh issue comment`, and a write of `work.item.prFile`, wait until the run has read the humanizer.
- On Pi, a small extension of hobkin's does this at `tool_call`, which can block a call (`docs/extensions.md:364`; `owned-agent-extension.mjs:66-68` blocks this way today). A read counts when Pi's `read` tool, or a code mode script's nested `read`, opens the SKILL.md, the same as a use in 038.
- On Claude Code, a PreToolUse hook passed in the run's `--settings` asks the same module, and finds the run's reads in its transcript.
- It cannot see a file written through `bash`, such as `sed -i` or `cat >`. A run that made a commit without a plan still cannot record `branch` or `pr`, so the plan holds on every path.
- The main chat writes replies all day, so it does not load the whole humanizer on every turn. hobkin's AGENTS.md carries the core writing rules in a few lines, the humanizer is listed, and the report editor still edits every report afterwards (`report-editor.mjs:41`).
- The report editor and the main agent's brief write by the same humanizer text as the skill, the user's edit included (`humanizer.md:37-42`, `brief.mjs:27`). `humanizer.md` keeps only the editor's own part.

### hobkin's own agents

- Today every background and Work run is registered with helpers off (`application.mjs:338-339`, "Work stays closed until child accounting is integrated"). Work's director already counts each helper's tokens in its run (`work/director.mjs:296-331`) and admits a helper only within the day's and the hour's budget (`work/director.mjs:333-353`).
- A spawn takes only a name (`owned-agent-tool.mjs:9`), and the helper gets its parent's whole prompt (`owned-agent-lifecycle.mjs:52`, `owned-agent-session.mjs:286`). In a Work run every helper would be handed the whole item. After its first reports come back, a parent can spawn no more (`owned-agent-lifecycle.mjs:77`, `96`).
- Work do runs get helpers. A spawn names a `brief`, the lane's handoff card of at most 16 KB, and a `role`, `read` or `write`, never wider than its parent's. In a Work run a spawn without a brief is refused, and in the main chat one without a brief works as it does now. A Work helper's prompt is its brief, with hobkin's AGENTS.md and its parent's project files, and its skills are listed as the table says. It spawns no helpers of its own.
- At most one write helper runs at a time in a run, and a second waits. hobkin has no file claims, and two writers in one tree would collide. Read helpers run side by side, within the owned limits: four running and eight waiting, three deep, 32 in all (`owned-agents.mjs:4`).
- When the lead stops, hobkin waits for its helpers and brings their reports back as its next message (`harnesses.mjs:122-131`), 512 characters of each (`owned-agent-lifecycle.mjs:28`). `owned_agent` with `status` gives a whole report, up to 8,000 characters (`owned-agents.mjs:32`). After a wave of reports the lead may spawn again.
- Discover and look runs are offered no `owned_agent`. Today every run with tools gets the tool (`harnesses.mjs:121`) and a spawn is refused only later, because helpers are off. They go through one folder at a time and keep their place in `checkMemory`, which needs no helper. `work-discover.md:13` then says this in one line, in place of "whatever other instructions say about delegating", because the tool is not there to call.
- Delegated jobs, routines and durable hobkins keep helpers off. No budget admits a helper there yet.
- `team-leader` keeps the user's rules that fit hobkin: the lead owns scope, integration and acceptance; small work stays with the lead; no invented or overlapping lanes; each lane gets one outcome and one check; never poll, and end the turn when only helpers can move the work on; accept on evidence. It drops what hobkin does not have: `goal.md`, task boards, file claims, `model_slot` tiers, and review limits per milestone.
- `teams` names the mechanics. In the main chat it is `hobkin session --tier` (`agents-default.md:9-15`). In a Work do run it is `owned_agent`, with its brief, role, admission and limits, and the handoff card from pi-extended-teams' `skills/teams.md`: goal, question, expected result, known facts with their sources, what not to look at again, the files the lane owns, the expert to read, the check, and when to stop. Helpers run on their parent's model and effort (`owned-agent-lifecycle.mjs:52`), so there is no tier to pick.
- `018-teams-guidance` planned `src/prompts/teams.md` and `team-leader.md` for the main chat (its S1). They are these two skills. 018 keeps the rest: the handoff card in `hobkin session` briefs, a required tier, and the mission card on the Work map.

### Review runs

- `work-do.md:41` sends a review run to `agentic_code_review` and to the user's `security-expert`, `test-expert` and `database-engineer`. It names hobkin's `security`, `tests` and `sql` instead, and no review tool. hobkin's own review is Change Review (`host/src/review/`), and how its findings come back to a run is `041-review-feedback`'s.

### Guides for the extensions

- "The default extensions" has two readings, and the guides cover both. What loads in every run with tools is Pi's code mode and tool search (038); `code-mode` says when a script beats single calls. The packages the user named when asking for 038 are pi-agentic-search and the web search ones (038's Outcome). In the user's Pi settings today pi-web-access and pi-search-hub are on, and the extensions of @siddr/pi-web-search and @ollama/pi-web-search are off (`~/.pi/agent/settings.json`, `packages`).
- A guide is listed only in a run that loads its package, by 038's choice for that kind. Whether those packages start chosen is an open question.
- pi-agentic-search ships its own skill, which comes with the package. hobkin's guide says only what is hobkin's: where it fits in the coding flow.

### Claude Code

- The user's decisions above hold there too: hobkin's AGENTS.md in place of the user's own, hobkin's skills in place of theirs, and the project's files beneath hobkin's text. Today a Claude run loads the user's own setup: `033-claude-code-agents` says "The user's own Claude Code setup (CLAUDE.md, skills, MCP servers, hooks) loads", and `claude-code/harness.ts:139-154` passes no setting flag.
- A Claude run passes `--setting-sources` with no source in it. By Claude Code's own table of what each source loads (https://code.claude.com/docs/en/agent-sdk/claude-code-features), that leaves out the user's `~/.claude/CLAUDE.md` and rules, their skills, commands, agents, hooks, permission rules and plugins, and the project's `.claude/` settings, hooks, skills, rules and CLAUDE.md.
- It sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. The same page says auto memory loads whatever the sources are, and a hobkin run would otherwise write into the memory the user's own sessions read.
- Its appended prompt holds, in order: the Claude note (`claude-code/directions.md`), hobkin's AGENTS.md, the run's own prompt, the coding text in a do run, hobkin's skill list for the kind (the name, line and absolute path of each SKILL.md, read with Read), and the project's own files, found by 038's rule and placed under the same line.
- Skills reach a Claude run as that list, not as a Claude plugin. The list needs no setting source and nothing of Claude's skill loader, and each Read of a path shows in the stream, so a use counts as it does on Pi.
- The user's own Claude allow rules no longer apply. The tile's permission mode decides (033), so under "ask" more prompts reach the question sheet.
- MCP servers stay as they are: Claude Code reads `~/.claude.json` whatever the sources say (same page).
- Not yet checked against the installed `claude` 2.1.325: that the CLI takes `--setting-sources` with an empty list, and that hooks in `--settings` run when no source loads. Its help lists both flags. S12 checks both live.

### Editing the texts

- The user: "it can use the project, but hobkin will go on top, and all of hobkin text can be changed by hobkin (if asked) or in Settings for the user". The texts here are the ones in the table and Your directions. hobkin's runtime prompts (`prompt.md`, `v2-runtime.md`, `background.md`, the three `work-*.md`, `durable.md`, `canvas.md`) stay fixed, because they hold the command contracts that runs depend on. That is an open question.
- A text the user never edited is read from hobkin's own files, so it follows each release. An edited one is a copy in hobkin's home: `texts/agents.md`, or `texts/<id>/SKILL.md` with the LICENSE beside it for a vendored one. `texts/state.json` keeps, for each copy, the version it was edited from. Your directions stay in `AGENTS.md` in the home.
- Saving checks the text: at most 64 KB, and for a skill, frontmatter whose `name` is its id and whose `description` is not empty, since Pi skips a skill without one (039). A text that fails is refused with the reason, and the copy stays as it was. Reset removes the copy, and the text is hobkin's again.
- Main hobkin changes a text only when the user asks, with `hobkin texts`: alone it lists them, `show <id>` prints one, `set <id> -` takes the new text on standard input, and `reset <id>` goes back to hobkin's. `v2-runtime.md` says so in one line.
- When a release brings a newer version of a text the user edited, hobkin files one Action Item for that version, the way it files a newer routine template: a key per version (`routine-care.mjs:98-122`), from what an earlier open saw (`routine-templates.mjs:92-104`), filed at open (`application.mjs:1362-1374`). The choices are "Use hobkin's new version", which keeps the user's copy beside it as `SKILL.mine.md` or `agents.mine.md`; "Keep mine", which is not asked again for that version; and "Ask hobkin to bring the change in", a chat message naming both files. A text the user never edited needs nothing filed. The answers go through `answer.mjs`, as other Action Items do.
- A change reaches each kind at its next run or turn, and the main chat when it next starts (038).

### In Settings

- `039-skills-and-extensions` built Settings › Skills and Settings › Pi extensions as switches on Pi's own global settings (shipped in source in 1ca4740). The pages stay, reframed:
  - Settings › Skills opens with hobkin's own: hobkin's AGENTS.md, Your directions, then each hobkin skill and guide. Each row says where it loads ("Every run", "Read when needed in Work", "With pi-agentic-search") and whether it is hobkin's, "Edited", or "Edited, and hobkin has a newer version". View shows it in full, as View more does now. Edit opens it in place with Save and Cancel. Reset to hobkin's asks in place, as a verdict does: the first click asks, and a second within ten seconds resets. Ask hobkin to change it sends a chat message as 039's Ask for a change does, beginning `Change hobkin's text "<name>" (<id>):`. Your directions are the user's alone, so their row has View, Edit and Ask, and no Reset and no version.
  - Pi's own skills follow, each with 038's switch for each kind in place of Pi's global switch.
  - Settings › Pi extensions shows 038's switches for each kind on each package, extension and built-in, and keeps Pi's update check. A package with a hobkin guide says so.
- Pi's global switches go, because they change the user's own Pi, which the user keeps apart from hobkin ("i want the global to stay"). Pi's own state shows as a line, "Off in your Pi, so hobkin does not offer it", and the terminal's `pi config` changes it. `skills.turn-off`, `skills.turn-on`, `extensions.turn-off` and `extensions.turn-on` are retired, with their tests, when 038's switches ship. That is an open question.
- 038's lightbox is not built. Its list lives on these two pages, and its tile opens them (038 S6).
- Commands: `texts.read` returns every text with its state, and one text in full by id, and hobkin may run it. `texts.write { id, text }` and `texts.reset { id }` are the window's alone (`outside`), like `resources.apply`.
- With no host the section shows sample data and says so. Everything works from the keyboard, by the rule of `019-keyboard`.

## Out of scope

- How a plan's later layers become stacked branches and land (`042-stacked-work`), how review findings come back to a run (`041-review-feedback`), and auto-merge and deploys (`043-merges-and-deploys`).
- Editing hobkin's runtime prompts.
- Helpers for delegated jobs, routines and durable hobkins.
- Changing the user's own `~/.pi/agent/AGENTS.md`, `~/.claude/CLAUDE.md` or managed skills.
- Showing the plan on the Work card. It is on the item and in the description.
- Holding a file written through `bash`.
- MCP servers in Claude Code runs.
- A project's `.claude/rules/` files, and CLAUDE.md files in folders below the one a run works in.

## Acceptance

- A1. On Pi, the main chat, a routine, a delegated job, each Work run, a durable turn and a Work helper each have hobkin's AGENTS.md in their system prompt and list the hobkin skills the table gives their kind, each with its path. A Work do run also has the coding text in full. With nothing chosen in 038, none lists any other skill.
- A2. A run on Claude Code starts with `--setting-sources` naming no source and with auto memory off. Its appended prompt holds hobkin's AGENTS.md, the run's own prompt, hobkin's skill list with each file's path, and the project's own AGENTS.md or CLAUDE.md beneath them. Nothing of the user's `~/.claude/CLAUDE.md`, their Claude skills or their plugins reaches it.
- A3. A Work do run's helper gets its own brief, not its parent's prompt, and a role no wider than its parent's. A spawn without a brief in a Work run is refused. A second write helper waits while one runs. A helper spawns none of its own. The lead can spawn again after its first reports come back. Discover and look runs have no `owned_agent` tool.
- A4. In a run that lists the experts, an edit or write of a file an expert covers is held, with that expert's path, until the run has read the expert. A file no expert covers is not held. This holds on Pi and on Claude Code.
- A5. `hobkin work plan` refuses a plan with a field missing, or with a layer over 300 lines that is not `mechanical`, and names what is wrong. In a Work do run, a review or `pr-fix` run included, every edit or write is held until the item has a plan from this run. A run that made a commit and records `branch` or `pr` with no plan from it is refused. A run that edits nothing needs no plan.
- A6. A recorded `branch` or `pr` keeps the first layer's estimate beside the branch's changed lines, counted as land offers count them, and the description names both and the layers left for later.
- A7. `git commit`, `gh pr create`, `gh pr edit`, `gh pr comment`, `gh pr review`, `gh issue create`, `gh issue comment` and a write of the item's PR file are held until the run has read the humanizer.
- A8. Settings › Skills shows hobkin's AGENTS.md, Your directions and each hobkin skill and guide, with where it loads and whether it is hobkin's, edited, or edited with a newer version from hobkin. Each can be read in full, edited and saved, reset to hobkin's (all but Your directions), and handed to main hobkin with the user's words. A skill saved without its name or description is refused with the reason, and the saved copy stays as it was. Every action works from the keyboard. With a host connected nothing on it is sample data.
- A9. `texts.read` returns every text and its state, and hobkin's `client` tool can run it. `texts.write` and `texts.reset` change a text from the window, and the `client` tool refuses them. `hobkin texts` lists, shows, sets and resets a text. After any change, the next run of a kind that loads that text uses the new one.
- A10. When hobkin ships a newer version of a text nobody edited, the next run uses it and nothing is filed. For an edited text hobkin files one Action Item per newer version. "Use hobkin's new version" replaces the text and keeps the user's copy beside it, "Keep mine" is not asked again for that version, and "Ask hobkin to bring the change in" sends one chat message naming both files.
- A11. A home whose directions still hold the old "Big work" paragraphs word for word gets one Action Item. Remove takes out only those paragraphs and keeps the rest of the file byte for byte. Keep changes nothing.
- A12. The bundled texts never name the user, name only tools and commands hobkin has, keep each vendored text's licence, and include no post-processing skill. hobkin's AGENTS.md is under 500 words and each other text under 1,500, except swift, under 2,500, and the humanizer, which stays whole as vendored.
- A13. A study look writes project notes with Architecture and Languages headings. A Work do run's plan names the languages its files are in and up to two example files.
- A14. A review run calls no review tool, and its prompt names hobkin's `security`, `tests` and `sql` experts, not the user's skills.
- A15. The report editor and the main agent's brief write by the humanizer skill's text, and when the user has edited it, by their edit.
- A16. `agentic-search` and `web-search` are listed only in runs that load their package. `code-mode` is listed in every run with tools.

## Proof

- A1. `hobkin/test/cli-texts-runs.test.mjs` › "each kind's run has hobkin's AGENTS.md and lists its skills, and a Work do run has the coding text in full"
- A2. `host/test/claude-code-harness.test.ts` › "a Claude run loads no setting source, keeps auto memory off, and is told hobkin's texts with the project's own beneath them"; check: in the live runs (S12), the Claude run's system prompt holds no line of the user's `~/.claude/CLAUDE.md`.
- A3. `hobkin/test/cli-owned-lifecycle.test.mjs` › "a Work helper gets its own brief and a role no wider than its parent's, one writer runs at a time, and the lead can spawn again"; `hobkin/test/cli-texts-runs.test.mjs` › "discover and look runs are offered no owned_agent"
- A4. `hobkin/test/cli-run-guard.test.mjs` › "an edit of a file an expert covers waits until the run has read that expert"; `host/test/claude-code-guard.test.ts` › "Claude's hook holds an edit until the expert was read"
- A5. `hobkin/test/cli-work-plan.test.mjs` › "the plan command refuses a plan with a field missing or a layer over 300 lines that is not mechanical, and says which" and › "a do run's edits wait for its plan, and a run that committed cannot record branch or pr without one"
- A6. `hobkin/test/cli-work-plan.test.mjs` › "the outcome keeps the estimate beside the branch's changed lines"; check: the description of the Work do run in S12 names both and the layers left for later.
- A7. `hobkin/test/cli-run-guard.test.mjs` › "a commit, a PR or an issue waits until the run has read the humanizer"
- A8. `ui/test/texts-rules.test.ts` › "each text shows where it loads and whether it is hobkin's, edited, or behind a newer version"; `host/test/texts.test.ts` › "a skill saved without its name or description is refused and the copy stays"; check: Settings › Skills with a host on a test home, as a still render (server markup with the app's built CSS, no browser), dark and light: hobkin's rows in each state, the editor open, a refused save. Then walk the section with the keyboard.
- A9. `host/test/texts.test.ts` › "hobkin reads the texts, and only the window changes them"; `hobkin/test/cli-texts.test.mjs` › "hobkin texts lists, shows, sets and resets a text, and the next run takes it"
- A10. `hobkin/test/cli-texts.test.mjs` › "a text nobody edited follows hobkin's newer version" and › "an edited text gets one offer per newer version, and each choice does what it says"
- A11. `hobkin/test/cli-texts.test.mjs` › "the old Big work paragraphs get one offer, and Remove takes out only those"
- A12. check: read every file under `hobkin/src/prompts/skills/` and `hobkin/src/prompts/hobkin-agents.md`. `rg -n "Leo" hobkin/src/prompts/skills hobkin/src/prompts/hobkin-agents.md` finds nothing; each tool and command named is one hobkin or Pi has; `swift` and `humanizer` carry their LICENSE; `wc -w` on each is within its limit.
- A13. check: in S12, the study look's `work.projectFile` has both headings, and the do run's plan names its languages and examples.
- A14. check: `rg -n "agentic_code_review|security-expert|test-expert|database-engineer" hobkin/src/prompts` finds nothing, and `work-do.md` step 8 names `security`, `tests` and `sql`.
- A15. `hobkin/test/cli-report-editor.test.mjs` › "the report editor writes by the humanizer skill's text, the user's edit included"; `hobkin/test/cli-brief.test.mjs` › "a brief follows the same humanizer text"
- A16. `hobkin/test/cli-texts-runs.test.mjs` › "a guide is listed only in runs that load its package, and code-mode in every run with tools"

## Steps

The window hot-reloads every save and the live host restarts onto newer host code when idle, so each step leaves the app working. New modules are built and tested with nothing importing them, and the live paths (`application.mjs`, `harnesses.mjs`, `pi-session.mjs`, `host.ts`, the Claude harness) change last. S1 comes first. S2 and S4 can be built at once after it: they share no file. S3 needs S2, since the guard reads the experts' file patterns from the manifest. S5 needs S2, S3, and 038's S3 and S4. S6, S8 and S9 need S2. S7 needs S3, S4 and S5. S10 needs S2 and S3. S11 starts on sample data at once and connects after S9. S12 is last.

- [ ] S1 (A12). The bundled texts, which nothing reads yet. Create `hobkin/src/prompts/hobkin-agents.md`, `hobkin/src/prompts/texts.json`, and under `hobkin/src/prompts/skills/`: `coding/SKILL.md`, `team-leader/SKILL.md`, `teams/SKILL.md`, `humanizer/SKILL.md` with `humanizer/LICENSE` (a copy of `humanizer.LICENSE`), `pr-description/SKILL.md`, `ruby/SKILL.md`, `javascript/SKILL.md`, `react/SKILL.md`, `swift/SKILL.md` with `swift/LICENSE`, `sql/SKILL.md`, `tests/SKILL.md`, `security/SKILL.md`, `design/SKILL.md`, `code-mode/SKILL.md`, `agentic-search/SKILL.md` and `web-search/SKILL.md`. Each is adapted from the source the table names, with the post-processing guidance folded into the experts. The humanizer skill is a copy of `humanizer.md` from line 42 until S6 makes it the only one.
- [ ] S2 (A9, A10, A11). Runtime: the texts, unwired. Reading the manifest; each text's effective file (the home's copy or hobkin's); saving with its checks; reset; `texts/state.json`; what a release brought for edited and unedited texts; the old Big work paragraphs in Your directions; and the `hobkin texts` command. Files: new `hobkin/src/cli/texts.mjs`, `hobkin/src/cli/main.mjs`; tests new `hobkin/test/cli-texts.test.mjs`. No run reads a text through it yet, and the command changes nothing else.
- [ ] S3 (A4, A5, A7). Runtime: the guard and the plan, unwired. The pure decision; the Pi extension that asks it at `tool_call`; the hook script that asks it for Claude Code, from Claude's hook input and transcript; `assertPlan` and the plan on the item; and `hobkin work plan`. Files: new `hobkin/src/cli/run-guard.mjs`, new `hobkin/src/cli/run-guard-extension.mjs`, new `hobkin/src/cli/run-guard-hook.mjs`, `hobkin/src/cli/work/store.mjs`, `hobkin/src/cli/work/commands.mjs`; tests new `hobkin/test/cli-run-guard.test.mjs`, new `hobkin/test/cli-work-plan.test.mjs`. No run loads the extension and no request names the command yet.
- [ ] S4 (A3). Runtime: helpers that a Work lead can brief. `brief` and `role` on a spawn, a Work helper's own prompt, one writer at a time, no nested helpers in Work, and spawning again after a wave of reports. Files: `hobkin/src/cli/owned-agent-tool.mjs`, `hobkin/src/cli/owned-agents.mjs`, `hobkin/src/cli/owned-agent-lifecycle.mjs`, `hobkin/src/cli/owned-agent-session.mjs`; tests `hobkin/test/cli-owned-lifecycle.test.mjs`, `hobkin/test/cli-owned-agent-session.test.mjs`. `brief` and `role` are optional in the tool, so the main chat's helpers work as now, and Work runs keep helpers off until S7.
- [ ] S5 (A1, A4, A7, A16). Runtime: hobkin's texts and the guard in every Pi run. hobkin's AGENTS.md and the kind's skills in the main chat; in Background, Work and durable runs through 038's run wrapper; in helpers; the guard extension in each; `HOBKIN_INSTRUCTIONS` listing the texts by kind. Files: `hobkin/src/cli/pi-session.mjs`, `hobkin/src/cli/run-resources.mjs` (038 S4), `hobkin/src/cli/harnesses.mjs`, `hobkin/src/cli/pi-extensions.mjs`, `hobkin/src/cli/hobkins.mjs`, `hobkin/src/cli/resource-catalog.mjs`; tests new `hobkin/test/cli-texts-runs.test.mjs`. From here the guard holds expert reads and the humanizer. The plan hold waits for S7.
- [ ] S6 (A15). Runtime: one humanizer text. `humanizer.md` keeps the report editor's own part, and the report editor and the brief add the humanizer skill's effective text. Files: `hobkin/src/prompts/humanizer.md`, `hobkin/src/cli/report-editor.mjs`, `hobkin/src/cli/brief.mjs`; tests `hobkin/test/cli-report-editor.test.mjs`, `hobkin/test/cli-brief.test.mjs`.
- [ ] S7 (A3, A5, A6, A13, A14). Work's flow goes live. `work-do.md`: the coding text in full, `work.commands.plan`, helpers through `owned_agent`, step 8 without a review tool and with hobkin's experts. `work-look.md`: Architecture and Languages under the study headings (`work-look.md:16-25`). `work-discover.md:13`, `agents-default.md` as the seed of Your directions, `background.md:12` naming hobkin's AGENTS.md beside the directions, and the `hobkin texts` line in `v2-runtime.md`. The director adds `plan` to a do run's commands (`work/director.mjs:522`) and turns the plan hold on; helpers open for do runs (`application.mjs:338-339`), and discover and look runs no longer get the `owned_agent` tool (`harnesses.mjs:121`); recording `branch` or `pr` without a plan is refused, and the changed lines are counted. Files: those prompts under `hobkin/src/prompts/`, `hobkin/src/cli/work/director.mjs`, `hobkin/src/cli/work/commands.mjs`, `hobkin/src/cli/application.mjs`, `hobkin/src/cli/harnesses.mjs`; tests `hobkin/test/cli-work-plan.test.mjs`, `hobkin/test/cli-application.test.mjs`, `hobkin/test/cli-work-commands.test.mjs`.
- [ ] S8 (A10, A11). Runtime: the update story at open. A line beside `templateLine` that files the Action Items, and their answers. Files: `hobkin/src/cli/application.mjs`, `hobkin/src/cli/answer.mjs`; tests `hobkin/test/cli-texts.test.mjs`, `hobkin/test/cli-answer.test.mjs`.
- [ ] S9 (A9). Host: the protocol and the three commands, with `host.ts` wired last. Files: new `shared/protocol/texts.ts`, `shared/commands/registry.ts`, new `host/src/texts.ts`, `host/src/hobkin.d.ts`, `host/src/host.ts`; tests new `host/test/texts.test.ts`.
- [ ] S10 (A2, A4, A5, A7). Host: Claude Code runs. `--setting-sources` with no source, auto memory off, S3's `hobkin/src/cli/run-guard-hook.mjs` as a PreToolUse hook in `--settings`, and the appended prompt with hobkin's texts, the skill list and the project's files. Files: `host/src/claude-code/harness.ts`, `host/src/claude-code/directions.ts`, `host/src/claude-code/agents.ts`; tests `host/test/claude-code-harness.test.ts`, new `host/test/claude-code-guard.test.ts`.
- [ ] S11 (A8). Settings: hobkin's texts at the top of Settings › Skills, on sample data with no host and on the host's state with one. Files: new `ui/src/features/skills/HobkinTexts.tsx`, `TextEditor.tsx`, `texts-store.ts`, `texts-rules.ts` and `texts-sample.ts` in the same folder, and one line in `ui/src/features/skills/SkillsScreen.tsx` that mounts the section; tests new `ui/test/texts-rules.test.ts`. 038 S6 changes the Pi rows of the same page, and this step touches only that one line of it.
- [ ] S12 (A2, A5, A6, A13). One study look and one Work do run on a test home, each on Pi and on Claude Code, with the user's go-ahead, since they spend the subscription. Never the real home. Check what each run's system prompt held, that the plan came before the first edit and the expert before the first edit of its language, that the humanizer came before the commit, and that the project's AGENTS.md sat beneath hobkin's text. On Claude Code, also check that `claude` took `--setting-sources` with no source and ran the guard's hook.

## Open questions

- Which texts the user can edit. (a) The texts in the table and Your directions, as decided: the runtime prompts stay fixed, so no edit can break a command contract a run depends on, but some of hobkin's text stays out of reach. (b) Every prompt file, with Reset: the whole of hobkin becomes editable, and an edit that drops a contract, such as the shape of `work.commands.item`, breaks Work runs until it is reset. A check on save could catch only the contracts it knows.
- Whether the extensions the guides cover start chosen. (a) Blank until the user chooses them, by 038's rule: Work searches code with `rg` and has no web search until then, and the two guides wait. (b) pi-agentic-search and one web search package start chosen for Work, Background and Durable when installed, once: Work has them from the start, but it is a default the user did not set, and 038 asks that defaults never come back by themselves. Either way, pi-web-access and pi-search-hub both register a tool named `web_search` (`pi-web-access/index.ts`, `pi-search-hub/extensions/search-hub.ts`), so choosing both for one kind collides, and one of them should be the guide's.
- The humanizer in the main chat. (a) The core rules in hobkin's AGENTS.md and the full guide listed, as decided: replies follow the short rules, and the full guide is read before longer text. (b) The full guide in every main chat turn: every reply is written with it, at about 4,600 more words of system prompt on every turn, cached after the first.
- Pi's global switches on the two Settings pages. (a) Replaced by 038's switches for each kind, as decided: one switch per kind on each row, and the user's own Pi is changed only in the terminal. (b) Kept beside them, as "On in your Pi": nothing 039 shipped is removed, but each row has two kinds of switch, and the global one also decides what hobkin offers.
- If the installed `claude` refuses an empty `--setting-sources`, or ignores hooks in `--settings`. (a) `--safe-mode`, which its help documents as loading no CLAUDE.md, skills, plugins, hooks, MCP servers or auto memory: one flag, but the user's MCP servers go too, and Claude Code calls it a troubleshooting mode. (b) Keep the flags that work, and on Claude Code hold the plan and the humanizer only at record time: nothing is lost, but an edit before the plan is caught after the work is done.
- Helpers beyond Work do runs. (a) Off for delegated jobs, routines and durable hobkins, as decided: no budget admits them. (b) Delegated jobs get helpers under a token cap per job: big delegated work can split, but it needs an admission rule of its own.
