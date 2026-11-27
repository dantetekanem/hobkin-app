---
{
  "id": "033-claude-code-agents",
  "title": "hobkin's other agents on Claude Code",
  "kind": "work",
  "status": "doing",
  "depends": ["011-work", "020-settings", "021-agent-rendering", "022-questions"],
  "updated": "2026-11-27"
}
---
# hobkin's other agents on Claude Code

## Outcome

hobkin's other agents, the Work runs, the jobs it delegates and its routines, can run on Claude Code instead of Pi. The main chat stays on Pi. The user turns it on in Settings and picks which agents, the model, the thinking effort and what they may do without asking. An agent on Claude Code runs headless in the background. Its canvas draws its work the same way it draws a Pi agent's, the user talks to it from there as before, and a question Claude asks comes up on the question sheet with the answer going back to Claude. Settings also gets Subscriptions: every provider connected through Pi, and Claude Code, shown as in use, available, or one click away from its install page.

## Decisions

- The harness is the installed `claude` CLI: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --replay-user-messages --permission-prompt-tool stdio`, with `--permission-mode`, `--session-id` (the run's id), `--append-system-prompt` (hobkin's directions for the run), `--model` unless the choice is the account's default, and `--effort`. The Agent SDK is not added: it bundles a second copy of Claude Code, and the CLI speaks the same protocol on its own (its help names the SDK host as the one that answers permission prompts).
- Not `--bare`: bare mode skips the claude.ai sign-in, so it would need an API key. The user's own Claude Code setup (CLAUDE.md, skills, MCP servers, hooks) loads as in any `claude -p` run.
- Routing lives in the host. The host passes hobkin a `runHarness` that sends a run to Claude Code when the settings name its kind, and to hobkin's own Pi harness otherwise, rebuilt exactly as hobkin builds it. hobkin's runtime is unchanged.
- Only runs that use tools route: Work's discover, look and do runs, jobs from `hobkin session`, and routines. Reflection, compatibility checks, the humanizer and migration repair stay on Pi. A run's kind comes from its record: Work by its purpose, a delegated job by its schedule id `session.*`, any other run with no purpose a routine.
- Settings are the host's, in `<data root>/client/claude-code.json`. `claude-code.read` reports them with what the host found of Claude Code, and hobkin may call it. `claude-code.apply` is window-only (`outside`), because it spends the user's Claude subscription and sets what agents may do.
- Model: `default` passes none, so Claude Code uses the account's default. Otherwise one of its aliases: opus, sonnet, haiku, fable. Effort follows the agent's tier (off, minimal and low become low; medium, high, xhigh and max pass through) or is fixed.
- Permissions map onto `--permission-mode`: auto to `auto`, ask to `default`, edits to `acceptEdits`, all to `bypassPermissions`. Whatever Claude Code would ask the user about comes to the host, which asks on the question sheet: Allow, Don't allow, or the user's own words, which deny and tell Claude why.
- AskUserQuestion: each of Claude's questions (it asks one to four) is a question on the sheet, from the run's title, with its header as the summary line, its options as the choices, and a field for the user's own words. A multi-select question takes one pick or the user's own list. The answers go back keyed by each question's text. A question put off, left two minutes on the sheet, or one that cannot be asked for ten minutes, tells Claude the user put it off and to go on with its best judgment and say what it assumed. A permission prompt in the same case is denied. So an agent never waits on a user who is away, and the sheet is never held from hobkin's own questions for long.
- An agent's question is never dressed as one of hobkin's filed decisions, so it never shows a recommendation or a reason the agent did not give.
- Talking: the agent canvas's talk box writes a user message into Claude's input. `--replay-user-messages` gives the note's receipt. A run ends at its first result: its input closes, Claude finishes whatever it had queued, and the process ending ends the run. A message after that is refused as it is for a Pi run that has finished. Claude takes a message it was sent only once its turn has ended, however long that is, so a plain message or a follow-up waits for the whole turn. A message sent to interrupt (Control+Enter in the talk box) is forced instead (the user, 2026-11-27: "ctrl+enter should force steer a message", "should be suported for claude code too"): the harness writes Claude's `interrupt` control request and then the message, Claude ends the turn under way with a result of its own (`error_during_execution`) and takes the message next, about a second later. That result is not the run's end while the message is still to be taken, which Claude says by replaying it with the id it was sent with, so the run goes on taking messages until the turn the message starts ends. A message Claude never takes ends the wait after thirty seconds. What already waited stays Claude's and is taken with it. Alt+Up takes nothing back from Claude, which gives none of its queue back, and writes it nothing.
- Activity: Claude's stream becomes the activity events Pi's runs produce, so the dock, the agent canvas and the blocks of `021-agent-rendering` draw it unchanged. Text streams in, tool calls show with their input and output, a failed Bash command keeps its exit code, and thinking never shows. Work inside Claude's own subagents (records with a `parent_tool_use_id`) is not drawn; the Agent call shows as one tool.
- Usage: the run's session file gets a record in Pi's format: a header with Claude's session id, a line for each reply with its token usage, a line for each tool result. Work's daily budget, its stall check and its identity check read a Claude run as they read a Pi run. The cost is Claude Code's own estimate from its result.
- Stop interrupts Claude and closes its input, sends SIGTERM if it has not gone within two seconds and SIGKILL at four. Force sends SIGTERM at once and SIGKILL a second later. Claude Code starts its shell commands in process groups of their own and ends them itself on SIGTERM, so a SIGKILL alone would leave a running command behind. A host that exits sends SIGTERM to each Claude run still going.
- Subscriptions is a tile: one row per provider Pi can reach, with how it is connected, and a Claude Code row with its version and plan, "Used by agents" while agents run on it, and "Get Claude Code" when it is missing.
- The Claude Code tile holds the settings above. It says in one line that agents on Claude Code spend the Claude subscription. With Claude Code missing, it says so instead of offering choices that cannot run.
- A tier on Claude Code (2026-11-21). In the Models lightbox (`017-model-tiers`) each of the four tiers can be set to a model Pi can use, as before, or to Claude Code with one of its models (default, opus, sonnet, haiku, fable), from a "Claude Code" group after Pi's providers in the model list. Its thinking levels are Claude Code's, low to max, and a level below low moves to low.
- The tier keeps its Pi model in hobkin's config, so hobkin's own tier rules are unchanged (2026-11-21). That it runs on Claude Code, with which model and level, the host keeps in `claude-code.json` under `tiers`, beside the settings above. Choosing a Pi model for the tier, or letting it follow again, takes Claude Code off it. A file from before has no `tiers` and reads as no tier on Claude Code.
- A run of a kind that routes (above) at a tier on Claude Code runs there with the tier's model and level, whatever the tile's switches say (2026-11-21). A kind switched on in the tile still runs at every tier on Claude Code, with the tile's model and effort unless its tier names its own. A run's tier is the one its record names, as a delegated job's does, and for a Work look or do the one its project's level gives that kind of run (hobkin's `levels`, and max for an item made max and for the state-machines look). Discover runs and routines name none, so only the tile's switches move them. The tier's Pi model runs everything that cannot run on Claude Code.
- The lead stays on Pi (2026-11-21): its list offers Pi's models only and says so in one line where the Claude Code group would be. With Claude Code not found, the group says so and offers nothing. The window offers the group only when `claude-code.read` reports `tiers`, so it never offers what a host from before cannot keep. A tier is set on Claude Code through `claude-code.apply`, so only the window sets it.
- A tier on Claude Code reads so wherever its model is named (2026-11-21): "Claude Code · opus" and its level in the Models tile and on its card. The Claude Code tile's heading names the tiers on Claude Code while no kind is switched on, and Subscriptions says Claude Code is used by agents while a tier is on it.

## Out of scope

- The main chat on Claude Code.
- hobkin's own helpers (`owned_agent`) and the theme child on Claude Code. They depend on Pi's bridge for `owned_agent` and `custom_style`.
- Opening a Claude run's full transcript through `agent.session`, which reads Pi sessions only.
- Signing in to Claude Code from the app. `claude` does that itself.

## Acceptance

- A1. With Claude Code off, every run starts exactly as before, on Pi.
- A2. With Claude Code on for Work, a Work "do" run starts `claude -p` in the item's folder with stream-json in and out, the chosen model and permission mode, the tier's effort and the run's id as its session id, and Pi does not start.
- A3. A run's kind decides its route: with Work on and routines off, a routine starts on Pi, and reflection, compatibility checks and the humanizer start on Pi whatever the settings.
- A4. A Claude run draws on the agent canvas as a Pi run does: its text streams into a Says block, a Bash call shows its command, output and exit code, an edit shows as a code change of its file, and no thinking shows.
- A5. A message sent from the agent canvas reaches Claude as a user message, and the note's receipt arrives once Claude takes it in. Images attached to it, or to the run's first prompt, reach Claude as its own image blocks, and the receipt counts them.
- A6. A question Claude asks with AskUserQuestion shows on the sheet from the agent, with its options as choices and a field for the user's own words. The chosen label, or the words, go back to Claude as its answer. Two questions show one after the other.
- A7. A question put off, or one that cannot be asked, tells Claude the user put it off and to go on with its best judgment, and the run carries on.
- A8. Under "ask", a command Claude wants to run asks Allow or Don't allow on the sheet. Don't allow, or the user's words, deny it and Claude hears why.
- A9. A finished Claude run ends completed with Claude's final text as its result, its cost estimate and its tokens, and Work's daily tokens count what it spent.
- A10. Stop ends a running Claude agent within five seconds and the run ends interrupted. Force ends it within about a second.
- A11. Claude Code missing, or failing to start, ends the run failed with a reason the user can read.
- A12. Subscriptions lists each provider Pi can reach and how, and Claude Code with its version and plan when it is installed and signed in. When it is missing, "Get Claude Code" opens its install page in the browser.
- A13. The Claude Code tile turns agents on Claude Code on and off and picks which agents, the model, the effort and the permissions, and the choices hold after the host restarts. hobkin can read them and cannot change them.
- A14. A delegated job, and a Work look or do, at a tier set to Claude Code starts `claude -p` with the tier's Claude model and level, also with the tile's switches off, and at a tier not set it starts as before. A kind switched on in the tile goes to Claude Code at every tier, with the tile's model unless its tier names its own. Reflection, checks and the humanizer stay on Pi. (2026-11-21)
- A15. The tiers on Claude Code hold after the host restarts, a `claude-code.json` from before reads as none, and hobkin's client tool is refused when it tries to set one. (2026-11-21)
- A16. A tier's model list offers the Claude Code group only when the host reports tiers on Claude Code and found Claude Code, and with Claude Code missing it says so and offers nothing. Choosing a Claude model keeps the tier's Pi model, and choosing a Pi model takes Claude Code off. The lead's list never offers it. When the group appears with the list open, nothing above it moves. (2026-11-21)
- A17. A tier on Claude Code reads "Claude Code · " and its model, with its level, in the Models tile and on its card, and its card offers Claude Code's levels, low to max. (2026-11-21)
- A18. A message sent to interrupt stops Claude's turn under way and is what it takes next, and the run goes on taking messages until the turn that message starts ends. A message sent any other way stops nothing. Taking back what waits writes Claude nothing and gives nothing back. (2026-11-27)

## Proof

- A1. `host/test/claude-code-route.test.ts` › "with Claude Code off every run goes to Pi"
- A2. `host/test/claude-code-harness.test.ts` › "starts claude headless with the run's settings"; `host/test/claude-code-agents.test.ts` › "a live home's harness is hobkin's own for Pi runs and Claude Code's for the rest"
- A3. `host/test/claude-code-route.test.ts` › "a run's kind decides its route"
- A4. `host/test/claude-code-stream.test.ts` › "Claude's stream becomes the activity a Pi run gives"; check: watch a Claude Work run's canvas.
- A5. `host/test/claude-code-harness.test.ts` › "a message reaches Claude and its receipt follows" and › "images the user attached go to Claude as image blocks, and the receipt counts them"
- A6. `host/test/claude-code-asking.test.ts` › "each question goes to the sheet and the answers go back"
- A7. `host/test/claude-code-asking.test.ts` › "a question put off or unaskable lets Claude go on"; check: in the live run (S6), put a question off and see Claude carry on.
- A8. `host/test/claude-code-asking.test.ts` › "a permission prompt asks allow or don't allow"; check: in the live run (S6) under "ask", answer Don't allow and see Claude hear why.
- A9. `host/test/claude-code-harness.test.ts` › "a finished run reports its text, cost and tokens, and records its usage"
- A10. `host/test/claude-code-harness.test.ts` › "stop interrupts and ends the run, and force kills it" (the order of interrupt, SIGTERM and SIGKILL); check: time a Stop and a Force in the live run (S6).
- A11. `host/test/claude-code-harness.test.ts` › "a claude that cannot start fails the run with its reason"
- A12. `host/test/claude-code-install.test.ts` › "finds claude, its version and its sign-in"; `ui/test/subscriptions.test.ts` › "lists what Pi reaches and how" and "the Claude Code row says what is true of it"; check: Settings with Claude Code installed, and with it missing. Seen 2026-11-13 as a still render (server markup with the app's built CSS, no browser), on, off and missing, dark and light: each provider's row with how it connects, Claude Code with its version and plan or "Get Claude Code", and one keyboard stop per control.
- A13. `host/test/claude-code-settings.test.ts` › "settings hold across a restart and only the window changes them"; `ui/test/claude-code-save.test.ts` › "two quick changes send one merged change and the settings follow each at once" (a choice only passed through on the arrow keys, such as Everything, is never saved); check: change each control, restart the host, read the tile.
- A14. `host/test/claude-code-route.test.ts` › "a run at a tier on Claude Code goes there with the tier's model and level" and › "the tile's switch still sends every tier, with the tile's model unless the tier names its own"; `host/test/claude-code-tier.test.ts` › "a Work run's tier is the one its project's level gives it"
- A15. `host/test/claude-code-settings.test.ts` › "settings hold across a restart and only the window changes them" (with a tier on Claude Code) and › "a file from before has no tier on Claude Code"
- A16. `shared/test/tiers-claude-code.test.ts` › "the Claude Code group is offered only when the host keeps tiers on it and found Claude Code" and › "choosing a Claude model keeps the tier's Pi model, and a Pi model takes Claude Code off"; check: read the list against Pi's groups (the group comes last, so nothing above it moves).
- A17. `shared/test/tiers-claude-code.test.ts` › "a tier on Claude Code reads so, with Claude Code's levels"; check: read the Models tile's rows and the card.
- A18. `host/test/claude-code-harness.test.ts` › "a message sent to interrupt stops the turn under way and is what Claude takes next, and the run goes on taking messages", › "a message sent any other way does not stop the turn, and the first result still ends the taking of messages", › "an interrupting message Claude never takes does not hold the run open for good" and › "taking back what waits writes nothing to Claude, which keeps its own queue, and gives nothing back". Two runs of the real Claude Code 2.1.332 with the harness's flags and no tools (2026-11-27): an interrupt and a message written while it answered ended that turn at once and the message was answered a second later, and with the input left open two messages sent after it were taken once its turn ended. Control+Enter in the live window on a Claude Code agent was not seen.

## Steps

- [ ] S1 (A2, A4, A5, A9, A10, A11). The Claude harness: the process, its stream as activity, messages, the session record, stop and force.
- [ ] S2 (A6, A7, A8). Questions and permission prompts through the sheet.
- [ ] S3 (A12, A13). Finding Claude Code, the settings file, and the two commands.
- [x] S4 (A1, A3). Routing runs by kind through the host's `runHarness`.
- [ ] S5 (A12, A13). The Subscriptions and Claude Code tiles.
- [ ] S6 (A4, A6). One live run on the real Claude Code, with the user's go-ahead, since it spends their subscription.
- [ ] S7 (A14, A15, A16, A17). Tiers on Claude Code: the host keeps them and routes by them, and the lightbox and the Models tile offer and show them (2026-11-21).
- [x] S8 (A18). Control+Enter forces a message into a Claude Code agent's turn (2026-11-27).

## Open questions

- A question Claude asks that the user puts off tells Claude to go on. Holding the agent until the question is answered from Action Items needs Action Items to answer a live agent. Is going on the right default?
- hobkin's own helpers on Claude Code would need `owned_agent` served to Claude, for instance over MCP. Is that wanted?
- hobkin may run `question.answer` through its client tool. An agent's permission prompt can only be answered with its id, which nothing gives hobkin, but the command does not refuse it outright. Should answering an agent's question be the window's alone?
- Work pauses for a provider's usage limit when the failure's words say so (`usageLimitIn` in hobkin's `src/cli/work/usage.mjs`). It matches "Claude AI usage limit reached", but Claude Code may word it "You've hit your limit". Telling them apart is hobkin's runtime, which this work leaves unchanged.
