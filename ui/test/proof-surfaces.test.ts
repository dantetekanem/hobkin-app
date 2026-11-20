import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProofRunSummary, ProofsState } from '#shared/protocol/proofs.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { brokenOnMain, chipsOf, itemTitle, modelsLine, modelsOnMain, placeOf, proofCheckOf, runForCommand, runsForItem, runWords } from '../src/features/proofs/proof-match.ts'
import { sampleRun, sampleSummary, type SamplePhase } from '../src/features/proofs/sample.ts'
import { foldOf, type Command } from '../src/features/agent-activity/steps.ts'
import { homeModel } from '../src/features/home/model.ts'
import type { HomeInput } from '../src/features/home/types.ts'

const STARTED = Date.parse('2026-11-20T14:05:00Z')
const summary = (phase: SamplePhase, change: Partial<ProofRunSummary> = {}, minutes = 0): ProofRunSummary => ({ ...sampleSummary(sampleRun(phase, STARTED + minutes * 60_000)), ...change })
const slice = (...runs: ProofRunSummary[]): ProofsState => ({ runs })

test("a finished card's runs are its item's, the newest of each spec, at the card's head when one is", () => {
  const old = summary('broken', { id: 'old' }, 0)
  const fixed = summary('proved', { id: 'fixed' }, 5)
  const other = summary('holds', { id: 'other', spec: 'specs/tla/ReviewQueue.tla' }, 6)
  const elsewhere = summary('holds', { id: 'elsewhere', item: 'ffff' }, 7)
  const proofs = slice(elsewhere, other, fixed, old)
  assert.deepEqual(runsForItem(proofs, 'hobkin', '4f2c').map(({ id }) => id), ['other', 'fixed'])
  // At the old head only the broken check speaks for the card.
  assert.deepEqual(runsForItem(proofs, 'hobkin', '4f2c', '9b04e1d7c0').map(({ id }) => id), ['old'])
  assert.deepEqual(runsForItem(null, 'hobkin', '4f2c'), [])
})

test('the chips say what the model and the proof found, as the design does', () => {
  assert.deepEqual(chipsOf([summary('proved')]).map(({ label, tone }) => [label, tone]), [['Model holds · 48,211 states', 'ok'], ['Proved for every size', 'ok']])
  assert.deepEqual(chipsOf([summary('proofFails')]).map(({ label, tone }) => [label, tone]), [['Model broke · 5 steps', 'bad'], ['Proof fails', 'bad']])
  assert.deepEqual(chipsOf([summary('checking')]).map(({ label, tone }) => [label, tone]), [['Checking · 12,408 states', 'live']])
  // Two specs name their files, and a check of an older head says so.
  const two = chipsOf([summary('holds'), summary('broken', { spec: 'specs/tla/ReviewQueue.tla' })], '3f1a9c2')
  assert.deepEqual(two.map(({ label }) => label), ['WorkItem holds · 48,211 states', 'ReviewQueue checked at an older head'])
  const missed = summary('holds', { actions: summary('holds').actions.map((action) => ({ ...action, count: action.name === 'Decline' ? 0 : action.count })) })
  assert.deepEqual(chipsOf([missed])[0], { id: 'sample-holds', label: 'Model holds · Decline never ran', tone: 'warn' })
})

test("an agent's step finds the run its hobkin proof check started", () => {
  assert.equal(proofCheckOf('hobkin proof check specs/tla/WorkItem.tla'), 'specs/tla/WorkItem.tla')
  assert.equal(proofCheckOf('cd ~/code && ~/bin/hobkin proof check --cfg specs/tla/W.cfg "specs/tla/WorkItem.tla"'), 'specs/tla/WorkItem.tla')
  assert.equal(proofCheckOf('hobkin proof setup'), null)
  assert.equal(proofCheckOf('echo hobkin proof check is next'), null)

  const first = summary('broken', { id: 'first' }, 0)
  const again = summary('holds', { id: 'again' }, 10)
  const proofs = slice(again, first)
  assert.equal(runForCommand(proofs, { spec: 'specs/tla/WorkItem.tla', at: STARTED + 9 * 60_000 })?.id, 'again')
  assert.equal(runForCommand(proofs, { spec: 'WorkItem.tla', at: STARTED - 1_000 })?.id, 'first')
  assert.equal(runForCommand(proofs, { spec: 'specs/tla/WorkItem.tla' })?.id, 'again')
  assert.equal(runForCommand(proofs, { spec: 'specs/tla/WorkItem.tla', at: STARTED + 60 * 60_000 }), null)
  // The output naming the run's folder wins.
  assert.equal(runForCommand(proofs, { spec: 'specs/tla/WorkItem.tla', at: STARTED + 9 * 60_000, output: 'Run ~/.hobkin/proofs/first/ broke' })?.id, 'first')
})

test("the step's words, and a project's models on main for the YOLO page and Home", () => {
  assert.deepEqual(runWords(summary('checking')), { title: 'Checking WorkItem.tla', detail: '12,408 states · depth 14 · 3 of 4 holding so far', tone: 'live' })
  assert.deepEqual(runWords(summary('broken')), { title: 'WorkItem.tla: MergedAtReviewedHead breaks', detail: '5 steps · 4,906 states', tone: 'bad' })
  assert.deepEqual(runWords(summary('holds')).title, 'WorkItem.tla holds')

  const queue = summary('holds', { id: 'q', item: undefined, spec: 'specs/tla/ReviewQueue.tla' }, 2)
  const main = summary('holds', { id: 'm', item: undefined }, 1)
  const broke = summary('broken', { id: 'b', item: undefined }, 3)
  const models = modelsOnMain(slice(main, queue, summary('holds')), 'hobkin')
  assert.deepEqual(models.map(({ id }) => id), ['q', 'm'])
  assert.deepEqual(modelsLine(models), { title: 'Models: 2 machines, both hold', detail: 'ReviewQueue.tla · WorkItem.tla · rechecked when their code changes', tone: 'ok' })
  assert.equal(modelsLine([broke, queue]).title, 'Models: 2 machines, 1 breaks')

  // Home shows a model that broke on main until a newer check of the same spec holds.
  assert.deepEqual(brokenOnMain(slice(broke, main, summary('broken'))).map(({ id }) => id), ['b'])
  assert.deepEqual(brokenOnMain(slice(summary('holds', { id: 'later', item: undefined }, 4), broke)), [])
})

test("the page's eyebrow and title come from work mode", () => {
  const work = { finished: [{ changes: [{ slug: 'hobkin', item: '4f2c', title: 'YOLO merges wait for a review at the final head' }] }], queue: [], projects: [{ slug: 'hobkin', name: 'hobkin' }] } as unknown as WorkState
  assert.equal(itemTitle({ project: 'hobkin', item: '4f2c' }, work), 'YOLO merges wait for a review at the final head')
  assert.equal(itemTitle({ project: 'hobkin', item: '9999' }, work, [{ work: { slug: 'hobkin', item: '9999' }, title: 'Model the review queue' }]), 'Model the review queue')
  assert.equal(itemTitle({ project: 'hobkin' }, work), null)
  assert.equal(placeOf({ project: 'hobkin', item: '4f2c' }, work), 'Work · hobkin · item 4f2c')
  assert.equal(placeOf({ project: 'hobkin' }, null), 'Work · hobkin · on main')
  assert.equal(placeOf({}, null), 'Proof run')
})

test("an agent's proof check never folds away with the commands that passed before it", () => {
  const ran = (id: string, command: string): Command => ({ id, command, state: 'done', output: '' })
  const { folded, open } = foldOf([ran('a', 'pnpm test'), ran('b', 'hobkin proof check specs/tla/WorkItem.tla'), ran('c', 'git status'), ran('d', 'git diff')])
  assert.deepEqual(folded.map(({ id }) => id), ['a', 'c'])
  assert.deepEqual(open.map(({ id }) => id), ['b', 'd'])
})

test("Home's Problems says a model broke on main, and opens its run", () => {
  const github: HomeInput['github'] = { connection: 'unknown', login: null, reviews: [], pulls: [], issues: [], more: { reviews: false, pulls: false, issues: false }, refreshedAt: null, refreshing: false, error: null, sample: false }
  const home = (proofs?: ProofsState): HomeInput => ({
    now: STARTED + 3_600_000, reports: [], read: new Set(), attention: null, waiting: [], question: null, work: null, live: true, github,
    routines: [], agents: [], wins: null, integrations: null, dismissed: new Set(), layout: null, custom: null, thoughts: null, ...(proofs ? { proofs } : {}),
  })
  const broke = summary('broken', { id: 'weekly', item: undefined })
  const rows = homeModel(home(slice(broke))).problems.rows
  assert.deepEqual(rows.map(({ title, detail, tone, action }) => [title, detail, tone, action.target]), [['A model broke on main', 'hobkin: WorkItem.tla, MergedAtReviewedHead breaks in 5 steps', 'bad', { to: 'proof', id: 'weekly' }]])
  // An item's own check is its card's business, and a host from before proofs sends none.
  assert.deepEqual(homeModel(home(slice(summary('broken')))).problems.rows, [])
  assert.deepEqual(homeModel(home()).problems.rows, [])
})
