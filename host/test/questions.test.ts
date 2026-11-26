import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { AskMessage } from '#shared/protocol/messages.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import type { Decision } from 'hobkin/src/cli/decisions.mjs'
import { Questions, filedDetails } from '../src/questions.ts'

const QUESTION = 'The staging deploy is ready. Promote it to production?'
const CHOICES = [
  { value: 'promote', label: 'Promote it' },
  { value: 'wait', label: 'Wait until Monday' },
]

/** A host with someone at the window, and a way to file a question the way another session does with `hobkin decide`. */
async function questionHost(t: TestContext, questionWaitMs?: number) {
  const { afterTest, Client, hostFor, temporaryDirectory } = await import('./support.ts')
  const { fileDecision } = await import('hobkin/src/cli/decisions.mjs')
  const root = join(temporaryDirectory(t), 'home')
  const host = await hostFor(t, { root, questionWaitMs })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  client.send({ type: 'presence', focused: true, typing: false })

  const asks = () => client.received.filter((message): message is AskMessage => message.type === 'ask')
  const asked = async (): Promise<PendingQuestion> => {
    await client.until(() => asks().at(-1)?.question, 'the question to reach the UI')
    return asks().at(-1)!.question!
  }
  const gone = () => client.until(() => asks().at(-1)?.question === null, 'the question to leave the screen')
  const file = (question = QUESTION) =>
    fileDecision(root, { from: 'deploy session', question, tldr: 'Promote staging?', choices: CHOICES, recommended: 'wait', why: 'Only you can approve a release.', answerTo: { kind: 'outside' } }).id
  const waiting = () => (client.view.snapshot.decisions ?? []) as { id: string; shown?: boolean; question: string }[]
  return { client, asked, gone, file, waiting }
}

test('trusted request identity stays with its open ask; independent asks stay distinct', { timeout: 1000 }, async (t) => {
  const questions = new Questions({ onChange: () => {}, canShow: () => true, typing: () => false })
  t.after(() => questions.close())
  const request = { question: QUESTION, choices: CHOICES, requestId: 'filed:one' }
  const answer = questions.ask(request)
  assert.equal(questions.current()?.id, request.requestId)
  assert.equal(questions.current()?.id, request.requestId, 'replaying current state retains the identity')
  questions.answer(request.requestId, { value: 'wait' })
  assert.equal(await answer, 'wait')
  assert.throws(() => questions.answer(request.requestId, { value: 'wait' }), /no longer open/)

  const first = questions.ask({ question: QUESTION, choices: CHOICES })
  const firstId = questions.current()!.id
  questions.defer(firstId)
  assert.equal(await first, null)
  const second = questions.ask({ question: QUESTION, choices: CHOICES })
  const secondId = questions.current()!.id
  assert.notEqual(secondId, firstId, 'identical words do not correlate independent asks')
  for (const stale of [request.requestId, firstId, 'foreign-home:request']) {
    assert.throws(() => questions.answer(stale, { value: 'wait' }), /no longer open/)
    assert.equal(questions.current()?.id, secondId)
  }
  questions.answer(secondId, { value: 'wait' })
  assert.equal(await second, 'wait')
})

test('a host that closes takes its question away as no answer, and does not put it off', async () => {
  const questions = new Questions({ onChange: () => {}, canShow: () => true, typing: () => false })
  const asked = questions.ask({ question: QUESTION, choices: CHOICES })
  questions.close()
  // Put off would leave it in Action Items while the next start asks it again. Undefined lets hobkin ask it again instead.
  assert.equal(await asked, undefined)
  assert.equal(questions.current(), null)
})

test('a filed card goes on the sheet with who filed it, its pick and what it says of itself, and leaves out what it does not say', () => {
  const filed: Decision = {
    id: 'd1', question: QUESTION, choices: [...CHOICES, { value: 'always', label: 'Always: From now on, promote staging on Fridays.' }],
    from: 'Routine release-train', tldr: 'Promote staging?', recommended: 'promote', why: 'The checks passed.', answerTo: { kind: 'routine', id: 'release-train' },
    sure: 'high', reversible: true, deadline: '2026-11-26T22:00:00.000Z', kind: 'promote-staging', learn: true, rule: 'From now on, promote staging on Fridays.',
  }
  assert.deepEqual(filedDetails(filed), {
    from: 'Routine release-train', tldr: 'Promote staging?', recommended: 'promote', why: 'The checks passed.',
    sure: 'high', reversible: true, defaultsAt: '2026-11-26T22:00:00.000Z', learn: true,
  })
  // A card filed before hobkin kept these, or one that gives none of them, asks as it always has.
  assert.deepEqual(filedDetails({ id: 'd2', question: QUESTION, choices: CHOICES, recommended: null, why: null, sure: null, reversible: null, deadline: null, learn: null }), {})
})

test("an agent's question keeps its sender and summary and gets no recommendation from a filed decision", async () => {
  // A decision filed with the same words, which `describe` finds by them.
  const describe = () => ({ from: 'deploy session', tldr: 'Promote staging?', recommended: 'promote', why: 'Only you can approve a release.' })
  const questions = new Questions({ onChange: () => {}, canShow: () => true, typing: () => false, describe })
  const asked = questions.ask({ question: QUESTION, choices: CHOICES, other: true, from: 'Fix the flaky cache test', tldr: 'Deploy' })
  const { id: _id, askedAt: _at, ...shown } = questions.current()!
  assert.deepEqual(shown, { from: 'Fix the flaky cache test', question: QUESTION, tldr: 'Deploy', choices: CHOICES, other: true, expiresAt: null })
  questions.close()
  assert.equal(await asked, undefined)
})

test('a question times out to action items and an answer resolves it', async (t) => {
  // hobkin keeps a question up for 30 seconds. The test does not wait that long.
  const { client, asked, gone, file, waiting } = await questionHost(t, 400)

  const first = file()
  const question = await asked()
  assert.deepEqual(
    { ...question, id: 'x', askedAt: 0, expiresAt: 0 },
    { id: 'x', from: 'deploy session', question: QUESTION, tldr: 'Promote staging?', choices: CHOICES, other: true, recommended: 'wait', why: 'Only you can approve a release.', askedAt: 0, expiresAt: 0 },
  )
  assert.equal(question.expiresAt! - question.askedAt, 400)
  assert.ok(Math.abs(question.askedAt - Date.now()) < 5000)

  // Nobody answers. It leaves the screen by itself and waits under Action items, still open.
  await gone()
  await client.until(() => waiting().some((decision) => decision.id === first && decision.shown === true), 'the question to wait in Action items')
  const late = await client.command('question.answer', { id: question.id, value: 'promote' })
  assert.equal(!late.ok && late.error.code, 'unavailable', 'an answer to a question that left the screen goes nowhere')
  assert.equal(waiting().length, 1)

  // The next one is answered with one of its choices, and hobkin carries the answer out.
  const second = file('The staging deploy is ready again. Promote it now?')
  const next = await asked()
  assert.notEqual(next.id, question.id)
  const notAChoice = await client.command('question.answer', { id: next.id, value: 'ship-it' })
  assert.equal(notAChoice.ok, false)
  const neither = await client.command('question.answer', { id: next.id })
  assert.equal(neither.ok, false)
  assert.deepEqual(await client.run('question.answer', { id: next.id, value: 'promote' }), { ok: true })
  await gone()
  await client.until(() => !waiting().some((decision) => decision.id === second), 'the answered question to leave Action items')
  assert.deepEqual(waiting().map((decision) => decision.id), [first], 'the one that timed out still waits there')
})

test('a question takes the user\'s own words, or waits for later', async (t) => {
  const { client, asked, gone, file, waiting } = await questionHost(t)

  const first = file()
  const question = await asked()
  assert.equal(question.expiresAt! - question.askedAt, 30000, 'hobkin\'s own thirty seconds')
  await client.run('question.answer', { id: question.id, typed: 'Promote it after the backup finishes.' })
  await gone()
  await client.until(() => !waiting().some((decision) => decision.id === first), 'the answered question to leave Action items')

  // "Later" takes it off the screen at once and leaves it open under Action items.
  const second = file('One more thing: tag the release too?')
  const next = await asked()
  assert.deepEqual(await client.run('question.defer', { id: next.id }), { ok: true })
  await gone()
  await client.until(() => waiting().some((decision) => decision.id === second && decision.shown === true), 'the deferred question to wait in Action items')
})

test('a UI that connects while a question is up gets it', async (t) => {
  const { afterTest, Client } = await import('./support.ts')
  const { client, asked, file } = await questionHost(t)
  file()
  const question = await asked()

  const late = await Client.connect({ port: Number(new URL(client.url).port), token: new URL(client.url).searchParams.get('token')! })
  afterTest(t, () => late.close())
  await late.until(() => late.received.some((message) => message.type === 'ask' && message.question?.id === question.id), 'the question on the second connection')
})
