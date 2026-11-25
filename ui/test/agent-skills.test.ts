import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { skillsOf } from '../src/features/agent-activity/skills.ts'
import { stepsOf, type Step } from '../src/features/agent-activity/steps.ts'

// Entries as hobkin keeps them (src/cli/job-activity.mjs): the arguments as indented JSON, the result's text only. A run on
// Claude Code reaches them with Claude Code's own tool names and inputs (host/src/claude-code/stream.ts).
const call = (id: string, name: string, args: object, output: string, state: ActivityEntry['state'] = 'completed'): ActivityEntry => ({
  id: `tool:${id}`,
  kind: 'tool',
  name,
  state,
  input: JSON.stringify(args, null, 2),
  output,
})

const SKILLS = '/Users/someone/.pi/agent/skills'

/** hobkin's tool: its result starts with the skill's name and folder. An unknown name is refused with the names it can load. */
function loadSkill(id: string, name: string, state: ActivityEntry['state'] = 'completed'): ActivityEntry {
  const loaded = `${name}\n${SKILLS}/${name}\n\nThe instructions.`
  const refused = `Unknown skill "${name}". Skills you can load: humanizer, agentic-search`
  return call(id, 'load_skill', { name }, state === 'failed' ? refused : loaded, state)
}

/** Pi's read tool. */
function piRead(id: string, path: string, state: ActivityEntry['state'] = 'completed'): ActivityEntry {
  const read = '---\nname: a skill\n---\nThe instructions.'
  const missing = `ENOENT: no such file or directory, access '${path}'`
  return call(id, 'read', { path }, state === 'failed' ? missing : read, state)
}

/** Claude Code's read tool. */
const claudeRead = (id: string, path: string) => call(id, 'Read', { file_path: path }, '1\t---\n2\tname: a skill')

/** Claude Code's own Skill tool. */
function claudeSkill(id: string, skill: string, state: ActivityEntry['state'] = 'completed'): ActivityEntry {
  const output = state === 'failed' ? `Unknown skill: ${skill}` : `Launching skill: ${skill}`
  return call(id, 'Skill', { skill }, output, state)
}

const bash = (id: string, command: string) => call(id, 'bash', { command }, '(no output)')

test('the skills an agent loaded, each once, in the order first loaded, from load_skill, SKILL.md reads and Claude Code', () => {
  const entries = [
    loadSkill('1', 'humanizer'),
    piRead('2', `${SKILLS}/agentic-search/SKILL.md`),
    claudeSkill('3', 'anthropic-skills:pdf'),
    claudeRead('4', '/Users/someone/.claude/skills/react-engineer/SKILL.md'),
    // The same skill again, by each way, counts once, where it was first loaded.
    piRead('5', `${SKILLS}/humanizer/SKILL.md`),
    loadSkill('6', 'agentic-search'),
    claudeSkill('7', 'anthropic-skills:pdf'),
  ]

  assert.deepEqual(skillsOf(entries), ['humanizer', 'agentic-search', 'anthropic-skills:pdf', 'react-engineer'])
})

test('a failed load counts for nothing, and a load still running counts', () => {
  const entries = [
    loadSkill('1', 'no-such-skill', 'failed'),
    piRead('2', `${SKILLS}/gone/SKILL.md`, 'failed'),
    claudeSkill('3', 'missing', 'failed'),
    loadSkill('4', 'humanizer', 'failed'),
    bash('5', 'ls'),
    // Loaded at last: it counts from here.
    loadSkill('6', 'humanizer', 'running'),
  ]

  assert.deepEqual(skillsOf(entries), ['humanizer'])
})

test('only a file named SKILL.md is a skill, named by its folder', () => {
  const entries = [
    piRead('1', `${SKILLS}/humanizer/README.md`),
    piRead('2', `${SKILLS}/humanizer/references/MY_SKILL.md`),
    piRead('3', `${SKILLS}/humanizer/SKILL.md.bak`),
    // With no folder in its path, there is no name to give it.
    piRead('4', 'SKILL.md'),
    piRead('5', 'skills/ticket-writer/SKILL.md'),
    // A call with no skill's name loads nothing.
    call('6', 'load_skill', {}, 'Name a skill to load.'),
    call('7', 'Skill', { args: 'x' }, ''),
    // Words that name a skill load nothing.
    { id: 'message:1:0', kind: 'assistant', text: 'I will read humanizer/SKILL.md.' },
  ] satisfies ActivityEntry[]

  assert.deepEqual(skillsOf(entries), ['ticket-writer'])
})

const kinds = (steps: readonly Step[]) => steps.map((step) => step.kind)

test('where the page shows the loaded skills in their own line, the loads are not steps, and one that failed still is', () => {
  const work = [
    piRead('1', '/repo/src/app.ts'),
    piRead('2', `${SKILLS}/humanizer/SKILL.md`),
    piRead('3', '/repo/src/app.test.ts'),
    loadSkill('4', 'agentic-search'),
    bash('5', 'git status'),
    claudeSkill('6', 'anthropic-skills:pdf'),
    bash('7', 'pnpm test'),
    // A group of reads that held only skills is not drawn: the commands on either side are one group.
    piRead('8', `${SKILLS}/react-engineer/SKILL.md`),
    bash('9', 'git diff'),
    loadSkill('10', 'no-such-skill', 'failed'),
  ]

  const steps = stepsOf(work, { tasksOnLine: true })
  const everyCall = stepsOf(work)

  assert.deepEqual(kinds(steps), ['looks', 'shell', 'tool'])
  const [reads, commands, failedLoad] = steps
  assert.ok(reads?.kind === 'looks' && commands?.kind === 'shell' && failedLoad?.kind === 'tool')
  // The SKILL.md read left its group of reads: the files on either side of it are one group, as if it were not there.
  assert.deepEqual(reads.looks.map((look) => look.what), ['/repo/src/app.ts', '/repo/src/app.test.ts'])
  assert.equal(commands.commands.length, 3)
  assert.deepEqual([failedLoad.name, failedLoad.state], ['load_skill', 'failed'])
  // A page without the line still draws every call.
  assert.deepEqual(kinds(everyCall), ['looks', 'tool', 'shell', 'tool', 'shell', 'looks', 'shell', 'tool'])
})
