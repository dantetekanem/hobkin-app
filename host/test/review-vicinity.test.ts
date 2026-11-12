import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VicinityLink } from '#shared/review/vicinity.ts'
import { scanVicinity, type ScanRun } from '../src/review/vicinity-scan.ts'

/**
 * agentic-search's packs, as `scan --json` writes them under `details`: the diff scan of the change, then a scan of the
 * callers found so far, given as `--anchor path:line`, for each call further out.
 */
const node = (id: string, path: string, symbol: string, startLine: number, endLine: number, more: Record<string, unknown> = {}) => ({ id, path, symbol, kind: 'function', language: 'javascript', startLine, endLine, depth: 1, ...more })
const caller = (id: string, path: string, line: number, more: Record<string, unknown> = {}) => ({ id, symbol: id, path, line, text: '', context: '', test: false, changed: false, boundary: [], resolution: 'exact', guards: [], ...more })
const complete = (total: number) => ({ total, shown: total, complete: true })

const diff = {
  files: [{ path: 'src/doing.ts' }, { path: 'app/controllers/checkouts_controller.rb' }, { path: 'test/doing.test.ts' }],
  nodes: [
    node('n1', 'src/doing.ts', 'doingAfter', 4, 8, { depth: 0 }),
    node('n2', 'src/runtime.ts', 'listen', 2, 5),
    node('n3', 'src/mood.ts', 'searchingTool', 1, 3),
    node('n4', 'src/notes.ts', 'Notes', 1, 4, { kind: 'type' }),
    node('n5', 'src/other.ts', 'guess', 8, 10),
    // Unchanged, in a changed file: the scan read it at head, lines 10 to 12.
    node('n6', 'src/doing.ts', 'helper', 10, 12),
    node('n7', 'src/a.ts', 'a', 1, 3),
    node('n8', 'src/b.ts', 'b', 1, 3),
    node('n9', 'src/doing.ts', 'local', 14, 16),
    node('r1', 'app/controllers/checkouts_controller.rb', 'CheckoutsController#create', 3, 9, { language: 'ruby', depth: 0, entry: { kind: 'controller', exact: true } }),
    node('r2', 'app/jobs/receipt_job.rb', 'ReceiptJob#perform', 2, 6, { language: 'ruby' }),
    node('r3', 'app/services/cart.rb', 'Cart#total', 2, 8, { language: 'ruby' }),
    node('t1', 'test/doing.test.ts', 'a tool says what kind of work it is', 3, 5, { kind: 'test', depth: 0 }),
  ],
  anchors: [
    {
      id: 'n1', symbol: 'doingAfter', kind: 'function', path: 'src/doing.ts', startLine: 4, endLine: 8, changedLines: [4, 5, 6],
      // listen is proven, helper too; guess only shares the name, and in TypeScript the checker would have said so.
      callers: [caller('n6', 'src/doing.ts', 11, { guards: [{ line: 10, text: 'if (ready)', branch: 'then' }] }), caller('n2', 'src/runtime.ts', 3), caller('n5', 'src/other.ts', 9, { resolution: 'static_candidate' })],
      callerCount: complete(3),
    },
    {
      id: 'r1', symbol: 'CheckoutsController#create', kind: 'method', path: 'app/controllers/checkouts_controller.rb', startLine: 3, endLine: 9, changedLines: [5, 6],
      // Ruby without an index finds callers by name, which is kept when the name is rare enough.
      callers: [caller('r3', 'app/services/cart.rb', 4, { resolution: 'static_candidate' })], callerCount: complete(1),
      entry: { kind: 'controller', exact: true },
    },
    { id: 't1', symbol: 'a tool says what kind of work it is', kind: 'test', path: 'test/doing.test.ts', startLine: 3, endLine: 5, changedLines: [4], callers: [], callerCount: complete(0) },
  ],
  edges: [
    { from: 'n1', to: 'n9', name: 'local', relationship: 'calls', resolution: 'exact', line: 4 },
    { from: 'n1', to: 'n3', name: 'searchingTool', relationship: 'calls', resolution: 'exact', line: 5, guards: [{ line: 5, text: "if (event.type === 'tool')", branch: 'then' }] },
    { from: 'n1', to: 'n7', name: 'a', relationship: 'calls', resolution: 'exact', line: 6 },
    { from: 'n1', to: 'n8', name: 'b', relationship: 'calls', resolution: 'exact', line: 6 },
    // A type is no code that runs, an unresolved call goes nowhere, and a call on an unchanged line is not the change's.
    { from: 'n1', to: 'n4', name: 'notes.add', relationship: 'calls', resolution: 'exact', line: 6 },
    { from: 'n1', name: 'event.name', relationship: 'calls', resolution: 'unresolved', line: 5 },
    { from: 'n1', to: 'n7', name: 'a', relationship: 'calls', resolution: 'exact', line: 7 },
    { from: 'n1', to: 'n3', name: 'searchingTool', relationship: 'calls', resolution: 'exact', line: 8 },
    { from: 'r1', to: 'r2', name: 'ReceiptJob.perform_later', relationship: 'enqueues', resolution: 'static_candidate', line: 6 },
    { from: 't1', to: 'n1', name: 'doingAfter', relationship: 'calls', resolution: 'exact', line: 4 },
  ],
  coverage: { truncatedBy: 'none' },
}

// The callers of listen, helper and Cart#total, from the project's folder: start sits at lines 12 to 17 there.
const second = {
  nodes: [node('m1', 'src/runtime.ts', 'listen', 2, 5), node('m2', 'src/app.ts', 'start', 12, 17), node('m3', 'src/doing.ts', 'helper', 20, 22), node('m4', 'app/services/cart.rb', 'Cart#total', 2, 8, { language: 'ruby' })],
  anchors: [
    { id: 'm1', symbol: 'listen', kind: 'function', path: 'src/runtime.ts', startLine: 2, endLine: 5, changedLines: [], callers: [caller('m2', 'src/app.ts', 14, { guards: [{ line: 13, text: 'if (main.ready)', branch: 'then' }] })], callerCount: complete(1) },
    { id: 'm3', symbol: 'helper', kind: 'function', path: 'src/doing.ts', startLine: 20, endLine: 22, changedLines: [], callers: [], callerCount: complete(0) },
    { id: 'm4', symbol: 'Cart#total', kind: 'method', path: 'app/services/cart.rb', startLine: 2, endLine: 8, changedLines: [], callers: [], callerCount: { total: 40, shown: 6, complete: false } },
  ],
  edges: [],
  coverage: { truncatedBy: 'none' },
}

const third = {
  nodes: [node('k1', 'src/app.ts', 'start', 12, 17), node('k2', 'src/main.ts', 'start(globalThis.main)', 2, 2, { kind: 'statement' })],
  anchors: [{ id: 'k1', symbol: 'start', kind: 'function', path: 'src/app.ts', startLine: 12, endLine: 17, changedLines: [], callers: [caller('k2', 'src/main.ts', 2)], callerCount: complete(1) }],
  edges: [],
  coverage: { truncatedBy: 'none' },
}

/** The doing.ts the change left, and the one in the project's folder, where helper sits lower down. */
const helperAtHead = ['import { searchingTool } from "./mood.ts"', '', '', 'export function doingAfter() {', '', '', '', '}', '', 'function helper() {', '  return doingAfter()', '}'].join('\n')
const helperInFolder = [...Array.from({ length: 19 }, () => '// older lines'), 'function helper() {', '  return doingAfter()', '}'].join('\n')

function fakeScans(packs: unknown[]) {
  const calls: string[][] = []
  const run: ScanRun = async (args) => {
    calls.push([...args])
    const pack = packs[calls.length - 1]
    return pack === undefined ? { ok: false, reason: 'no pack for this scan' } : { ok: true, stdout: JSON.stringify({ text: '', details: pack }) }
  }
  return { run, calls }
}

const scan = (run: ScanRun, more: Partial<Parameters<typeof scanVicinity>[0]> = {}) =>
  scanVicinity({ repo: '/repo.invalid', base: 'aaa1111', head: 'bbb2222', run, readHead: async (path) => (path === 'src/doing.ts' ? helperAtHead : null), readFolder: (path) => (path === 'src/doing.ts' ? helperInFolder : null), ...more })

const shape = ({ near, other, direction, hops, call, proven, entry }: VicinityLink) => [
  'changed' in near ? `${near.changed.path}:${near.changed.line}` : near.definition.symbol,
  direction,
  other.symbol,
  hops,
  call.line,
  call.name,
  call.guards?.at(-1)?.text ?? null,
  call.enqueues ?? false,
  proven,
  entry?.kind ?? null,
]

test('the life cycle follows proven callers out to where a request enters, and keeps what the changed lines call', async () => {
  const { run, calls } = fakeScans([diff, second, third])
  const found = await scan(run)

  assert.deepEqual(found.links.map(shape), [
    // First the way out from each changed definition, by its best caller at each call.
    ['src/doing.ts:4', 'caller', 'listen', 1, 3, 'doingAfter', null, false, true, null],
    ['listen', 'caller', 'start', 2, 14, 'listen', 'if (main.ready)', false, true, null],
    ['start', 'caller', 'start(globalThis.main)', 3, 2, 'start', null, false, true, 'load'],
    ['app/controllers/checkouts_controller.rb:5', 'caller', 'Cart#total', 1, 4, 'create', null, false, false, null],
    // Then what the changed lines call: a few for each definition, an enqueued job first, another file before its own.
    ['src/doing.ts:5', 'callee', 'searchingTool', 1, 5, 'searchingTool', "if (event.type === 'tool')", false, true, null],
    ['src/doing.ts:6', 'callee', 'a', 1, 6, 'a', null, false, true, null],
    ['src/doing.ts:6', 'callee', 'b', 1, 6, 'b', null, false, true, null],
    ['app/controllers/checkouts_controller.rb:6', 'callee', 'ReceiptJob#perform', 1, 6, 'perform', null, true, false, null],
    // Then the other callers.
    ['src/doing.ts:4', 'caller', 'helper', 1, 11, 'doingAfter', 'if (ready)', false, true, null],
  ])
  assert.deepEqual(found.entries, [{ changed: { path: 'app/controllers/checkouts_controller.rb', line: 5 }, entry: { kind: 'controller', exact: true } }])
  // guess matched only by name; local is a fourth callee of doingAfter; Cart#total has more callers than the scan could list.
  assert.deepEqual(found.left, { byName: 1, perDefinition: 1, further: 0, partial: 1 })

  assert.deepEqual(calls[0]!.slice(0, 6), ['scan', '--diff', 'aaa1111..bbb2222', '--cwd', '/repo.invalid', '--json'])
  // The next scans read the project's folder, so helper, which the first one read at head, is given where the folder has it.
  const anchors = (args: string[]) => args.flatMap((arg, index) => (args[index - 1] === '--anchor' ? [arg] : []))
  assert.deepEqual(anchors(calls[1]!), ['src/runtime.ts:2', 'app/services/cart.rb:2', 'src/doing.ts:20'])
  assert.deepEqual(anchors(calls[2]!), ['src/app.ts:12'])
  assert.equal(calls.length, 3, 'nothing is left to follow past where the request enters')
})

test('a scan that cannot run, or stops, says why instead of holding the review up', async () => {
  const missing = await scan(async () => ({ ok: false, reason: 'agentic-search is not installed.' }))
  assert.deepEqual(missing.links, [])
  assert.match(missing.notice ?? '', /not shown.*agentic-search is not installed/)

  const garbled = await scan(async () => ({ ok: true, stdout: 'not json' }))
  assert.deepEqual(garbled.links, [])
  assert.match(garbled.notice ?? '', /not shown/)

  // The first call out is kept when a scan further out fails, and the review says where the life cycle stops.
  const { run } = fakeScans([{ ...diff, coverage: { truncatedBy: 'budget' } }])
  const stopped = await scan(run)
  assert.ok(stopped.links.some((link) => link.other.symbol === 'listen'))
  assert.ok(!stopped.links.some((link) => link.hops > 1))
  assert.match(stopped.notice ?? '', /stopped early \(budget\)/)
  assert.match(stopped.notice ?? '', /further out than 1 call.*no pack for this scan/)
  assert.equal(stopped.left?.further, 3, 'listen, helper and Cart#total were not followed')
})

test('when the time for scans is up, what is left is counted instead of followed', async () => {
  let clock = 0
  const { run, calls } = fakeScans([diff, second, third])
  const found = await scan(
    async (args) => {
      clock += 200_000
      return run(args)
    },
    { now: () => clock },
  )
  assert.equal(calls.length, 1)
  assert.equal(found.left?.further, 3)
  assert.ok(found.links.every((link) => link.hops === 1))
})
