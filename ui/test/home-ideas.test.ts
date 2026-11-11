import assert from 'node:assert/strict'
import test from 'node:test'
import { homeIdeas, activityOf, reportAge, ideaTarget, AGED_REPORT_MS } from '../src/features/reports/home-ideas.ts'
import type { Report } from '../src/features/reports/report.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import { PROTOCOL_VERSION } from '../../shared/protocol/messages.ts'

const now = Date.parse('2026-11-11T12:00:00Z')
const report = (id: string, body = '', at = new Date(now).toISOString()): Report => ({ id, title: id, body, at, outcome: 'completed' })
const read = new Set<string>()

test('critical and blocked stay ahead of review, proposals and ordinary reports, even when aged or read', () => {
  const work = sampleWork()
  const list = [report('ordinary'), report('blocked', 'Blocked: needs an answer'), report('critical', 'Critical: disk full', new Date(now - AGED_REPORT_MS).toISOString())]
  const ideas = homeIdeas(list, new Set(['critical']), work, now, 100)
  assert.deepEqual(ideas.slice(0, 2).map((idea) => idea.id), ['report:critical', 'report:blocked'])
  assert.equal(ideas[0]!.aged, true)
  assert.equal(ideas[0]!.tone, 'critical')
  const review = ideas.findIndex((idea) => idea.kind === 'review')
  const proposal = ideas.findIndex((idea) => idea.kind === 'proposal')
  assert.ok(review >= 2 && proposal > review)
  assert.equal(ideas.at(-1)!.id, 'report:ordinary')
  assert.equal(homeIdeas(list, read, work, now).length, 4)
})

test('host order and exact identities survive reranking; replacements retain no previous targets', () => {
  const work = sampleWork()
  const expected = work.projects.filter((project) => project.state === 'proposed').map((project) => `project:${project.slug}`)
  assert.deepEqual(homeIdeas([], read, work, now, 100).filter((idea) => idea.kind === 'proposal').map((idea) => idea.id), expected)
  const ideas = homeIdeas([report('a'), report('b')], new Set(['a']), null, now)
  assert.deepEqual(ideas.map((idea) => idea.id), ['report:b', 'report:a'])
  assert.deepEqual(ideaTarget(ideas[0]!), { page: 'reports', reportId: 'b' })
  assert.deepEqual(homeIdeas([], read, null, now), [])
  for (const idea of homeIdeas([], read, work, now, 100)) assert.deepEqual(ideaTarget(idea), { page: 'work' })
  assert.equal(read.size, 0)
})

test('outcome triage and nothing-new are independent of age and unclassified is not nothing', () => {
  const failed = { ...report('failed'), outcome: 'failed' }
  const stopped = { ...report('stopped'), outcome: 'interrupted' }
  const ideas = homeIdeas([report('nothing', 'Nothing new.'), report('plain'), stopped, failed], read, null, now)
  assert.deepEqual(ideas.map(({ sourceId, tone }) => [sourceId, tone]), [['failed', 'critical'], ['stopped', 'blocked'], ['plain', 'plain'], ['nothing', 'nothing']])
})

test('age has an exact threshold and invalid/future dates remain unknown, not obsolete', () => {
  assert.equal(reportAge(report('a', '', new Date(now - AGED_REPORT_MS).toISOString()), now), AGED_REPORT_MS)
  for (const at of [undefined, 'bad', new Date(now + 1).toISOString()]) assert.equal(reportAge({ ...report('a'), at }, now), null)
  assert.equal(homeIdeas([report('a', '', new Date(now - AGED_REPORT_MS + 1).toISOString())], read, null, now)[0]!.aged, false)
})

test('activity never claims idle without authoritative freshness and native child coverage', () => {
  for (const state of [initialHostState, { ...initialHostState, link: 'lost' as const }, { ...initialHostState, snapshot: { busy: false, runs: [], mainChildren: [], jobChildren: {} } }]) {
    assert.equal(activityOf(state).state, 'unknown')
  }
  const question = { id: 'q', from: 'hobkin', question: 'Continue?', choices: [], other: true, askedAt: now, expiresAt: null }
  assert.equal(activityOf({ ...initialHostState, question }).waiting, true)
  let state = applyHostMessage(initialHostState, { type: 'state', rev: 1, reset: true, set: { busy: false, runs: [], connection: 'connected' } })
  state = applyLink(state, 'lost')
  state = applyHostMessage(state, { type: 'hello', protocol: PROTOCOL_VERSION, home: '/another-home', model: 'live', owner: { state: 'opening' }, signIn: { status: 'unknown' }, models: null, viewState: null })
  // hello still retains the preceding snapshot; neither it nor a reset proves native child completeness.
  assert.equal(activityOf(state).state, 'unknown')
  state = applyHostMessage(state, { type: 'state', rev: 2, reset: true, set: { busy: false, runs: [] } })
  assert.equal(activityOf(state).state, 'unknown')
  const work = sampleWork()
  work.held = 'Paused by the user'
  assert.equal(activityOf({ ...initialHostState, work }).held, 'Paused by the user')
})
