import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import type { CatchUpState } from '#shared/protocol/reports.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { catchUpHandlers, type CatchUpRuntime } from '../src/report-catch-up.ts'

const state: CatchUpState = { daily: '08:00', pileUp: 8, running: false, lastAt: '2026-11-24T08:01:00Z', uncovered: 3 }

function world(overrides: CatchUpRuntime = {}) {
  const calls: unknown[] = []
  const refreshed: string[] = []
  const app = { runtime: { directory: '/root' }, refresh: async () => void refreshed.push('refresh') }
  const runtime: CatchUpRuntime = {
    readCatchUp: (root) => (calls.push(['read', root]), state),
    setCatchUp: (root, change) => (calls.push(['set', root, change]), { ...state, ...change }),
    startCatchUp: async (root, given) => {
      calls.push(['start', root, given === app])
      return { message: 'Catching up on 3 reports.' }
    },
    ...overrides,
  }
  const make = (given: CatchUpRuntime) => catchUpHandlers({ app: () => app, runtime: () => given })
  return { calls, refreshed, handlers: make(runtime), without: make({}) }
}

test("a read passes hobkin's settings through", async () => {
  const { handlers, calls, refreshed } = world()
  assert.deepEqual(await runCommand(handlers, 'reports.catchup.read', {}), { ok: true, value: state })
  assert.deepEqual(calls, [['read', '/root']])
  assert.deepEqual(refreshed, [])
})

test("a change passes the user's words to hobkin, answers hobkin's settings and reads hobkin again", async () => {
  const { handlers, calls, refreshed } = world()
  assert.deepEqual(await runCommand(handlers, 'reports.catchup.set', { daily: null, pileUp: 12 }), { ok: true, value: { ...state, daily: null, pileUp: 12 } })
  assert.deepEqual(calls, [['set', '/root', { daily: null, pileUp: 12 }]])
  assert.deepEqual(refreshed, ['refresh'])
})

test("a change hobkin refuses is passed on in its words, and refreshes nothing", async () => {
  const { handlers, refreshed } = world({
    setCatchUp: () => {
      throw Error('The daily time is HH:MM, such as 08:00.')
    },
  })
  assert.deepEqual(await runCommand(handlers, 'reports.catchup.set', { daily: '07:30' }), { ok: false, error: { code: 'failed', message: 'The daily time is HH:MM, such as 08:00.' } })
  assert.deepEqual(refreshed, [])
})

test("a run hands hobkin its application, passes hobkin's line on and reads hobkin again", async () => {
  const { handlers, calls, refreshed } = world()
  assert.deepEqual(await runCommand(handlers, 'reports.catchup.run', {}), { ok: true, value: { message: 'Catching up on 3 reports.' } })
  assert.deepEqual(calls, [['start', '/root', true]])
  assert.deepEqual(refreshed, ['refresh'])
})

test("a run hobkin refuses is passed on in its words", async () => {
  const { handlers } = world({
    startCatchUp: () => {
      throw Error('The fast tier has no model yet.')
    },
  })
  assert.deepEqual(await runCommand(handlers, 'reports.catchup.run', {}), { ok: false, error: { code: 'failed', message: 'The fast tier has no model yet.' } })
})

test('a hobkin without the module answers unavailable for all three', async () => {
  const { without } = world()
  const unavailable = { ok: false, error: { code: 'unavailable', message: 'This hobkin cannot write a catch-up yet. Update hobkin.' } }
  assert.deepEqual(await runCommand(without, 'reports.catchup.read', {}), unavailable)
  assert.deepEqual(await runCommand(without, 'reports.catchup.set', { pileUp: 8 }), unavailable)
  assert.deepEqual(await runCommand(without, 'reports.catchup.run', {}), unavailable)
})

test("hobkin's client tool lists the read and the run, never the change, and runs them through the host", async () => {
  const { handlers, calls } = world()
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  const listed = ((await tool.execute('1', { action: 'list' })).details as { name: string }[]).map((command) => command.name)
  assert.ok(listed.includes('reports.catchup.read') && listed.includes('reports.catchup.run'))
  assert.equal(listed.includes('reports.catchup.set'), false, 'each catch-up spends a model call, so only the user sets when they run')
  assert.equal(COMMANDS['reports.catchup.read'].hobkin, true)
  assert.equal(COMMANDS['reports.catchup.run'].hobkin, true)
  await tool.execute('2', { action: 'run', name: 'reports.catchup.run', args: {} })
  assert.deepEqual(calls, [['start', '/root', true]])
})
