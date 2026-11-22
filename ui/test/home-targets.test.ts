import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { registerHooks } from 'node:module'
import type { FinishedChange } from '../../shared/protocol/work.ts'

const opened: unknown[][] = []
const commands: unknown[][] = []
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  open: (...args: unknown[]) => opened.push(args),
} })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => { throw new Error('Connection must stay stopped') })
mock.method(HostConnection.prototype, 'command', async (...args: unknown[]) => {
  commands.push(args)
  return { ok: true }
})
const { openTarget } = await import('../src/features/home/navigate.ts')
const { useView } = await import('../src/app/view-store.ts')
const { remembered } = await import('../src/app/location.ts')
const { useReports } = await import('../src/features/reports/store.ts')
const { useRoutines } = await import('../src/features/routines/store.ts')
const { useQuestions } = await import('../src/features/questions/store.ts')
const { hostStore } = await import('../src/lib/host/client.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

test('Action target survives the existing screen-entry reset with its exact id', () => {
  useView.getState().openScreen('home')
  remembered.setState({ action: 'old' })
  openTarget({ to: 'action', id: 'decision:exact-id' })
  assert.equal(useView.getState().screen, 'actions')
  assert.equal(remembered.getState().action, 'decision:exact-id')
})

test('every local target selects only its existing destination', () => {
  for (const screen of ['actions', 'reports', 'routines', 'work', 'github'] as const) {
    openTarget({ to: 'screen', screen })
    assert.equal(useView.getState().screen, screen)
  }
  const report = useReports.getState().inbox.reports[0]!
  openTarget({ to: 'report', id: report.id })
  assert.equal(useReports.getState().openId, report.id)
  assert.equal(useView.getState().screen, 'reports')
  openTarget({ to: 'routine', id: 'check' })
  assert.equal(useRoutines.getState().openId, 'check')
  assert.equal(useRoutines.getState().openFrom, 'routine-check')
  assert.equal(useView.getState().screen, 'routines')
  hostStore.setState({ home: '/fake/home' })
  openTarget({ to: 'review', change: { slug: 'app', item: 'fix' } as FinishedChange })
  assert.equal(useView.getState().openReview, 'change:app:fix')
  openTarget({ to: 'review', change: { slug: 'bad:slug', item: 'fix' } as FinishedChange })
  assert.equal(useView.getState().screen, 'work')
  openTarget({ to: 'agent', id: 'agent-id' })
  assert.equal(useView.getState().openAgent, 'agent-id')
  assert.deepEqual(commands, [])
})

test('question target leaves the current sheet untouched, or navigates to Actions when absent', () => {
  useQuestions.getState().raiseSample()
  const queue = useQuestions.getState().queue
  useView.getState().openScreen('home')
  openTarget({ to: 'question' })
  assert.equal(useQuestions.getState().queue, queue)
  assert.equal(useView.getState().screen, 'home')
  useQuestions.setState({ queue: { ...queue, waiting: [] } })
  openTarget({ to: 'question' })
  assert.equal(useView.getState().screen, 'actions')
  assert.deepEqual(commands, [])
})

test('URL targets open only supported GitHub HTTPS pages through the existing opener', () => {
  const url = 'https://github.com/owner/repo/pull/7'
  openTarget({ to: 'url', url })

  for (const url of [
    'javascript:alert(1)',
    'https://example.com/',
    'http://github.com/a/b',
    'https://github.com.evil/a',
    'https://github.com@evil/a',
    'https://github.com/\\evil/a',
  ]) {
    openTarget({ to: 'url', url })
  }

  assert.deepEqual(opened, [[url, '_blank', 'noopener,noreferrer']])
  assert.deepEqual(commands, [])
})

test('a review request opens its pull request in Review, and connections open Integrations', () => {
  useView.getState().openScreen('home')
  openTarget({ to: 'pull', url: 'https://example.com/owner/repo/pull/7' })
  assert.equal(useView.getState().screen, 'home')
  openTarget({ to: 'pull', url: 'https://github.com/Owner/Repo/pull/7' })
  assert.equal(useView.getState().screen, 'review')
  assert.equal(useView.getState().openReview, 'pr:owner/repo/7')
  openTarget({ to: 'screen', screen: 'integrations' })
  assert.equal(useView.getState().screen, 'integrations')
  assert.deepEqual(commands, [])
})

test("Home's broken model opens its run at the break, where the rule broke", async () => {
  const { keptOf } = await import('../src/features/proofs/kept.ts')
  useView.getState().openScreen('home')
  openTarget({ to: 'proof', id: 'run-broken' })
  assert.deepEqual([useView.getState().screen, useView.getState().openProof], ['proof', 'run-broken'])
  assert.deepEqual([keptOf('run-broken').landing, keptOf('run-broken').tab], ['break', 'graph'])
  assert.deepEqual(commands, [])
})
