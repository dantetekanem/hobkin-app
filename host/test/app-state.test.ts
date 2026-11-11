import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AppStateRead } from '#shared/commands/registry.ts'
import type { HobkinSnapshot } from 'hobkin/src/cli/application.mjs'
import { appStateHandlers } from '../src/app-state.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand, Unavailable } from '../src/commands.ts'

function fixture() {
  let refreshed = 0
  const snapshot = { messages: [{}], reports: [{ body: 'private' }], runs: [{ state: 'running' }], busy: true, doing: 'Reading', tooling: true }
  const app = { runtime: { main: { sessionId: 'session-a' } }, refresh: async (): Promise<HobkinSnapshot> => { refreshed++; return snapshot } }
  const owner = { state: { state: 'live' as const, limits: { images: 1, imageBytes: 100 } }, app: app as typeof app | null, snapshot }
  const handlers = appStateHandlers({ root: '/isolated/home', owner, revision: () => 7 })
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  const read = async (name: string) => (await tool.execute('tool-id', { action: 'run', name })).details as AppStateRead
  return { app, owner, handlers, tool, read, refreshed: () => refreshed }
}

test('client lists and describes strict app reads without exposing lifecycle or slash commands', async () => {
  const { tool } = fixture()
  const listed = (await tool.execute('list', { action: 'list' })).details as { name: string }[]
  for (const name of ['app.state', 'app.refresh']) {
    assert.ok(listed.some((row) => row.name === name))
    const described = (await tool.execute('describe', { action: 'describe', name })).details as { args: { additionalProperties: boolean; properties: object } }
    assert.equal(described.args.additionalProperties, false)
    assert.deepEqual(described.args.properties, {})
  }
  for (const name of ['slash.run', 'file.read', 'app.reset', 'app.restart']) {
    await assert.rejects(tool.execute('run', { action: 'run', name }), /cannot run|no command/)
  }
})

test('state reads the current projection; unchanged refresh completes with a distinct read receipt', async () => {
  const f = fixture()
  const state = await f.read('app.state')
  assert.equal(f.refreshed(), 0)
  const refreshed = await f.read('app.refresh')
  assert.equal(f.refreshed(), 1)
  assert.equal(refreshed.operation.status, 'completed')
  assert.equal(refreshed.operation.command, 'app.refresh')
  assert.notEqual(state.operation.id, refreshed.operation.id)
  assert.ok(refreshed.operation.completedAt >= refreshed.operation.requestedAt)
  assert.equal(refreshed.owner.id, state.owner.id)
  assert.equal(refreshed.home, '/isolated/home')
  assert.equal(refreshed.sessionId, 'session-a')
  assert.equal(refreshed.loadedRevision, null)
  assert.equal(refreshed.stateRevision, 7)
  assert.deepEqual(refreshed.counts, { messages: 1, reports: 1, runs: 1, activeRuns: 1 })
  assert.deepEqual(refreshed.activity, { busy: true, tooling: true, doing: 'Reading' })
  assert.equal(JSON.stringify(refreshed).includes('private'), false)
})

test('malformed app arguments never refresh', async () => {
  const f = fixture()
  for (const name of ['app.state', 'app.refresh']) {
    for (const args of [{ force: true }, [], 'reload']) {
      const result = await runCommand(f.handlers, name, args)
      assert.equal(result.ok, false)
      if (!result.ok) assert.equal(result.error.code, 'invalid-arguments')
    }
  }
  await assert.rejects(f.tool.execute('bad', { action: 'run', name: 'app.refresh', args: { reset: true } }), /arguments/)
  assert.equal(f.refreshed(), 0)
})

for (const change of ['owner', 'main', 'session', 'closed'] as const) {
  test(`refresh refuses stale ${change} after its async read`, async () => {
    const f = fixture()
    f.app.refresh = async () => {
      if (change === 'owner') f.owner.app = { ...f.app }
      if (change === 'main') f.app.runtime.main = { sessionId: 'session-a' }
      if (change === 'session') f.app.runtime.main.sessionId = 'session-b'
      if (change === 'closed') f.owner.app = null
      return f.owner.snapshot
    }
    const result = await runCommand(f.handlers, 'app.refresh', {})
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.error.code, 'unavailable')
  })
}

test('missing projection fields stay unknown and activity text is bounded', async () => {
  const f = fixture()
  f.app.refresh = async () => ({ doing: 'x'.repeat(1000), version: 'on-disk-is-not-loaded' })
  const read = await f.read('app.refresh')
  assert.deepEqual(read.counts, { messages: null, reports: null, runs: null, activeRuns: null })
  assert.deepEqual(read.activity, { busy: null, tooling: null, doing: 'x'.repeat(240) })
  assert.equal(read.loadedRevision, null)
})

test('refresh preserves typed failures and does not retry', async () => {
  const f = fixture()
  let calls = 0
  f.app.refresh = async () => { calls++; throw new Unavailable('not ready') }
  const result = await runCommand(f.handlers, 'app.refresh', {})
  assert.deepEqual(result, { ok: false, error: { code: 'unavailable', message: 'not ready' } })
  assert.equal(calls, 1)
  f.owner.app = null
  await assert.rejects(f.read('app.state'), /live owner/)
})
