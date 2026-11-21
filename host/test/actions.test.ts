import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { initialize } from 'hobkin/src/cli/config.mjs'
import { deletedReportIds } from 'hobkin/src/cli/reports.mjs'
import { fileDecision, openDecisions } from 'hobkin/src/cli/decisions.mjs'
import { runCommand } from '../src/commands.ts'
import { decisionHandlers } from '../src/decisions.ts'
import { reportHandlers } from '../src/reports.ts'
import type { WorkApp } from '../src/work.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

test('report reads persist telemetry only for listed reports and cannot answer an action', async () => {
  const reads: unknown[] = []
  const handlers = reportHandlers({ app: () => ({ snapshot: { reports: [{ id: 'report-1' }] }, runtime: { directory: '' }, recordReportRead: (read) => { reads.push(read) } }) })
  assert.deepEqual(await runCommand(handlers, 'report.read', { id: 'report-1', dwellMs: 3000 }), { ok: true, value: { ok: true } })
  assert.deepEqual(reads, [{ id: 'report-1', dwellMs: 3000 }])
  const missing = await runCommand(handlers, 'report.read', { id: 'missing', dwellMs: 3000 })
  assert.equal(missing.ok, false)
  for (const dwellMs of [0, 2999, -1, 3000.5, 86400001]) {
    assert.equal((await runCommand(handlers, 'report.read', { id: 'report-1', dwellMs })).ok, false)
  }
  assert.equal(reads.length, 1)
})

test('report.delete hides a listed report in hobkin by its own delete, and refuses one that is not listed', async (t) => {
  const root = temporaryDirectory(t)
  const handlers = reportHandlers({ app: () => ({ snapshot: { reports: [{ id: 'local:recap:1' }] }, runtime: { directory: root }, recordReportRead: () => {} }) })
  assert.deepEqual(await runCommand(handlers, 'report.delete', { id: 'local:recap:1' }), { ok: true, value: { id: 'local:recap:1', deleted: true } })
  assert.deepEqual([...deletedReportIds(root)], ['local:recap:1'])
  assert.equal((await runCommand(handlers, 'report.delete', { id: 'missing' })).ok, false)
  assert.deepEqual([...deletedReportIds(root)], ['local:recap:1'])
})

/** Stands in for hobkin's application: it writes down every action it is asked for, and answers as told. */
function fakeHobkin(answer: (action: string) => unknown = (action) => ({ ok: true, message: `hobkin did ${action}.` })) {
  const calls: unknown[][] = []
  const app: Pick<WorkApp, 'workAction'> = {
    workAction: async (...args: unknown[]) => {
      calls.push(args)
      return answer(String(args[0]))
    },
  }
  return { app, calls, handlers: decisionHandlers({ app: () => app }) }
}

test("an answer goes through hobkin's own decision action, by choice or in the user's words", async () => {
  const { calls, handlers } = fakeHobkin()

  assert.deepEqual(await runCommand(handlers, 'decision.answer', { id: 'd1', value: 'merge' }), { ok: true, value: { message: 'hobkin did decide.', handedOff: false } })
  assert.deepEqual(await runCommand(handlers, 'decision.answer', { id: 'd2', typed: 'Ask me again tomorrow' }), {
    ok: true,
    value: { message: 'hobkin did words.', handedOff: false },
  })
  assert.deepEqual(calls, [
    ['decide', 'd1', 'merge'],
    ['words', 'd2', 'Ask me again tomorrow'],
  ])

  // A choice or the user's words, never both and never neither. hobkin hears nothing of a malformed answer.
  for (const args of [{ id: 'd3', value: 'merge', typed: 'and more' }, { id: 'd3' }]) {
    const refused = await runCommand(handlers, 'decision.answer', args)
    assert.equal(!refused.ok && refused.error.code, 'invalid-arguments', JSON.stringify(args))
  }
  assert.equal(calls.length, 2)
})

test('doing it with hobkin says the item was handed on to the main agent', async () => {
  const { handlers } = fakeHobkin(() => ({ ok: true, handOff: { id: 'd1' }, message: 'The main agent takes it in Chat, and it leaves Action Items.' }))
  assert.deepEqual(await runCommand(handlers, 'decision.answer', { id: 'd1', value: 'hobkin' }), {
    ok: true,
    value: { message: 'The main agent takes it in Chat, and it leaves Action Items.', handedOff: true },
  })
})

test("a refusal comes back in hobkin's own words", async () => {
  const { handlers } = fakeHobkin(() => {
    throw Error('That decision was already answered.')
  })
  assert.deepEqual(await runCommand(handlers, 'decision.answer', { id: 'd1', value: 'yes' }), {
    ok: false,
    error: { code: 'failed', message: 'That decision was already answered.' },
  })
})

test("a learning proposal is answered with hobkin's own learning action", async () => {
  const { calls, handlers } = fakeHobkin()
  assert.deepEqual(await runCommand(handlers, 'learning.answer', { id: 'a1b2c3', value: 'later' }), { ok: true, value: { message: 'hobkin did learning.' } })
  assert.deepEqual(calls, [['learning', 'a1b2c3', 'later']])

  const unknown = await runCommand(handlers, 'learning.answer', { id: 'a1b2c3', value: 'maybe' })
  assert.equal(!unknown.ok && unknown.error.code, 'invalid-arguments')
})

test('an answer resolves the item', { timeout: 60000 }, async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })
  const choices = [
    { value: 'yes', label: 'Unsubscribe' },
    { value: 'no', label: 'Keep it' },
  ]
  const asked = fileDecision(root, { from: 'Routine inbox-sweep', question: 'Unsubscribe from the newsletter?', choices, answerTo: { kind: 'routine', id: 'inbox-sweep' } })
  const typed = fileDecision(root, { from: 'Routine inbox-sweep', question: 'Which label should receipts go under?', choices, answerTo: { kind: 'routine', id: 'inbox-sweep' } })

  const host = await hostFor(t, { root })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  const listed = (ids: string[]) => (view: { snapshot: { decisions?: unknown[] } }) =>
    ids.every((id) => (view.snapshot.decisions ?? []).some((decision) => (decision as { id?: string }).id === id))
  await client.until(listed([asked.id, typed.id]), 'both questions in Action Items')

  // By one of its choices, as hobkin's own Decisions tab answers it.
  assert.deepEqual(await client.run('decision.answer', { id: asked.id, value: 'yes' }), { message: 'Answered: Unsubscribe.', handedOff: false })
  // And in the user's own words, which the routine that asked hears.
  assert.deepEqual(await client.run('decision.answer', { id: typed.id, typed: 'Under Receipts, by month' }), { message: 'Answered in your own words.', handedOff: false })

  assert.deepEqual(
    openDecisions(root).map(({ id }) => id).filter((id) => id === asked.id || id === typed.id),
    [],
    'hobkin holds neither as open',
  )
  await client.until((view) => !(view.snapshot.decisions ?? []).length, 'Action Items empty')

  // An answer from a stale screen does not reach a question that is gone.
  const again = await client.command('decision.answer', { id: asked.id, value: 'no' })
  assert.equal(!again.ok && again.error.message, 'That decision was already answered.')
})
