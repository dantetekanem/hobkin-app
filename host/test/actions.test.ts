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
import { hostRows } from '../../ui/src/features/actions/host.ts'
import { answerCommand } from '../../ui/src/features/actions/items.ts'

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
    ['decide', 'd1', 'merge', { actionItem: true }],
    ['words', 'd2', 'Ask me again tomorrow', { actionItem: true }],
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

test('generated cards pass their exact offer identity to the runtime fallback route', async () => {
  const { calls, handlers } = fakeHobkin(() => ({ ok: false, message: 'Your choice was saved. See Chat for what happened.' }))
  const id = 'project:fixture:2026-11-10T09:00:00.000Z'
  assert.deepEqual(await runCommand(handlers, 'action.answer', { id, value: 'take' }), {
    ok: true,
    value: { message: 'Your choice was saved. See Chat for what happened.' },
  })
  assert.deepEqual(calls, [['actionItem', id, 'take']])
  assert.equal((await runCommand(handlers, 'action.answer', { id, value: 'other' })).ok, false)
  assert.equal(calls.length, 1)
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

for (const fixture of [
  { title: 'Unknown handler card?', given: { value: 'yes' }, choice: 'Try the harmless fixture', target: { kind: 'unavailable-fixture' }, reason: 'No action handler was available' },
  { title: 'Missing work card?', given: { typed: 'Only the harmless fixture' }, choice: 'Only the harmless fixture', target: { kind: 'work', slug: 'fixture-missing', item: 'missing' }, reason: 'The action target was no longer available' },
]) test(`failed Action Items selection (${fixture.title}) appears once in Chat and leaves only its card`, { timeout: 60000 }, async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })
  const choices = [{ value: 'yes', label: 'Try the harmless fixture' }, { value: 'no', label: 'Skip it' }]
  const card = fileDecision(root, { from: 'Fixture', question: fixture.title, choices, answerTo: fixture.target })
  const other = fileDecision(root, { from: 'Fixture', question: 'Leave this card alone?', choices, answerTo: { kind: 'chat' } })
  const host = await hostFor(t, { root })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  const rows = () => hostRows(client.view.snapshot)
  await client.until(() => [card, other].every(({ id }) => rows().some(row => row.id === id)), 'fixture cards')
  const { title, choice, given } = fixture
  const plan = answerCommand(rows().find(row => row.id === card.id)!.answers!, given as { value: string } | { typed: string })
  assert.equal('name' in plan && plan.name, 'decision.answer')
  if (!('name' in plan)) throw Error('The card did not produce a command.')
  const result = await client.command(plan.name, plan.args)
  assert.equal(result.ok, true, 'the failure is reported in Chat rather than returned as a command error')
  await client.until(view => view.messages.some(message => message.role === 'notice' && message.content.includes(title) && message.content.includes(choice) && message.content.includes(fixture.reason)), 'the selection and reason in Chat')
  await client.until(() => !rows().some(row => row.id === card.id), 'the selected card gone')
  assert.equal(rows().some(row => row.id === other.id), true)
  await client.command(plan.name, plan.args)
  assert.equal(client.view.messages.filter(message => message.content.includes(title) && message.content.includes(choice)).length, 1)
  assert.deepEqual(openDecisions(root).map(({ id }) => id).sort(), [card.id, other.id].sort(), 'failed actions were not recorded as answered')
  const refreshed = await Client.connect(host)
  afterTest(t, () => refreshed.close())
  await refreshed.live()
  assert.deepEqual(hostRows(refreshed.view.snapshot).map(row => row.id), [other.id])
  assert.equal(refreshed.view.messages.filter(message => message.content.includes(title) && message.content.includes(choice)).length, 1)
})

test('the desktop selection that can reach Chat still sends the actual answer', { timeout: 60000 }, async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  initialize(root, { cwd: root })
  const card = fileDecision(root, { from: 'Fixture', question: 'Harmless positive control?', choices: [{ value: 'yes', label: 'Yes, I see it' }, { value: 'no', label: 'No' }], answerTo: { kind: 'chat' } })
  const host = await hostFor(t, { root })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  await client.until(view => hostRows(view.snapshot).some(row => row.id === card.id), 'the positive control card')
  const command = answerCommand(hostRows(client.view.snapshot).find(row => row.id === card.id)!.answers!, { value: 'yes' })
  if (!('name' in command)) throw Error('The card did not produce a command.')
  assert.equal((await client.command(command.name, command.args)).ok, true)
  await client.until(view => view.messages.some(message => message.role === 'user' && message.content.includes('Yes, I see it')), 'the real Chat answer')
  assert.deepEqual(openDecisions(root), [])
  assert.equal(client.view.messages.some(message => message.id === `notice:action-answer:${card.id}`), false)
})
