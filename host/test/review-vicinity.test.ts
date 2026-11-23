import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import type { VicinityLink } from '#shared/review/vicinity.ts'
import { gitReferences, scanVicinity, type ReferenceScope, type ScanRun } from '../src/review/vicinity-scan.ts'

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
  assert.deepEqual(found.left, { byName: 1, perDefinition: 1, further: 0, partial: 1, aside: 0 })

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

test('a changed constant, which no one calls, has what uses it by name as its callers, found at head; the tests that use the change come along', async () => {
  const extension = [
    'import { Type } from "typebox";',
    '',
    'const SearchParams = Type.Object({',
    '  intent: Type.Enum(["a"]),',
    '});',
    '',
    'export default function extension(pi) {',
    '  pi.registerTool({',
    '    parameters: SearchParams,',
    '  });',
    '}',
    '',
  ].join('\n')
  const head: Record<string, string> = {
    'src/extension.ts': extension,
    'src/other.ts': 'import { SearchParams } from "./extension.ts"\nexport function other() {\n  return SearchParams\n}\n',
    // The same name, never imported: another one.
    'src/unrelated.ts': 'export function unrelated() {\n  return SearchParams\n}\n',
  }
  const pack = {
    files: [{ path: 'src/extension.ts' }],
    nodes: [node('n2', 'src/extension.ts', 'SearchParams', 3, 5, { kind: 'constant', depth: 0 })],
    anchors: [
      {
        id: 'n2', symbol: 'SearchParams', kind: 'constant', path: 'src/extension.ts', startLine: 3, endLine: 5, changedLines: [4], callers: [], callerCount: { total: 0, shown: 0, complete: false },
        tests: [{ id: 't9', symbol: 'cli matches pi', path: 'test/cli.test.ts', line: 9 }],
      },
    ],
    edges: [],
    coverage: { truncatedBy: 'none' },
  }
  const asked: string[][] = []
  const run: ScanRun = async (args) => {
    asked.push([...args])
    return { ok: true, stdout: JSON.stringify({ details: pack }) }
  }
  const searched: [string, ReferenceScope][] = []
  const vicinity = await scanVicinity({
    repo: '/repo.invalid',
    base: 'b'.repeat(40),
    head: 'c'.repeat(40),
    run,
    readHead: async (path) => head[path] ?? null,
    readFolder: () => null,
    references: async (name, scope) => {
      searched.push([name, scope])
      return [{ path: 'src/extension.ts', line: 4 }, { path: 'src/extension.ts', line: 9 }, { path: 'src/other.ts', line: 3 }, { path: 'src/unrelated.ts', line: 2 }, { path: 'test/cli.test.ts', line: 9 }]
    },
  })

  assert.ok(asked[0]!.includes('--tests') && asked[0]![asked[0]!.indexOf('--tests') + 1] === 'all', 'the first scan lists every test that uses the change')
  assert.deepEqual(searched, [['SearchParams', { file: 'src/extension.ts', importers: true }]], 'its own file, and the files that may import it')
  assert.deepEqual(
    vicinity.links.map(({ other, call, proven }) => [other.path, other.symbol, other.startLine, other.endLine, call.line, call.reference, proven]),
    [
      ['src/extension.ts', 'extension', 7, 11, 9, true, true],
      ['src/other.ts', 'other', 2, 4, 3, true, false],
    ],
    'its own file, and a file that imports it; not a file that only shares the name, a test, or the constant itself',
  )
  assert.equal(vicinity.left?.partial, 0, 'found, so the scan no longer says it could not list every caller')
  assert.deepEqual(vicinity.tests, [{ changed: { path: 'src/extension.ts', line: 4 }, test: { path: 'test/cli.test.ts', symbol: 'cli matches pi', line: 9 } }])
})

test('a changed definition only tests call keeps their count beside its other callers, so the review can say only tests call it', async () => {
  const pack = {
    files: [{ path: 'src/doing.ts' }],
    nodes: [node('n1', 'src/doing.ts', 'doingAfter', 4, 8, { depth: 0 }), node('t1', 'test/doing.test.ts', 'says researching', 3, 5, { kind: 'test' }), node('t2', 'test/doing.test.ts', 'says working', 7, 9, { kind: 'test' })],
    anchors: [
      {
        id: 'n1', symbol: 'doingAfter', kind: 'function', path: 'src/doing.ts', startLine: 4, endLine: 8, changedLines: [5],
        callers: [caller('t1', 'test/doing.test.ts', 4, { test: true }), caller('t2', 'test/doing.test.ts', 8, { test: true })], callerCount: complete(0),
      },
    ],
    edges: [],
    coverage: { truncatedBy: 'none' },
  }
  const found = await scan(fakeScans([pack]).run)
  assert.deepEqual(found.links, [], 'a test is never a way in')
  assert.deepEqual(found.reach, [{ changed: { path: 'src/doing.ts', line: 5 }, symbol: 'doingAfter', hops: 0, callers: 0, testCallers: 2 }])
})

test('each test that uses the change says whether the change touched it, from the scan’s own test definitions, and one it lists only there comes too', async () => {
  const pack = {
    files: [{ path: 'src/extension.ts' }, { path: 'test/doing.test.ts' }],
    nodes: [node('n2', 'src/extension.ts', 'searchExtension', 3, 5, { depth: 0 })],
    anchors: [
      {
        id: 'n2', symbol: 'searchExtension', kind: 'function', path: 'src/extension.ts', startLine: 3, endLine: 5, changedLines: [4], callers: [], callerCount: complete(0),
        tests: [{ id: 't9', symbol: 'cli matches pi', path: 'test/cli.test.ts', line: 9, text: '' }],
      },
    ],
    testDefinitions: [
      { id: 't9', symbol: 'cli matches pi', path: 'test/cli.test.ts', startLine: 8, endLine: 12, anchors: [{ id: 'n2', lines: [9] }], changed: false, setup: [] },
      { id: 't10', symbol: 'doing says researching', path: 'test/doing.test.ts', startLine: 3, endLine: 6, anchors: [{ id: 'n2', lines: [4, 5] }], changed: true, setup: [] },
      // Another definition's test is not this one's.
      { id: 't11', symbol: 'other', path: 'test/other.test.ts', startLine: 1, endLine: 3, anchors: [{ id: 'n7', lines: [2] }], changed: false, setup: [] },
    ],
    edges: [],
    coverage: { truncatedBy: 'none' },
  }
  const found = await scan(fakeScans([pack]).run)
  assert.deepEqual(found.tests, [
    { changed: { path: 'src/extension.ts', line: 4 }, test: { path: 'test/cli.test.ts', symbol: 'cli matches pi', line: 9, changed: false } },
    { changed: { path: 'src/extension.ts', line: 4 }, test: { path: 'test/doing.test.ts', symbol: 'doing says researching', line: 4, changed: true } },
  ])
})

test('a changed Ruby constant is looked for in its own file only, since no other Ruby file imports it, and its use there is still its caller', async () => {
  const plan = ['class Plan', '  LIMITS = {', '    free: 1,', '  }.freeze', '', '  def allowed?(count)', '    count <= LIMITS[:free]', '  end', 'end', ''].join('\n')
  const pack = {
    files: [{ path: 'app/models/plan.rb' }],
    nodes: [node('c1', 'app/models/plan.rb', 'Plan::LIMITS', 2, 4, { kind: 'constant', language: 'ruby', depth: 0 })],
    anchors: [{ id: 'c1', symbol: 'Plan::LIMITS', kind: 'constant', language: 'ruby', path: 'app/models/plan.rb', startLine: 2, endLine: 4, changedLines: [3], callers: [], callerCount: { total: 0, shown: 0, complete: false } }],
    edges: [],
    coverage: { truncatedBy: 'none' },
  }
  const searched: [string, ReferenceScope][] = []
  const vicinity = await scanVicinity({
    repo: '/repo.invalid',
    base: 'b'.repeat(40),
    head: 'c'.repeat(40),
    run: async () => ({ ok: true, stdout: JSON.stringify({ details: pack }) }),
    readHead: async (path) => (path === 'app/models/plan.rb' ? plan : null),
    readFolder: () => null,
    references: async (name, scope) => {
      searched.push([name, scope])
      return [{ path: 'app/models/plan.rb', line: 2 }, { path: 'app/models/plan.rb', line: 7 }]
    },
  })

  assert.deepEqual(searched, [['LIMITS', { file: 'app/models/plan.rb', importers: false }]])
  assert.deepEqual(vicinity.links.map(({ other, call, proven }) => [other.path, other.startLine, other.endLine, call.line, call.reference, proven]), [['app/models/plan.rb', 6, 8, 7, true, true]])
})

test('git looks for a name at head in the defining file, and for code that may import it, only in the JavaScript and TypeScript of its own project', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'hobkin-references-'))
  try {
    const files: Record<string, string> = {
      'README.md': 'LIMITS, SearchParams and Loose are named here.\n',
      'app/models/plan.rb': 'class Plan\n  LIMITS = 1\n  def a = LIMITS\nend\n',
      'app/models/other.rb': 'class Other\n  def b = Plan::LIMITS\nend\n',
      'Gemfile': "source 'https://rubygems.invalid'\n",
      'loose.ts': 'export const Loose = 1\n',
      'packages/w[e]b/package.json': '{}\n',
      'packages/w[e]b/src/extension.ts': 'export const SearchParams = 1\nexport const Loose = 2\n',
      'packages/w[e]b/src/forms/use.tsx': 'import { SearchParams } from "../extension.ts"\nexport const use = SearchParams\n',
      'packages/w[e]b/src/notes.md': 'SearchParams\n',
      'packages/api/package.json': '{}\n',
      'packages/api/src/user.ts': 'import { SearchParams } from "../../w[e]b/src/extension.ts"\nexport const user = SearchParams\nimport { Loose } from "../../../loose.ts"\nexport const loose = Loose\n',
    }
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true })
      writeFileSync(join(repo, path), text)
    }
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
    git('init', '--quiet', '--initial-branch=main')
    git('add', '-A')
    git('commit', '--quiet', '-m', 'start')
    const head = git('rev-parse', 'HEAD')
    // A change in the working tree after the commit is not the commit's.
    writeFileSync(join(repo, 'packages/w[e]b/src/forms/use.tsx'), `${files['packages/w[e]b/src/forms/use.tsx']}export const again = SearchParams\n`)
    writeFileSync(join(repo, 'packages/w[e]b/src/late.ts'), 'export const late = SearchParams\n')

    const search = gitReferences(repo, head)
    const found = async (name: string, file: string, importers: boolean) => (await search(name, { file, importers })).map(({ path, line }) => `${path}:${line}`).sort()

    assert.deepEqual(await found('LIMITS', 'app/models/plan.rb', false), ['app/models/plan.rb:2', 'app/models/plan.rb:3'], 'a Ruby file: its own uses, not another Ruby file or the README')
    assert.deepEqual(await found('SearchParams', 'packages/w[e]b/src/extension.ts', true), ['packages/w[e]b/src/extension.ts:1', 'packages/w[e]b/src/forms/use.tsx:1', 'packages/w[e]b/src/forms/use.tsx:2'], 'its project, a folder named like a pattern read as itself; not the sibling project, a document, or the working tree')
    assert.deepEqual(await found('Loose', 'loose.ts', true), ['loose.ts:1', 'packages/api/src/user.ts:3', 'packages/api/src/user.ts:4', 'packages/w[e]b/src/extension.ts:2'], 'no project above it: every JavaScript and TypeScript file')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test("a side panel scan agentic-search refuses for a newer option, by name, runs once more without it; any other refusal stops it with the tool's words", async () => {
  const calls: string[][] = []
  const older: ScanRun = async (args) => {
    calls.push([...args])
    if (args.includes('--tests')) return { ok: false, reason: "Unknown option '--tests'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--tests\"" }
    return calls.length === 2 ? { ok: true, stdout: JSON.stringify({ details: diff }) } : { ok: false, reason: 'no pack for this scan' }
  }
  const found = await scan(older)
  assert.deepEqual([calls[0]!.includes('--tests'), calls[1]!.includes('--tests'), calls[1]!.includes('all')], [true, false, false])
  assert.ok(found.links.some((link) => link.other.symbol === 'listen'), 'the scan without it maps the change')

  let asked = 0
  const refused = await scan(async () => {
    asked += 1
    return { ok: false, reason: 'not a git repository' }
  })
  assert.equal(asked, 1)
  assert.match(refused.notice ?? '', /not shown: not a git repository/)
})
