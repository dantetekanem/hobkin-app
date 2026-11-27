import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunChild } from '../../shared/protocol/snapshot.ts'
import type { TeamsAgent } from '../../shared/protocol/teams.ts'
import type { ModelChoice } from '../../shared/tiers/tiers.ts'
import { activityAgents, activityHeader, activityLine, elapsedText, helperStays, shownRows, stepAgent, tokenCount } from '../src/features/teams/activity.ts'
import type { ShownTeamsAgent } from '../src/features/teams/rules.ts'

const NOW = 1_800_000_000_000
const teams = (name: string, state: TeamsAgent['state'], extra: Partial<TeamsAgent> = {}): ShownTeamsAgent => ({
  key: `call:${name}`, name, task: `Task of ${name}`, state, startedAt: NOW - 65_000, from: 'teams', run: 'r1', id: `r1/call:${name}`, ...extra,
})
const helper = (name: string, state: RunChild['state'], extra: Partial<RunChild> = {}): RunChild => ({ id: `h-${name}`, name, state, ...extra })
const CHOICES: readonly ModelChoice[] = [{ id: 'openai-codex/gpt-6-luna', name: 'GPT-6 Luna', provider: 'openai-codex', efforts: ['max'], context: 272_000 }]

test('teams agents and helpers make one list, what is still out first, teams agents before helpers in a tie', () => {
  const agents = activityAgents(
    [teams('scout', 'running'), teams('waiting', 'queued'), teams('lost', 'unknown'), teams('lint', 'failed')],
    [helper('reader', 'running'), helper('broken', 'failed'), helper('slot', 'queued')],
  )
  assert.deepEqual(agents.map((agent) => `${agent.kind}:${agent.id}`), [
    'teams:teams:r1/call:scout', 'helper:helper:h-reader', 'teams:teams:r1/call:waiting', 'helper:helper:h-slot',
    'teams:teams:r1/call:lost', 'teams:teams:r1/call:lint', 'helper:helper:h-broken',
  ])
  assert.deepEqual(activityAgents([], []), [])
  assert.equal(activityAgents([], [helper('legacy', 'running', { id: undefined })])[0]!.id, 'helper:legacy', 'a legacy row goes by its name')
})

test("a helper that reported, completed or was cancelled leaves; one still out, failed or never seen to end stays", () => {
  const states: RunChild['state'][] = ['running', 'queued', 'cancelling', 'unknown', 'failed', 'stopped', 'reported', 'completed', 'cancelled']
  assert.deepEqual(states.filter((state) => helperStays(helper('x', state))), ['running', 'queued', 'cancelling', 'unknown', 'failed', 'stopped'])
})

/** The row one teams agent alone makes. */
const teamsRow = (agent: ShownTeamsAgent) => activityLine(activityAgents([agent], [])[0]!, NOW, CHOICES)
/** The row one helper alone makes. */
const helperRow = (child: RunChild) => activityLine(activityAgents([], [child])[0]!, NOW, CHOICES)

test("a running teams agent reads as pi-extended-teams' activity row: model and level, tier, time out, context and what it is doing", () => {
  const scout = teams('scout', 'running', {
    model: 'openai-codex/gpt-6-luna',
    thinking: 'max',
    modelSlot: 'read-review',
    tokens: 26_300,
    progress: 'Tracing the redirect',
    phase: 'grep',
  })

  assert.deepEqual(teamsRow(scout), {
    name: 'scout',
    model: 'gpt-6-luna',
    level: 'max',
    tier: 'read-review',
    elapsed: '1m05s',
    context: { tokens: '26k', share: 10 },
    doing: 'Tracing the redirect',
    ownWords: true,
    tone: 'live',
  })
})

test("a running agent's own words lose their trailing dots, since the row draws its own moving ones", () => {
  const dotted = (progress: string) => teamsRow(teams('scout', 'running', { progress })).doing

  assert.equal(dotted('Writing the report...'), 'Writing the report')
  assert.equal(dotted('Writing the report…'), 'Writing the report')
  assert.equal(dotted('Checked 3.5 files.'), 'Checked 3.5 files')
  assert.equal(dotted('...'), '...', 'words that are only dots stay as they are')
  // An agent no longer running keeps its words whole.
  assert.equal(teamsRow(teams('scout', 'done', { endedAt: NOW, summary: 'Found it...' })).doing, 'done · Found it...')
})

test('a running teams agent without its own words says what it was asked, else its tool or phase, else that it runs', () => {
  // A model the window does not know gives no share of its context.
  const quiet = teams('quiet', 'running', { model: 'anthropic/claude-x', tokens: 900, phase: 'grep', task: 'Find one silly fact\nabout wombats' })
  const tooling = teams('tooling', 'running', { task: '', phase: 'grep' })
  const bare = teams('bare', 'running', { task: '', startedAt: undefined })

  assert.deepEqual(teamsRow(quiet), {
    name: 'quiet',
    model: 'claude-x',
    level: '',
    tier: '',
    elapsed: '1m05s',
    context: { tokens: '900' },
    doing: 'Find one silly fact',
    ownWords: false,
    tone: 'live',
  })
  assert.equal(teamsRow(tooling).doing, 'grep')
  assert.deepEqual(teamsRow(bare), { name: 'bare', model: '', level: '', tier: '', elapsed: '', context: null, doing: 'running', ownWords: false, tone: 'live' })
})

test('an agent no longer running says how it stands, and its time stops where it ended', () => {
  const standing = (agent: ShownTeamsAgent) => {
    const { elapsed, doing, tone } = teamsRow(agent)
    return { elapsed, doing, tone }
  }
  const failed = teams('lint', 'failed', { endedAt: NOW - 5_000, summary: 'Could not start' })
  const done = teams('scout', 'done', { endedAt: NOW - 60_000, summary: 'Found it' })

  assert.deepEqual(standing(teams('waiting', 'queued')), { elapsed: '1m05s', doing: 'queued', tone: 'waiting' })
  assert.deepEqual(standing(failed), { elapsed: '1m00s', doing: 'failed · Could not start', tone: 'bad' })
  assert.deepEqual(standing(done), { elapsed: '5s', doing: 'done · Found it', tone: 'quiet' })
  assert.deepEqual(standing(teams('lost', 'unknown')), { elapsed: '', doing: 'unknown · no report came', tone: 'quiet' })
})

test("a helper's row has what hobkin keeps of it: its model, level and tier, and how it stands", () => {
  const running = helper('reader', 'running', { model: 'openai-codex/gpt-6-luna', thinking: 'high', modelSlot: 'mid', activeTool: 'read' })
  // A legacy row keeps the times hobkin saw; an owned helper has none, so its row counts no time.
  const legacy = helper('old', 'stopped', { id: undefined, startedAt: NOW - 3_000, endedAt: NOW - 1_000 })

  assert.deepEqual(helperRow(running), {
    name: 'reader',
    model: 'gpt-6-luna',
    level: 'high',
    tier: 'mid',
    elapsed: '',
    context: null,
    doing: 'running · read',
    ownWords: false,
    tone: 'live',
  })
  assert.deepEqual(helperRow(legacy), { name: 'old', model: '', level: '', tier: '', elapsed: '2s', context: null, doing: 'never reported', ownWords: false, tone: 'quiet' })
  assert.equal(helperRow(helper('next', 'queued', { queuePosition: 2 })).doing, 'queued · #2')
  assert.equal(helperRow(helper('x', 'failed')).tone, 'bad')
})

test('times and token counts are written as pi-extended-teams writes them', () => {
  assert.deepEqual([0, 999, 38_000, 65_000, 3_599_000, 3_600_000, 7_500_000, -5].map(elapsedText), ['0s', '0s', '38s', '1m05s', '59m59s', '1h00m', '2h05m', '0s'])
  assert.deepEqual([0, 980, 7_140, 26_300, 999_499, 1_250_000].map(tokenCount), ['0', '980', '7.1k', '26k', '999k', '1.3M'])
})

test('the heading counts what is out, then what failed or was lost, as the activity header does', () => {
  const agents = activityAgents([teams('a', 'running'), teams('b', 'queued'), teams('c', 'failed'), teams('d', 'unknown')], [helper('e', 'running'), helper('f', 'stopped')])
  assert.equal(activityHeader(agents), '3 active · 1 failed · 2 unknown')
  assert.equal(activityHeader(activityAgents([teams('c', 'failed')], [])), '1 failed')
  assert.equal(activityHeader([]), '')
})

test('the strip draws ten rows at most and counts the rest', () => {
  const agents = activityAgents(Array.from({ length: 13 }, (_, index) => teams(`a${index}`, 'running')), [])
  const { rows, more } = shownRows(agents)
  assert.equal(rows.length, 10)
  assert.equal(more, 3)
  assert.deepEqual(shownRows(agents.slice(0, 2)), { rows: agents.slice(0, 2), more: 0 })
})

test('in the navigator Down walks to the next agent, Up back, and Up from the first leaves it; Left and Right go round', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(stepAgent(ids, 'a', 1), 'b')
  assert.equal(stepAgent(ids, 'c', 1), 'c', 'Down on the last stays')
  assert.equal(stepAgent(ids, 'b', -1), 'a')
  assert.equal(stepAgent(ids, 'a', -1), null, 'Up from the first goes back to the input')
  assert.equal(stepAgent(ids, 'c', 1, true), 'a')
  assert.equal(stepAgent(ids, 'a', -1, true), 'c')
  assert.equal(stepAgent(ids, 'gone', 1), 'a', 'one that left starts again at the first')
  assert.equal(stepAgent([], 'a', 1), null)
})
