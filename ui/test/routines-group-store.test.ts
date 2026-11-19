import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import { groupChoices, groupOf } from '../src/features/routines/groups.ts'

/** The window's own storage, as a plain object, so a reload can be played. */
const files = new Map<string, string>()
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: { getItem: (name: string) => files.get(name) ?? null, setItem: (name: string, value: string) => void files.set(name, value), removeItem: (name: string) => void files.delete(name) } },
})

const now = Date.parse('2026-11-10T12:00:00Z')
mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now })
const { useRoutines } = await import('../src/features/routines/store.ts')
after(() => mock.timers.reset())

const NAME = 'hobkin-client-routines'
const stored = () => JSON.parse(files.get(NAME) ?? 'null') as { state: { groups: unknown } } | null
test('only the screen\'s own groups, each open or folded, are taken from storage', () => {
  assert.deepEqual(groupChoices({ daily: true, weekly: false, monthly: true, once: false }), { daily: true, weekly: false, monthly: true, once: false })
  assert.deepEqual(groupChoices({ daily: true, bogus: true, weekly: 'yes', monthly: 1, once: null }), { daily: true })
  assert.deepEqual(groupChoices(null), {})
  assert.deepEqual(groupChoices('daily'), {})
  assert.deepEqual(groupChoices(['daily']), {})
})

test('a group the user opened or folded stays so after a reload, and one never touched has no choice', async () => {
  useRoutines.getState().setGroup('daily', true)
  useRoutines.getState().setGroup('weekly', false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(stored()?.state.groups, { daily: true, weekly: false })

  // A reload: the window starts empty and reads what was kept.
  const before = files.get(NAME)!
  useRoutines.setState({ groups: {} })
  files.set(NAME, before)
  await useRoutines.persist.rehydrate()
  assert.deepEqual(useRoutines.getState().groups, { daily: true, weekly: false })
  assert.equal(useRoutines.getState().groups.monthly, undefined)

  // Whatever else sits in storage is ignored.
  files.set(NAME, JSON.stringify({ state: { view: 'all', groups: { daily: false, bogus: true, monthly: 'open' } }, version: 1 }))
  await useRoutines.persist.rehydrate()
  assert.deepEqual(useRoutines.getState().groups, { daily: false })
})

test('opening a routine from the sky opens its group, so the keyboard has a row to come back to', () => {
  const { data } = useRoutines.getState()
  const routine = data.routines.find(({ cadence }) => cadence === 'monthly') ?? data.routines[0]!
  useRoutines.setState({ groups: { daily: false, weekly: false, monthly: false, once: false } })
  useRoutines.getState().open(routine.id, 'sky')

  assert.equal(useRoutines.getState().groups[groupOf(routine)], true)
  useRoutines.getState().close()
})
