import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { initialize, telemetryUploadEnabled } from 'hobkin/src/cli/config.mjs'
import type { SetupAnswers, SetupSaved } from '#shared/protocol/setup.ts'
import { runCommand } from '../src/commands.ts'
import { setupAnswerHandlers } from '../src/setup-answers.ts'
import { createClientTool } from '../src/client-tool.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

/** A hobkin home that was never asked about usage counts and never enrolled. */
function newHome(t: Parameters<typeof temporaryDirectory>[0]): string {
  const root = temporaryDirectory(t)
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' })
  return root
}

const savedSetting = (root: string) => JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).telemetryUpload?.enabled
const savedAnswer = (root: string) => JSON.parse(readFileSync(join(root, 'client', 'setup.json'), 'utf8')).telemetry

async function answer(root: string, where: { live: boolean; real: boolean }, upload: boolean) {
  const handlers = setupAnswerHandlers({ root: () => root, ...where })
  const outcome = await runCommand(handlers, 'setup.telemetry', { upload })
  if (!outcome.ok) throw Error(outcome.error.message)
  return outcome.value
}

test("on a live host's real home the answer is hobkin's own setting, and it is kept with the setup's answers", async (t) => {
  const root = newHome(t)
  assert.equal(telemetryUploadEnabled(root), false, 'nothing goes before the answer')

  assert.deepEqual(await answer(root, { live: true, real: true }, true), { upload: true })
  assert.equal(savedSetting(root), true)
  assert.equal(savedAnswer(root), true)

  assert.deepEqual(await answer(root, { live: true, real: true }, false), { upload: false })
  assert.equal(savedSetting(root), false)
  assert.equal(savedAnswer(root), false)
})

test('any other host keeps the answer, changes no setting, and says nothing goes from this home', async (t) => {
  for (const where of [{ live: false, real: true }, { live: true, real: false }, { live: false, real: false }]) {
    const root = newHome(t)

    assert.deepEqual(await answer(root, where, true), { upload: false }, JSON.stringify(where))
    assert.equal(savedSetting(root), undefined, 'the setting is left as it was')
    assert.equal(savedAnswer(root), true, 'the answer is kept')
  }
})

test('a later save of the other answers keeps the usage answer, and the setup reads it back', async (t) => {
  const root = newHome(t)
  const handlers = setupAnswerHandlers({ root: () => root, live: true, real: true })
  const answers: SetupAnswers = { computer: 'personal', answers: [], projects: [], goals: ['life'] }

  await answer(root, { live: true, real: true }, true)
  const saved = await runCommand(handlers, 'setup.save', answers)
  assert.ok(saved.ok)
  assert.equal((saved.value as SetupSaved).telemetry, true)

  const read = await runCommand(handlers, 'setup.saved', {})
  assert.ok(read.ok)
  assert.equal((read.value as SetupSaved).telemetry, true)
  assert.deepEqual((read.value as SetupSaved).goals, ['life'])

  // A setup saved before the question was asked has no answer.
  const fresh = newHome(t)
  await runCommand(setupAnswerHandlers({ root: () => fresh }), 'setup.save', answers)
  assert.equal(JSON.parse(readFileSync(join(fresh, 'client', 'setup.json'), 'utf8')).telemetry, undefined)
})

test("through the host: a scripted host keeps the answer and sends nothing, and hobkin's own client tool cannot answer for the user", async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  assert.deepEqual(await client.run('setup.telemetry', { upload: true }), { upload: false })
  assert.equal((await client.run<SetupSaved>('setup.saved'))?.telemetry, true)
  assert.equal(existsSync(join(host.root, 'runtime', 'remote.json')), false, 'no enrollment')

  const { COMMANDS } = await import('#shared/commands/registry.ts')
  assert.equal(COMMANDS['setup.telemetry'].outside, true)
  const ran: string[] = []
  const tool = createClientTool({ run: async (name) => (ran.push(name), { ok: true, value: null }) })
  await assert.rejects(tool.execute('1', { action: 'run', name: 'setup.telemetry' }), /outside the app/)
  assert.deepEqual(ran, [])
})
