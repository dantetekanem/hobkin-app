import assert from 'node:assert/strict'
import { test } from 'node:test'
import { afterTest, Client, hostFor } from './support.ts'

test("the window gets the runtime's schedules in the snapshot, and the host answers its commands", async (t) => {
  const host = await hostFor(t)
  const window = await Client.connect(host)
  afterTest(t, () => window.close())

  const view = await window.until((seen) => Array.isArray(seen.snapshot.agentSchedules), 'the schedules in the snapshot')
  assert.deepEqual(view.snapshot.agentSchedules, [], 'a home where no agent has made one has none')

  // The host's list has no such schedule, so the runtime is not asked.
  const cancelled = await window.command('schedule.cancel', { id: 'abcd1234' })
  assert.deepEqual(cancelled, { type: 'result', id: cancelled.id, ok: false, error: { code: 'unavailable', message: 'hobkin has no such schedule, so nothing changed.' } })
})
