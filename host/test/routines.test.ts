import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { afterTest, Client, hostFor, temporaryDirectory, type View } from './support.ts'

/** A temporary home with one routine, off, so nothing runs by itself. The scripted runner runs nothing real. */
async function hostWithRoutine(t: TestContext) {
  const root = join(temporaryDirectory(t), 'home')
  const file = join(root, 'routines', 'daily', 'recap.md')
  mkdirSync(join(root, 'routines', 'daily'), { recursive: true })
  const metadata = { id: 'recap', title: 'Morning recap', at: '09:00', timezone: 'UTC', enabled: false, harness: 'pi', effort: 'medium', cwd: root, context: [] }
  writeFileSync(file, `---\n${JSON.stringify(metadata)}\n---\nSay good morning.\n`)

  const client = await Client.connect(await hostFor(t, { root }))
  afterTest(t, () => client.close())
  await client.until((view) => recap(view), 'the routine in the snapshot')
  return { client, file }
}

type Schedule = { id: string; enabled: boolean; at?: unknown; window?: unknown }
const recap = (view: View) => (view.snapshot.schedules as Schedule[] | undefined)?.find(({ id }) => id === 'recap')

test("a routine's switch and times change its file through hobkin, and the snapshot has it before the answer", async (t) => {
  const { client, file } = await hostWithRoutine(t)

  assert.deepEqual(await client.run('routine.enable', { id: 'recap', enabled: true }), { ok: true })
  assert.equal(recap(client.view)?.enabled, true)

  const window = { start: '08:00', end: '12:00', everyMinutes: 60 }
  assert.deepEqual(await client.run('routine.times', { id: 'recap', window }), { ok: true })
  assert.deepEqual(recap(client.view)?.window, window)
  assert.equal(recap(client.view)?.at, undefined)
  assert.ok(readFileSync(file, 'utf8').endsWith('---\nSay good morning.\n'), 'the rest of the file stays')

  // What hobkin would not load is refused in its words, and nothing changes.
  const refused = await client.command('routine.times', { id: 'recap', window: { ...window, everyMinutes: 1 } })
  assert.equal(refused.ok ? null : refused.error.message, 'window may contain at most 48 checks per day')
  assert.deepEqual(recap(client.view)?.window, window)
  assert.equal((await client.command('routine.times', { id: 'recap', at: '09:00', window })).ok, false)
})

test('Run now starts a routine once through hobkin, even while it is off, and an unknown one is refused', async (t) => {
  const { client } = await hostWithRoutine(t)

  const { run } = await client.run<{ run: string }>('routine.run', { id: 'recap' })
  assert.match(run, /^once:[0-9a-f]{64}$/)
  await client.until((view) => (view.snapshot.runs as { id: string }[] | undefined)?.some(({ id }) => id === run), 'the run in the snapshot')
  assert.equal(recap(client.view)?.enabled, false, 'running it changed no setting')

  const unknown = await client.command('routine.run', { id: 'missing' })
  assert.equal(unknown.ok ? null : unknown.error.message, 'Unknown exact native routine ID; list candidates first.')
})
