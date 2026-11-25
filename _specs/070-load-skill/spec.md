---
{
  "id": "070-load-skill",
  "title": "load_skill, and the loaded skills line",
  "kind": "work",
  "status": "doing",
  "depends": ["021-agent-activity"],
  "updated": "2026-11-24"
}
---
# load_skill, and the loaded skills line

## Outcome

hobkin's agents load a skill with a `load_skill` tool, by its name, instead of reading its `SKILL.md` with the read tool. An agent's page shows the skills it loaded as one line in the row with tasks, helpers and teams: "3 loaded skills". Hovering it, or focusing it with the keyboard, lists their names.

The user, 2026-11-24: "feature: load_skill as a tool for hobkin (instead of just reading), which will also display as "x loaded skills" like tasks do, and hovering will just list the name of all skills."

## Decisions

### The tool

- `load_skill { name }` answers with the skill's instructions, its `SKILL.md` without the front matter, and the folder it lives in, so the files the skill names can be read from there. An unknown name is refused with the names the agent can load.
- The skills it can load are the ones the agent is already offered: Pi's own list for that agent, hobkin's shipped skills included. The tool adds no skill and no permission.
- Every Pi agent hobkin runs gets it: the main conversation, work runs, routines, durable hobkins and helpers.
- The prompts that tell an agent to read a skill tell it to call `load_skill` instead.

### What counts as loaded

- A `load_skill` call that succeeded, a read of a file named `SKILL.md` (its folder's name is the skill's name), and Claude Code's own `Skill` tool, so agents on either engine show the line.
- One skill loaded twice counts once. A failed load counts for nothing.

### On the page

- The line sits in the same row as tasks, helpers and teams, at the left, as wide as its words, and does not glow: a load is over at once.
- It shows only once a skill has been loaded. It says "1 loaded skill" or "3 loaded skills".
- Hover or keyboard focus lists every loaded skill's name in the order they were loaded. Nothing opens on a click.
- The calls it counts are not drawn again as rows in the transcript, as task calls are not.

## Contract

- The tool's name is `load_skill`; its one argument is `name`; its result's text starts with the skill's name and folder, then its instructions.
- The window reads loaded skills from the agent's activity entries alone: a tool call named `load_skill` with `args.name`, a `read` whose path ends in `/SKILL.md`, and a Claude Code `Skill` call with its skill's name.

## Acceptance

- A1. `load_skill` answers a known skill's instructions and folder, refuses an unknown name with the names it can load, and is offered to every Pi agent hobkin runs.
- A2. The prompts that told agents to read a skill name `load_skill`.
- A3. The window counts each skill once from `load_skill`, `SKILL.md` reads and Claude Code's `Skill`, in the order first loaded, and counts no failed load.
- A4. The line says "1 loaded skill" or "N loaded skills", shows only once one is loaded, lists the names on hover and on focus, and moves nothing in its row when it appears or grows.
- A5. The counted calls are not drawn as transcript rows.

## Steps

- [x] S1. The spec (lead). 1c4a44a.
- [x] S2 (A3 to A5). Window: 875da7d, 3cecd21, 9d429ac; `ui/test/agent-skills.test.ts` 4 of 4. Claude Code's `Skill` tool has input `{ skill }`.
- [x] S3 (A1, A2). Runtime: hobkin edef993; `test/cli-load-skill.test.mjs` 4 of 4 on an export of main. Helpers run with `--no-skills` and get no tool; runs under a launcher get no hobkin extensions.
