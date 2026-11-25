import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import type { RunGuide } from '#shared/protocol/work.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { guideHandlers, type GuideRuntime } from '../src/work-guide.ts'

const guide: RunGuide = {
  slug: 'storefront',
  text: '# Run it\n1. bin/setup',
  writtenAt: '2026-11-24T10:00:00Z',
  commit: 'abc1234',
  sources: ['README.md'],
  lastRun: { at: '2026-11-24T11:00:00Z', by: 'guide', item: null, worked: true, reached: null, note: null },
  pending: null,
  refused: null,
}

function world(overrides: GuideRuntime = {}) {
  const calls: string[] = []
  const refreshed: string[] = []
  const runtime: GuideRuntime = {
    readRunGuide: (root, slug) => (calls.push(`read ${root} ${slug}`), guide),
    requestRunGuide: async (root, slug) => {
      calls.push(`request ${root} ${slug}`)
      return { message: 'Filed a guide look for storefront.' }
    },
    ...overrides,
  }
  const make = (given: GuideRuntime) => guideHandlers({ root: () => '/root', refresh: async () => void refreshed.push('refresh'), runtime: () => given })
  return { calls, refreshed, handlers: make(runtime), without: make({}) }
}

test("a read passes hobkin's guide through", async () => {
  const { handlers, calls } = world()
  assert.deepEqual(await runCommand(handlers, 'work.guide.read', { slug: 'storefront' }), { ok: true, value: guide })
  assert.deepEqual(calls, ['read /root storefront'])
})

test("a read passes hobkin's refusal on in its words", async () => {
  const { handlers } = world({
    readRunGuide: () => {
      throw Error('A goal has no run guide.')
    },
  })
  assert.deepEqual(await runCommand(handlers, 'work.guide.read', { slug: 'notes' }), { ok: false, error: { code: 'failed', message: 'A goal has no run guide.' } })
})

test("a write passes hobkin's line on and reads hobkin again", async () => {
  const { handlers, calls, refreshed } = world()
  assert.deepEqual(await runCommand(handlers, 'work.guide.write', { slug: 'storefront' }), { ok: true, value: { message: 'Filed a guide look for storefront.' } })
  assert.deepEqual(calls, ['request /root storefront'])
  assert.deepEqual(refreshed, ['refresh'])
})

test("a write passes hobkin's refusal on in its words, and refreshes nothing", async () => {
  const { handlers, refreshed } = world({
    requestRunGuide: () => {
      throw Error('storefront is not taken.')
    },
  })
  assert.deepEqual(await runCommand(handlers, 'work.guide.write', { slug: 'storefront' }), { ok: false, error: { code: 'failed', message: 'storefront is not taken.' } })
  assert.deepEqual(refreshed, [])
})

test('a hobkin without the functions answers unavailable for both', async () => {
  const { without } = world()
  const unavailable = { ok: false, error: { code: 'unavailable', message: 'This hobkin cannot keep run guides yet. Update hobkin.' } }
  assert.deepEqual(await runCommand(without, 'work.guide.read', { slug: 'storefront' }), unavailable)
  assert.deepEqual(await runCommand(without, 'work.guide.write', { slug: 'storefront' }), unavailable)
})

test("hobkin's client tool lists both and runs them through the host", async () => {
  const { handlers } = world()
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  const listed = ((await tool.execute('1', { action: 'list' })).details as { name: string }[]).map((command) => command.name)
  assert.ok(listed.includes('work.guide.read') && listed.includes('work.guide.write'))
  assert.equal(COMMANDS['work.guide.read'].hobkin, true)
  assert.equal(COMMANDS['work.guide.write'].hobkin, true)
  await tool.execute('2', { action: 'run', name: 'work.guide.read', args: { slug: 'storefront' } })
})
