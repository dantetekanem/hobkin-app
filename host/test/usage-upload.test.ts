import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { initialize, telemetryUploadEnabled } from 'hobkin/src/cli/config.mjs'
import { runCommand } from '../src/commands.ts'
import { createClientTool } from '../src/client-tool.ts'
import { usageUploadHandlers } from '../src/usage-upload.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

function newHome(t: Parameters<typeof temporaryDirectory>[0]): string {
  const root = temporaryDirectory(t)
  initialize(root, { cwd: root, now: '2026-01-01T00:00:00Z' })
  return root
}

async function run(root: string, where: { live: boolean; real: boolean }, name: 'usage.read' | 'usage.apply', args: object = {}) {
  const outcome = await runCommand(usageUploadHandlers({ root: () => root, ...where }), name, args)
  if (!outcome.ok) throw Object.assign(Error(outcome.error.message), { code: outcome.error.code })
  return outcome.value
}

const realHome = { live: true, real: true }

test("on a live host's real home Settings reads and sets hobkin's own upload setting", async (t) => {
  const root = newHome(t)

  assert.deepEqual(await run(root, realHome, 'usage.read'), { upload: false, saves: true }, 'never asked: off')

  assert.deepEqual(await run(root, realHome, 'usage.apply', { upload: true }), { upload: true, saves: true })
  assert.equal(telemetryUploadEnabled(root), true, 'a yes: the next pass enrolls')
  assert.deepEqual(await run(root, realHome, 'usage.read'), { upload: true, saves: true })

  // Off forgets where upload was and what waited, as `hobkin telemetry upload off` does.
  const state = join(root, 'telemetry', 'state.json')
  mkdirSync(join(root, 'telemetry'), { recursive: true })
  writeFileSync(state, JSON.stringify({ version: 1, salt: 'a'.repeat(64), cursor: { file: '2026-11.jsonl', offset: 10 }, batch: { id: 'b' }, toldAt: '2026-11-01T00:00:00Z' }))
  assert.deepEqual(await run(root, realHome, 'usage.apply', { upload: false }), { upload: false, saves: true })
  assert.equal(telemetryUploadEnabled(root), false)
  assert.deepEqual(JSON.parse(readFileSync(state, 'utf8')), { version: 1, toldAt: '2026-11-01T00:00:00Z' })
})

test('any other host says it does not keep the setting, and refuses to change it', async (t) => {
  for (const where of [{ live: false, real: true }, { live: true, real: false }]) {
    const root = newHome(t)

    assert.deepEqual(await run(root, where, 'usage.read'), { upload: false, saves: false }, JSON.stringify(where))
    await assert.rejects(run(root, where, 'usage.apply', { upload: true }), (error: Error & { code?: string }) => error.code === 'unavailable')
    assert.equal(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).telemetryUpload, undefined, 'the setting is left as it was')
  }
})

test("through the host: Settings reads it, and hobkin's own client tool cannot change it", async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()

  assert.deepEqual(await client.run('usage.read'), { upload: false, saves: false })
  const refused = await client.command('usage.apply', { upload: true })
  assert.equal(!refused.ok && refused.error.code, 'unavailable')
  assert.equal(existsSync(join(host.root, 'runtime', 'remote.json')), false)

  const { COMMANDS } = await import('#shared/commands/registry.ts')
  assert.equal(COMMANDS['usage.apply'].outside, true)
  const ran: string[] = []
  const tool = createClientTool({ run: async (name) => (ran.push(name), { ok: true, value: null }) })
  await assert.rejects(tool.execute('1', { action: 'run', name: 'usage.apply' }), /outside the app/)
  assert.deepEqual(ran, [])
})
