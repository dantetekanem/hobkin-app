# Ludicrous mode: notes

## S1. What an agent costs, measured on 2026-11-27

The computer: a Mac17,8 with 18 cores (6 performance), 64 GB of memory and 1,068 GB of free disk.

`scripts/perf/ludicrous-measure.ts [count]` starts bare Pi processes (Pi 1.6.0) the way the conductor does, waits until each answers its first RPC command, lets them settle for 6 seconds, then reads the memory and CPU of each one's whole process tree. It prompts nothing, so it spends no tokens. Run it again on another computer to check these numbers there.

| Pi started | Processes each | Memory each | CPU to settle | Ready after |
| --- | --- | --- | --- | --- |
| 1, no extension | 1 | 145 MB | 0.22 s | 186 ms |
| 1, with MCP | 2 | 365 MB | 0.58 s | 196 ms |
| 10 at once, no extension | 1 | 146 MB | 0.35 s | 340 ms for all |
| 10 at once, with MCP | 2 | 371 MB | 0.85 s | 389 ms for all |

- One working turn, on the `fast` model tier with one tool call (`/usr/bin/time -l`): 5.2 s, 0.35 s of CPU, 162 MB at most, 2,216 tokens. An agent waits on the model for nearly all of its time. Memory decides the tier; CPU does not.
- One check, this repository's typecheck (`tsc --noEmit`): 1.6 s, 7.9 s of CPU (about five cores), 1.9 GB at most.
- A check worktree of this repository holds 2,714 tracked files, 24.6 MB. Its installed packages come from pnpm's store, so they cost little more disk.

## How Pi loads MCP servers with no other extension

- Pi's MCP support is a built-in extension. `--no-extensions` turns it off along with every other extension, and `--extension builtin:mcp` turns it back on. A server's tools are reached through `codemode` by default and through `tool_search` when deferred, so a Ludicrous agent loads `builtin:mcp`, `builtin:codemode` and `builtin:tool-search`, plus `load_skill` (070), and nothing else.
- The servers come from `~/.pi/agent/mcp.json`, and from a project's `.pi/mcp.json` only with project trust.
- Each agent starts its own process for every stdio server. On this computer that is the Gmail server, at about 225 MB each (365 MB with MCP, 145 MB without). An HTTP server costs no process, but each agent holds its own connection to it: 100 agents mean 100 connections to Home Assistant at once.
- These are the user's own servers, and the Gmail server can send mail. Go Ludicrous never authorizes sending anything, so the worker and leader prompts forbid it. Nothing in code stops it yet. See the open question below.

## The numbers the code uses

- Memory for one agent: 250 MB (the 162 MB measured in a short turn, with room for a long run's context), plus 225 MB for each stdio MCP server it starts.
- Memory for one check: 2 GB.
- Left for everything else: a quarter of the computer's memory, and never less than 8 GB.
- Check runs at once: one for every six cores, from one to four. Three on this computer. They are the run's only worktrees.
- A tier fits when its agents and the checks fit in what is left. hobkin picks the largest tier that fits, and 30 when none does, and says what a tier above the measure risks.
- On this computer, with the Gmail server: 100 agents need 47.5 GB and 42 GB is free for them, so hobkin picks 50. Without a stdio server it picks 100.
- Start spacing: one agent a second. One start costs 0.35 s of CPU (0.85 s with MCP) and answers in under 0.4 s, so starting one each second uses less than one core. A full 100 tier takes 100 seconds to fill.
- Free disk: planning needs at least 10 GB free, for the check worktrees and what the agents write.

## Settled while building, on 2026-11-27

- Check worktrees sit in the project's Work trees folder, `work/<slug>/trees/ludicrous-check-<n>`, which backups leave out. They are made on a check's first use.
- A run's agent transcripts, logs, unfinished patches, tools and check logs are left out of backups too. Its record, counts and report are kept.
- The live app's host already holds the Mac awake for its whole life (`keepsMacAwake` in `host/src/main.ts`). Ludicrous's own hold, which A18 proves, matters only on a host that does not.
- While a run plans, only planners run, so the conductor commits each step's files itself.
- A leader waits for its area with `wait`, which spends no tokens and returns within ten minutes. After about twenty waits it writes `leader.md` and ends, and a fresh leader picks up from it.
- The final check commits its own verdict, so the verdict holds for the head it left. Any later commit asks for the check again.
- With no reset time known, one agent tries every 30 minutes. The rest start once it has run two minutes without the limit.
- The page shows a plain note, not the form, while its host is from before Ludicrous.

## Not proven yet

- A1 in the live window, A14's benchmarks with 100 agents, and A19's reading of real trails. Each needs the host to start again with this branch, and S10's real run needs the user's go-ahead.

## Open question from S1

- The user's MCP servers in every agent. (a) As decided: every agent gets them all. On this computer that is 100 Gmail processes for a full tier, which brings the pick down to 50, plus 100 connections to Home Assistant, and every agent can send mail or switch a light. (b) Ludicrous agents get no MCP server unless the plan names one the project needs, such as a documentation server. That keeps the tier at 100 and keeps mail and the house out of reach. Pick: (b). The code takes either as one setting.
