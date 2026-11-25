import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scheduleDefinition } from 'hobkin/src/cli/checks.mjs'
import { checkArguments } from '../../shared/commands/registry.ts'
import { routineHandlers } from '../src/routines.ts'
import { toWire } from '../src/state-sync.ts'

test('deletion projects the full server definition and forwards only the pinned fingerprint to the runner', async () => {
  const definition = { id: 'daily.test', path: '/fake/routines/daily/test.md', prompt: 'Original', extra: { future: true } }
  const expectedDefinition = scheduleDefinition(definition)
  const wire = toWire({ schedules: [{ ...definition, nextRun: { state: 'scheduled' } }] }).values.schedules as Record<string, unknown>[]
  assert.equal(wire[0]?.expectedDefinition, expectedDefinition)
  assert.notEqual(expectedDefinition, scheduleDefinition({ ...definition, extra: false }))
  const calls: unknown[] = []
  let receipt: unknown = { id: definition.id, deleted: true }
  const handlers = routineHandlers({ app: () => ({ runner: { change: async (...args: unknown[]) => { calls.push(args); return receipt } }, refresh: async () => { calls.push('refresh') } }) })
  const remove = handlers['routine.delete']
  assert.ok(remove)
  assert.deepEqual(await remove({ id: definition.id, expectedDefinition }), receipt)
  assert.deepEqual(calls, [[definition.id, { delete: expectedDefinition }], 'refresh'])
  receipt = { id: 'another', deleted: true }
  await assert.rejects(async () => remove({ id: definition.id, expectedDefinition }), /confirm/)
  assert.equal(checkArguments('routine.delete', { id: definition.id, expectedDefinition: '' }).ok, false)
})
