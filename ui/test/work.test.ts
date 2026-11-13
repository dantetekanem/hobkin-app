import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HelloMessage, StateMessage } from '#shared/protocol/messages.ts'
import { applyHostMessage, initialHostState } from '../src/lib/host/state.ts'
import { commandFor, type WorkAction } from '../src/features/work/actions.ts'
import { applySample } from '../src/features/work/sample-actions.ts'
import { sampleWork } from '../src/features/work/sample.ts'

const hello: HelloMessage = {
  type: 'hello',
  protocol: 1,
  home: '/tmp/home',
  model: 'scripted',
  owner: { state: 'opening' },
  signIn: { status: 'signed-in' },
  models: null,
  viewState: null,
}

const startOver = (rev: number, rest: Partial<StateMessage> = {}): StateMessage => ({ type: 'state', rev, reset: true, set: {}, messages: [{ op: 'reset', messages: [] }], ...rest })

test('work mode comes with state messages, and goes when the host says it has none', () => {
  const work = sampleWork()
  let state = applyHostMessage(initialHostState, hello)
  assert.equal(state.work, null, 'nothing before the host says')

  state = applyHostMessage(state, startOver(0, { work }))
  assert.deepEqual(state.work, work)
  state = applyHostMessage(state, { type: 'state', rev: 1, set: { busy: true } })
  assert.deepEqual(state.work, work, 'a message without it leaves it as it was')
  state = applyHostMessage(state, { type: 'state', rev: 2, work: { ...work, enabled: false } })
  assert.equal(state.work?.enabled, false)
  state = applyHostMessage(state, { type: 'state', rev: 3, work: null })
  assert.equal(state.work, null, 'a snapshot with no work mode in it, such as the view the terminal saved')

  state = applyHostMessage(state, startOver(0, { work }))
  state = applyHostMessage(state, startOver(0))
  assert.equal(state.work, null, 'a reset without it means the host has none to show')
})

test("each action of the screen is one of hobkin's work actions, at the commit its card showed", () => {
  const work = sampleWork()
  const ready = work.finished.find(({ name }) => name === 'merge')!
  const change = ready.changes[0]!
  const calls: [WorkAction, ReturnType<typeof commandFor>][] = [
    [{ do: 'mode', on: true, folder: '~/code' }, { name: 'work.mode', args: { on: true, folder: '~/code' } }],
    [{ do: 'mode', on: false }, { name: 'work.mode', args: { on: false } }],
    [{ do: 'queue', key: 'look:billing-api', action: 'skip' }, { name: 'work.queue', args: { row: 'look:billing-api', action: 'skip' } }],
    [{ do: 'priority', slug: 'storefront', priority: 'P0' }, { name: 'work.project', args: { slug: 'storefront', priority: 'P0' } }],
    [{ do: 'prs', slug: 'storefront', prs: 'draft' }, { name: 'work.project', args: { slug: 'storefront', prs: 'draft' } }],
    [{ do: 'proposal', slug: 'design-kit', answer: 'take' }, { name: 'work.proposal', args: { slug: 'design-kit', answer: 'take' } }],
    [{ do: 'agents', agents: 3 }, { name: 'work.agents', args: { agents: 3 } }],
    [{ do: 'tokens', tokens: 40_000_000 }, { name: 'work.tokens', args: { tokens: 40_000_000 } }],
    [{ do: 'change', change, choice: 'merge' }, { name: 'work.change', args: { slug: change.slug, item: change.item, action: 'merge', head: change.head! } }],
    [{ do: 'change', change, choice: 'rebase' }, { name: 'work.change', args: { slug: change.slug, item: change.item, action: 'ask', note: '' } }],
    [{ do: 'change', change, choice: 'changes', note: 'Keep the old cart.' }, { name: 'work.change', args: { slug: change.slug, item: change.item, action: 'ask', note: 'Keep the old cart.' } }],
    [{ do: 'stop', run: 'a1', how: 'not-approved' }, { name: 'agent.stop', args: { run: 'a1', how: 'not-approved' } }],
  ]
  for (const [action, expected] of calls) assert.deepEqual(commandFor(action), expected, action.do)

  // A group's yes carries exactly its rows, each the way its own card lands, at the commit the card showed.
  assert.deepEqual(commandFor({ do: 'group', group: ready }), {
    name: 'work.group',
    args: { rows: ready.changes.map(({ slug, item, landing, head }) => ({ slug, item, how: landing, ...(head ? { head } : {}) })) },
  })
})

test('the sample answers as hobkin would: a refused merge keeps its card, and a group says how each row went', () => {
  const work = sampleWork()
  const all = work.finished.flatMap(({ changes }) => changes)
  const moved = all.find(({ key }) => key === 'storefront:4c9e21')!
  const refused = applySample(work, { do: 'change', change: moved, choice: 'merge' })
  assert.ok('refused' in refused)
  assert.match(refused.refused, /moved since it was offered, so nothing merged/)

  const ready = work.finished.find(({ name }) => name === 'merge')!
  const done = applySample(work, { do: 'group', group: ready })
  assert.ok('state' in done)
  assert.equal(done.lines?.length, ready.changes.length, 'a line for every row')
  const left = done.state.finished.find(({ name }) => name === 'merge')
  assert.deepEqual(left?.changes.map(({ key }) => key) ?? [], ready.changes.filter(({ key }) => key === moved.key).map(({ key }) => key), 'only the one that could not go stays')

  const off = applySample(work, { do: 'mode', on: false })
  assert.ok('state' in off && off.state.enabled === false)
  const on = applySample({ ...work, enabled: false, folder: null }, { do: 'mode', on: true })
  assert.ok('refused' in on, 'the first start needs a folder')
})

test('the main project list is the tracked ones by priority, and discovery holds the rest', async () => {
  const { trackedProjects, discoverableProjects } = await import('../src/features/work/projects.ts')
  const base = sampleWork().projects[0]!
  const make = (slug: string, state: typeof base.state, priority: typeof base.priority, paused = false) => ({ ...base, slug, name: slug, state, priority, paused })
  const all = [make('a', 'skipped', 'P0'), make('b', 'chosen', 'P2'), make('c', 'proposed', 'P1'), make('d', 'chosen', 'P0', true), make('e', 'dropped', 'P0'), make('f', 'chosen', 'P2'), make('g', 'proposed', 'P3')]
  assert.deepEqual(trackedProjects(all).map(({ slug }) => slug), ['d', 'b', 'f'], 'paused stays, by priority, ties in hobkin order')
  assert.deepEqual(discoverableProjects(all).map(({ slug }) => slug), ['c', 'g', 'a', 'e'])
  assert.deepEqual(all.map(({ slug }) => slug), ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'the input is left as it was')
})
