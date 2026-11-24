import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { YoloChange, YoloPart, YoloProject } from '#shared/protocol/work.ts'
import { projectCard, readinessLine, type CardRead } from '../src/features/work/yolo-card.ts'
import { readinessRow } from '../src/features/work/yolo-page.ts'

const NOW = Date.parse('2026-11-24T15:00:00Z')
const PULLS_OFF = 'its pull request merges by itself once that is turned on'
const WORK_LEFT = "it still has work left: Recheck PR #21's dependency audit."

const project = (change: Partial<YoloProject> = {}): YoloProject => ({
  slug: 'api',
  name: 'api',
  on: true,
  ready: true,
  needs: [],
  work: 'landed',
  checkedAt: '2026-11-21T14:09:00Z',
  ...change,
})
const part = (name: string, state: YoloPart['state'], more: Partial<YoloPart> = {}): YoloPart => ({ name, label: name[0]!.toUpperCase() + name.slice(1), state, line: `${name} line`, needed: false, blocks: false, ...more })
const change = (item: string, rate: number | null, why: string | null): YoloChange => ({ item, title: `Change ${item}`, kind: rate === null ? null : 'a bug fix', rate, why })
const read = (shown: YoloProject, more: Partial<CardRead> = {}): CardRead => ({
  on: true,
  rate: 8,
  lowest: 6,
  waits: null,
  paused: false,
  pullRequests: false,
  readiness: readinessRow(shown, { workOn: true, now: NOW, zone: 'UTC' }),
  ...more,
})
const cardOf = (more: Partial<YoloProject>, context: Partial<CardRead> = {}) => {
  const shown = project(more)
  return projectCard(shown, read(shown, context), new Map())
}

test('a project that is off says Off, whatever waits on it', () => {
  const card = cardOf({ on: false, changes: [change('a', 9, null)] })
  assert.deepEqual([card.verdict.kind, card.verdict.text], ['off', 'Off'])
})

test('a ready project with a change that would merge says it merges by itself, with how many can', () => {
  const some = cardOf({ changes: [change('a', 9.2, null), change('b', 7.1, 'its general rate is 7.1, under 8')] })
  assert.deepEqual([some.verdict.kind, some.verdict.text], ['merges', 'Merges by itself: 1 of 2 can merge'])
  assert.deepEqual(some.changes.map(({ state, rate }) => [state, rate]), [['Would merge', '9.2'], ['Rate 7.1, under 8', '7.1']])

  const all = cardOf({ changes: [change('a', 9.2, null)] })
  assert.equal(all.verdict.text, 'Merges by itself')
  assert.deepEqual(all.blockers, [])

  // Nothing waits and nothing stops it.
  assert.equal(cardOf({ changes: [] }).verdict.text, 'Merges by itself')
})

test('nine waiting and none able to merge says Merging nothing with the count, and each reason once with how many it holds', () => {
  const changes = [
    change('a', null, PULLS_OFF),
    change('b', null, PULLS_OFF),
    change('c', null, 'no review has scored it'),
    change('d', 7.6, WORK_LEFT),
    change('e', 7.4, WORK_LEFT),
    change('f', 6.2, 'its general rate is 6.2, under 8'),
    change('g', 7.6, 'its general rate is 7.6, under 8'),
    change('h', 9, 'it changes billing, a state machine no model covers yet'),
    change('i', 9, 'it changes billing, a state machine no model covers yet'),
  ]
  const card = cardOf({ changes })
  assert.deepEqual([card.verdict.kind, card.verdict.text], ['nothing', 'Merging nothing: 0 of 9 can merge'])
  assert.deepEqual(card.blockers.map(({ key, count }) => [key, count]), [
    ['pulls', 2],
    ['unrated', 1],
    ['note', 2],
    ['rate', 2],
    ['it changes billing, a state machine no model covers yet', 2],
  ])
  const pulls = card.blockers[0]!
  assert.equal(pulls.press, null, 'the window cannot turn pull request merging on')
  assert.match(pulls.text, /switched off in hobkin/)
  // The rate press lowers the user's rate to what the best of them passes at, and only to one the user may pick.
  assert.deepEqual(card.blockers[3]!.press?.press, { do: 'rate', rate: 7 })
  assert.deepEqual(card.blockers[2]!.press?.press, { do: 'work', key: null })
  // A reason the model does not know is kept as the runtime wrote it.
  assert.equal(card.blockers[4]!.text, 'it changes billing, a state machine no model covers yet')
})

test("a change's one word of state follows its reason, and its rate is a number or a dash", () => {
  const card = cardOf({
    changes: [
      change('a', null, PULLS_OFF),
      change('b', null, 'no review has scored it'),
      change('c', 2.4, 'its general rate is 2.4, under 8'),
      change('d', 7, WORK_LEFT),
      change('e', 9, 'its project is paused'),
    ],
  })
  const by = Object.fromEntries(card.changes.map(({ item, state, rate }) => [item, [state, rate]]))
  assert.deepEqual(by, { a: ['Pull requests off', '–'], b: ['Not reviewed', '–'], c: ['Rate 2.4, under 8', '2.4'], d: ['Left you a note', '7'], e: ['Paused', '9'] })
  assert.ok(card.changes.every(({ state }) => !/asks you/i.test(state)))
})

test("a project still getting ready names the part that is not done, once, and holds every change", () => {
  const shown = project({
    ready: false,
    needs: ['Models: a breaks.'],
    parts: [
      part('models', 'todo', { needed: true, blocks: true, line: 'models line' }),
      part('tests', 'done', { needed: true }),
    ],
    models: [
      { spec: '_specs/tla/BackupListing.tla', state: 'broken' },
      { spec: '_specs/tla/DatabaseBootstrap.tla', state: 'broken' },
      { spec: '_specs/tla/PasswordRecovery.tla', state: 'broken' },
      { spec: '_specs/tla/Fine.tla', state: 'holds' },
    ],
    changes: [change('a', 9, null), change('b', null, PULLS_OFF)],
  })
  const card = projectCard(shown, read(shown), new Map())
  assert.deepEqual([card.verdict.kind, card.verdict.text], ['nothing', 'Merging nothing: 0 of 2 can merge'])
  const [readiness, pulls] = card.blockers
  assert.deepEqual([readiness!.key, readiness!.count], ['part:models', 2])
  assert.equal(readiness!.text, '3 models break on main: BackupListing.tla and 2 more')
  assert.match(readiness!.detail ?? '', /BackupListing\.tla, DatabaseBootstrap\.tla, PasswordRecovery\.tla/)
  assert.deepEqual(readiness!.press?.press, { do: 'readiness' })
  assert.equal(pulls!.key, 'pulls')
  // A change with no reason of its own waits for readiness. One with its own reason keeps it.
  assert.deepEqual(card.changes.map(({ state }) => state), ['Waits for readiness', 'Pull requests off'])
})

test('a project not ready that names no part still says why, and holds from work mode or a pause come first', () => {
  const card = cardOf({ ready: false, needs: ['Its readiness has not been checked yet.'], changes: [change('a', 9, null)] })
  assert.deepEqual(card.blockers.map(({ key, text }) => [key, text]), [['not-ready', 'Not ready for YOLO mode: Its readiness has not been checked yet.']])

  const paused = cardOf({ changes: [change('a', 9, null)] }, { paused: true })
  assert.deepEqual([paused.verdict.kind, paused.blockers[0]!.key, paused.changes[0]!.state], ['nothing', 'paused', 'Paused'])
  const waits = cardOf({ changes: [change('a', 9, null)] }, { waits: 'work mode is off' })
  assert.deepEqual([waits.blockers[0]!.key, waits.changes[0]!.state], ['waits', 'Waits for work mode'])
})

test("a change's line carries its review's five numbers, and none while it has none", () => {
  const answer = (score: number) => ({ score, evidence: 'Seen.' })
  const head = 'a'.repeat(40)
  const needs = [{ kind: 'bug-fix', scores: { coverage: answer(9), proof: answer(9), safety: answer(9), rollback: answer(9) }, rate: 8.4, head, by: 'change-review' }]
  const shown = project({ changes: [change('a', 8.4, null), change('b', 7, null)] })
  const card = projectCard(shown, read(shown), new Map([['a', { head, needs }]]))
  const by = Object.fromEntries(card.changes.map(({ item, grades }) => [item, grades]))
  assert.deepEqual(by, { a: '9 9 9 – 9', b: null })
  assert.match(card.changes[0]!.tip, /^It passes every rule.*Review: /)
})

test('readiness reads as one line: what is not done, and when it was checked', () => {
  const shown = project({ parts: [part('tests', 'done'), part('deploy', 'todo'), part('errors', 'user', { action: 'x' })] })
  assert.equal(readinessLine(shown, read(shown).readiness), 'Readiness: 1 waiting on you, 1 to do, checked Sat, Nov 21, 14:09')
  const bare = project({ checkedAt: null })
  assert.equal(readinessLine(bare, read(bare).readiness), 'Readiness: not checked yet')
})
