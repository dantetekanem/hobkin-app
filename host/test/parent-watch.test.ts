import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { parseArguments } from '../src/arguments.ts'
import { processAlive, watchParent } from '../src/parent-watch.ts'

test('--parent names the process that started the host', () => {
  assert.equal(parseArguments(['--live', '--parent', '4242']).parent, 4242)
  assert.equal(parseArguments(['--live']).parent, undefined)
  assert.throws(() => parseArguments(['--parent', 'app']), /--parent needs a process id/)
  assert.throws(() => parseArguments(['--parent', '0']), /--parent needs a process id/)
})

test('the host is told once, when the process that started it has gone', async () => {
  let alive = true
  let told = 0
  watchParent(4242, () => (told += 1), { alive: () => alive, every: 5 })

  await delay(30)
  assert.equal(told, 0, 'nothing while the parent is there')

  alive = false
  await delay(30)
  assert.equal(told, 1)

  await delay(30)
  assert.equal(told, 1, 'told once, not on every check')
})

test('a parent that is still running is seen as alive, and a finished one as gone', () => {
  assert.equal(processAlive(process.pid), true)
  // A process id far above any the system hands out.
  assert.equal(processAlive(2 ** 22 + 12345), false)
})
