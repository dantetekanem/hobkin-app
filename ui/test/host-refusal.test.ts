import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { explainRefusal, RESTART_NEEDED } from '../src/lib/host/refusal.ts'
import { CommandError, HostConnection } from '../src/lib/host/connection.ts'

test('a host older than the window refuses a known command by name, and the window says a restart fixes it', () => {
  const refused = explainRefusal(new Error('There is no command named "routine.run".'))
  assert.ok(refused instanceof Error)
  assert.equal(refused.message, RESTART_NEEDED)
})

test('explaining an unknown command retains its code so steering is refused, not uncertain', { timeout: 2000 }, async (t) => {
  const error = new CommandError('unknown-command', 'There is no command named "agent.say".')
  const refused = explainRefusal(error)
  assert.ok(refused instanceof Error && 'code' in refused)
  assert.equal(refused.code, 'unknown-command')
  assert.equal(refused.message, RESTART_NEEDED)
  assert.equal(refused.cause, error)

  const aliases = registerHooks({
    resolve(specifier, context, next) {
      return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context)
    },
  })
  try {
    const { sayToAgent } = await import('../src/features/work/say.ts')
    t.mock.method(HostConnection.prototype, 'command', async () => { throw error })
    assert.deepEqual(await sayToAgent('run', 'Wait', { live: true }), { sent: false, why: RESTART_NEEDED, uncertain: false })
  } finally {
    aliases.deregister()
  }
})

test("any other refusal keeps hobkin's own words", () => {
  const busy = new Error('Routine is already running.')
  assert.equal(explainRefusal(busy), busy)
})
