import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { findAgenticSearch, readPack, runScan, scanAnchors } from '../src/scan.ts'

/** A trimmed pack written by agentic-search 0.7.1 for a commit of this repository, code text left out. */
const PACK: unknown = JSON.parse(readFileSync(new URL('./fixtures/scan-pack.json', import.meta.url), 'utf8'))

test('a real pack reads into anchors, nodes, edges, test groups, files and coverage', () => {
  const scan = readPack(PACK)

  assert.equal(scan.anchors.length, 7)
  const model = scan.anchors.find((anchor) => anchor.id === 'n33')
  assert.deepEqual(
    { symbol: model?.symbol, kind: model?.kind, path: model?.path, lines: [model?.startLine, model?.endLine], language: model?.language, changed: model?.changedLines.length },
    { symbol: 'homeModel', kind: 'function', path: 'ui/src/features/home/model.ts', lines: [213, 264], language: 'javascript', changed: 40 },
  )
  assert.deepEqual(model?.removed, [{ oldStart: 7, lines: ['  return {'] }])
  assert.deepEqual(model?.tests, [{ id: 'n90', symbol: 'Needs deduplicates only the exact finished branch and counts known hidden entries', path: 'ui/test/home-model.test.ts', line: 63 }])
  // Today's pack lists call sites under `callers`; the count the contract names is a newer field, so it is not made up.
  assert.equal(model?.callers, undefined)
  assert.equal(scan.anchors.find((anchor) => anchor.id === 'n18')?.tests.length, 4)

  assert.deepEqual(scan.nodes.n112, { id: 'n112', symbol: '{ openTarget }', kind: 'constant', path: 'ui/test/home-targets.test.ts', startLine: 15, endLine: 15 })
  assert.ok(scan.anchors.every((anchor) => scan.nodes[anchor.id]), 'every anchor is a node too')

  assert.equal(scan.edges.length, 9)
  assert.deepEqual(scan.edges[0], { from: 'n29', to: 'n25', name: 'problemReports', relationship: 'calls', resolution: 'exact', line: 87, via: 'checker' })
  assert.deepEqual(scan.edges.find((edge) => edge.resolution === 'unresolved'), {
    from: 'n121',
    name: 'useView.getState',
    relationship: 'calls',
    resolution: 'unresolved',
    line: 35,
    note: 'receiver useView is a local value; its type is not traced statically.',
  })

  assert.deepEqual(scan.tests, [
    {
      path: 'ui/test/home-targets.test.ts',
      entries: [
        { symbol: 'question target leaves the current sheet untouched, or navigates to Actions when absent', startLine: 55, endLine: 66 },
        { symbol: 'URL targets open only supported GitHub HTTPS pages through the existing opener', startLine: 68, endLine: 74 },
      ],
    },
  ])
  assert.equal(scan.files.length, 8)
  assert.deepEqual(scan.files[4], { path: 'ui/test/home-input.test.ts', kind: 'test', status: 'added', language: 'javascript' })
  assert.deepEqual(scan.files[7], { path: 'work-in-progress.md', kind: 'other', status: 'modified' }, 'a file the scan has no parser for says no language')
  assert.deepEqual(scan.dangling, [])
  assert.deepEqual(scan.coverage, {
    truncated: false,
    truncatedBy: 'none',
    skippedAnchors: 0,
    unresolved: 23,
    notes: [
      'TypeScript program for tsconfig.json: 7 root files, 148 source files, 199 ms.',
      'callers of row skipped: name too common to search usefully; search a qualified receiver instead.',
      'callers of age skipped: name too common to search usefully; search a qualified receiver instead.',
    ],
  })
})

test('a pack is read without trust: odd shapes are left out and counted, and a missing coverage is the worse case', () => {
  const scan = readPack({
    anchors: [
      { id: 'n1', symbol: 'ok', kind: 'function', path: 'a.ts', startLine: 1, endLine: 3, changedLines: [2, 3], tests: [{ id: 'n9' }, { id: 'n8', symbol: 't', path: 't.test.ts', line: 4 }] },
      { id: 'n2', symbol: 'no path', kind: 'function', startLine: 1, endLine: 2, changedLines: [] },
      { id: 'n3', symbol: 'backwards', kind: 'function', path: 'a.ts', startLine: 9, endLine: 2, changedLines: [] },
      { id: 'n4', symbol: 'half its lines', kind: 'function', path: 'a.ts', startLine: 5, endLine: 8, changedLines: [6, 'x'] },
      'not an anchor',
    ],
    edges: [{ from: 'n1', relationship: 'calls', resolution: 'exact' }, { to: 'n1' }],
    testGroups: [{ path: 't.test.ts', entries: [{ symbol: 'one', startLine: 1, endLine: 2 }, { symbol: 'broken' }] }, { entries: [] }],
    files: [{ path: 'a.ts', kind: 'code', status: 'modified' }, { kind: 'code' }],
  })

  assert.deepEqual(scan.anchors, [{ id: 'n1', symbol: 'ok', kind: 'function', path: 'a.ts', startLine: 1, endLine: 3, changedLines: [2, 3], tests: [{ id: 'n8', symbol: 't', path: 't.test.ts', line: 4 }] }])
  assert.deepEqual(scan.edges, [{ from: 'n1', relationship: 'calls', resolution: 'exact' }])
  assert.deepEqual(scan.tests, [{ path: 't.test.ts', entries: [{ symbol: 'one', startLine: 1, endLine: 2 }] }])
  assert.deepEqual(scan.files, [{ path: 'a.ts', kind: 'code', status: 'modified' }])
  assert.deepEqual(scan.coverage, {
    truncated: true,
    truncatedBy: 'unknown',
    skippedAnchors: 4,
    unresolved: 0,
    notes: ['The pack reported no coverage, so it may not be complete.', 'Left out for an unexpected shape: 4 anchors, 1 anchor test, 1 edge, 1 test group, 1 test entry, 1 file.'],
  })

  for (const nothing of [null, 'text', [], 42]) {
    const empty = readPack(nothing)
    assert.deepEqual([empty.anchors, empty.edges, empty.coverage.truncated], [[], [], true])
  }
})

test('newer anchor fields pass through when they have the expected shape, and a field with any odd item is dropped whole', () => {
  const anchor = {
    id: 'n1',
    symbol: 'Checkout#create',
    kind: 'method',
    path: 'app/controllers/checkout_controller.rb',
    startLine: 3,
    endLine: 9,
    changedLines: [4, 5],
    language: 'ruby',
    status: 'modified',
    whitespaceOnly: [5],
    signatureChanged: false,
    guards: [{ line: 4, guards: [{ line: 3, text: 'if Flags.on?(:fast_checkout)', branch: 'then' }] }],
    effects: [{ kind: 'write', line: 4, text: 'cart.update!(total: total)' }],
    loadTime: false,
    entry: { kind: 'controller', exact: true },
    callers: { total: 41, shown: 6, complete: false },
    tests: [],
  }
  assert.deepEqual(readPack({ anchors: [anchor] }).anchors[0], anchor)

  const odd = readPack({
    anchors: [
      {
        ...anchor,
        status: 'gone',
        whitespaceOnly: 'all',
        signatureChanged: 'yes',
        guards: [anchor.guards[0], { line: 5, guards: [{ text: 'if x' }] }],
        effects: [anchor.effects[0], { kind: 'mail', line: 4, text: 'x' }],
        loadTime: 1,
        entry: { kind: 'job' },
        callers: [{ id: 'n2' }],
      },
    ],
  })
  // A partial list would read as the whole truth (no other guard, no other effect), so the field goes as a whole.
  assert.deepEqual(odd.anchors[0], { id: 'n1', symbol: 'Checkout#create', kind: 'method', path: 'app/controllers/checkout_controller.rb', startLine: 3, endLine: 9, changedLines: [4, 5], language: 'ruby', tests: [] })
  assert.deepEqual(odd.coverage.notes.at(-1), 'Left out for an unexpected shape: 7 anchor fields.')
})

test('a removed definition is dangling only when it is not defined elsewhere and something still refers to it', () => {
  const scan = readPack({
    dangling: [
      { name: 'legacy_discount', oldPath: 'app/models/cart.rb', oldLine: 12, language: 'ruby', stillDefined: false, callers: [{ id: 'n4', symbol: 'Checkout#total', path: 'app/services/checkout.rb', line: 30, text: 'cart.legacy_discount', test: false, resolution: 'static_candidate' }] },
      { name: 'moved', oldPath: 'app/models/cart.rb', oldLine: 20, stillDefined: true, callers: [] },
      { name: 'unused', oldPath: 'app/models/cart.rb', oldLine: 40, stillDefined: false, callers: [] },
      { symbol: 'already_in_contract_shape', path: 'lib/x.rb', references: [{ path: 'lib/y.rb', line: 2, text: 'already_in_contract_shape(1)' }] },
    ],
  })
  assert.deepEqual(scan.dangling, [
    { symbol: 'legacy_discount', path: 'app/models/cart.rb', oldLine: 12, references: [{ path: 'app/services/checkout.rb', line: 30, text: 'cart.legacy_discount', resolution: 'static_candidate' }] },
    { symbol: 'already_in_contract_shape', path: 'lib/x.rb', references: [{ path: 'lib/y.rb', line: 2, text: 'already_in_contract_shape(1)' }] },
  ])
})

/** A stand-in for agentic-search: a script that records its arguments and then does what `body` says. */
function fakeProgram(t: TestContext, body: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'change-review-scan-test-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const program = join(dir, 'agentic-search')
  const argsFile = join(dir, 'args.json')
  writeFileSync(
    program,
    `#!${process.execPath}\nconst fs = require('node:fs')\nconst args = process.argv.slice(2)\nfs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args))\nconst out = args[args.indexOf('--output-dir') + 1]\n${body}\n`,
  )
  chmodSync(program, 0o755)
  return { dir, program, args: () => JSON.parse(readFileSync(argsFile, 'utf8')) as string[] }
}

test('runScan runs agentic-search on the range, reads its pack and removes the folder it wrote to', async (t) => {
  const fake = fakeProgram(t, `fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(out + '/pack.json', ${JSON.stringify(JSON.stringify(PACK))}); process.stdout.write('{"text":"","details":{}}')`)
  const answer = await runScan({ cwd: fake.dir, base: 'aaa', head: 'bbb', program: fake.program, maxAnchors: 200, maxNodes: 300, depth: 2 })

  assert.equal(answer.ok, true)
  assert.equal(answer.ok && answer.scan.anchors.length, 7)
  const args = fake.args()
  const out = args[args.indexOf('--output-dir') + 1]!
  assert.deepEqual(args.filter((arg) => arg !== out), ['scan', '--diff', 'aaa..bbb', '--cwd', fake.dir, '--json', '--output-dir', '--callers', 'all', '--tests', 'all', '--max-anchors', '200', '--max-nodes', '300', '--max-depth', '2'])
  assert.equal(existsSync(out), false, 'the pack holds source, so its folder is removed')
})

test('runScan answers why when the scan fails, writes no pack, or takes too long', async (t) => {
  const failing = fakeProgram(t, "process.stderr.write('agentic-search: not a git repository\\n'); process.exit(1)")
  assert.deepEqual(await runScan({ cwd: failing.dir, base: 'a', head: 'b', program: failing.program }), { ok: false, reason: 'not a git repository' })

  const silent = fakeProgram(t, 'process.exit(0)')
  assert.deepEqual(await runScan({ cwd: silent.dir, base: 'a', head: 'b', program: silent.program }), { ok: false, reason: 'the scan wrote no readable pack.json.' })

  const slow = fakeProgram(t, 'setInterval(() => {}, 1000)')
  const started = Date.now()
  assert.deepEqual(await runScan({ cwd: slow.dir, base: 'a', head: 'b', program: slow.program, timeoutMs: 500 }), { ok: false, reason: 'the scan took longer than 0.5 seconds.' })
  assert.ok(Date.now() - started < 5_000)

  assert.deepEqual(await runScan({ cwd: slow.dir, base: 'a', head: 'b', program: join(slow.dir, 'missing') }), { ok: false, reason: `agentic-search could not start: spawn ${join(slow.dir, 'missing')} ENOENT` })
})

test("a scan that agentic-search refuses for a newer option, by name, runs once more without it; any other refusal stops it with the tool's words", async (t) => {
  // How the released 0.7.1 refuses an option it does not know.
  const refusal = (name: string) => `agentic-search: Unknown option '${name}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "${name}"\n`
  const older = fakeProgram(
    t,
    `fs.appendFileSync(__dirname + '/calls.jsonl', JSON.stringify(args) + '\\n')\nif (args.includes('--callers')) { process.stderr.write(${JSON.stringify(refusal('--callers'))}); process.exit(2) }\nfs.mkdirSync(out, { recursive: true }); fs.writeFileSync(out + '/pack.json', ${JSON.stringify(JSON.stringify(PACK))})`,
  )
  const answer = await runScan({ cwd: older.dir, base: 'aaa', head: 'bbb', program: older.program })
  assert.equal(answer.ok, true)
  const calls = readFileSync(join(older.dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[])
  assert.deepEqual([calls.length, calls[0]!.includes('--callers'), calls[1]!.includes('--callers'), calls[1]!.filter((arg) => arg === 'all').length], [2, true, false, 1])
  assert.deepEqual(calls[1]!.slice(calls[1]!.indexOf('--tests'), calls[1]!.indexOf('--tests') + 2), ['--tests', 'all'], 'the option it took stays')

  const refusing = fakeProgram(t, "process.stderr.write('agentic-search: --max-anchors must be an integer from 1 to 100\\n'); process.exit(2)")
  assert.deepEqual(await runScan({ cwd: refusing.dir, base: 'a', head: 'b', program: refusing.program, maxAnchors: 500 }), { ok: false, reason: '--max-anchors must be an integer from 1 to 100' })
})

test('agentic-search is found on PATH first, then in the usual install folders', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'change-review-find-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const folder of ['on-path', 'pnpm']) {
    mkdirSync(join(dir, folder))
    writeFileSync(join(dir, folder, 'agentic-search'), '#!/bin/sh\n')
    chmodSync(join(dir, folder, 'agentic-search'), 0o755)
  }
  assert.equal(findAgenticSearch({ path: join(dir, 'on-path'), places: [join(dir, 'pnpm')] }), join(dir, 'on-path', 'agentic-search'))
  assert.equal(findAgenticSearch({ path: join(dir, 'nothing'), places: [join(dir, 'pnpm')] }), join(dir, 'pnpm', 'agentic-search'))
  assert.equal(findAgenticSearch({ path: '', places: [join(dir, 'nothing')] }), null)
})

test('a pack with caller counts, call sites with guards, entry and a fingerprint is read whole', () => {
  const guards = [
    { line: 4, text: 'unless Features.enabled?(:checkout)', branch: 'after-return' },
    { line: 6, text: 'if order.paid?', branch: 'then' },
  ]
  const site = { id: 'n3', symbol: 'OrdersController#create', path: 'app/controllers/orders_controller.rb', line: 6, text: 'ReceiptJob.perform_later(order.id) if order.paid?', resolution: 'exact', guards, enqueue: true, entry: { kind: 'controller', exact: true } }
  const scan = readPack({
    anchors: [
      {
        id: 'n1', symbol: 'ReceiptJob#perform', kind: 'method', path: 'app/jobs/receipt_job.rb', startLine: 2, endLine: 4, changedLines: [3],
        callerCount: { total: 1, shown: 1, complete: true }, callers: [site], entry: { kind: 'job', exact: true }, semanticFingerprint: '728053b6b252e936', tests: [],
      },
    ],
    edges: [{ from: 'n3', to: 'n1', name: 'perform', relationship: 'called_by', resolution: 'exact', via: 'constant', line: 6, note: 'enqueue', guards }],
  })
  const anchor = scan.anchors[0]!
  assert.deepEqual(anchor.callers, { total: 1, shown: 1, complete: true })
  assert.deepEqual(anchor.callSites, [site])
  assert.deepEqual(anchor.entry, { kind: 'job', exact: true })
  assert.equal(anchor.semanticFingerprint, '728053b6b252e936')
  assert.deepEqual(scan.edges[0], { from: 'n3', to: 'n1', name: 'perform', relationship: 'called_by', resolution: 'exact', line: 6, note: 'enqueue', guards, via: 'constant' })
})

test('what the pack says of where work enters is kept: the kind, its words, the routes and the doors, on anchors and nodes', () => {
  const routes = [{ verbs: ['GET'], path: '/orders/:id', file: 'config/routes.rb', line: 4, text: 'resources :orders' }]
  const doors = [{ kind: 'command', title: 'shop-report', file: 'package.json', line: 7, text: '"shop-report": "bin/report"' }]
  const scan = readPack({
    anchors: [
      { id: 'n1', symbol: 'OrdersController#show', kind: 'method', path: 'app/controllers/orders_controller.rb', startLine: 3, endLine: 9, changedLines: [4], entry: { kind: 'controller', exact: true, routes }, tests: [] },
      { id: 'n2', symbol: 'report', kind: 'statement', path: 'bin/report', startLine: 1, endLine: 1, changedLines: [1], entry: { kind: 'command', exact: true, doors }, tests: [] },
      { id: 'n3', symbol: 'reviewHandlers', kind: 'function', path: 'host/src/review/seat.ts', startLine: 371, endLine: 399, changedLines: [374], entry: { kind: 'handler', exact: true, label: 'review.prepare' }, tests: [] },
    ],
    nodes: [{ id: 'n7', symbol: 'ChargeJob#perform', kind: 'method', path: 'app/jobs/charge_job.rb', startLine: 2, endLine: 6, entry: { kind: 'job', exact: true } }],
  })
  assert.deepEqual(scan.anchors[0]!.entry, { kind: 'controller', exact: true, routes: [{ verbs: ['GET'], path: '/orders/:id', file: 'config/routes.rb', line: 4 }] })
  assert.deepEqual(scan.anchors[1]!.entry, { kind: 'command', exact: true, doors: [{ kind: 'command', title: 'shop-report', file: 'package.json', line: 7 }] })
  assert.deepEqual(scan.anchors[2]!.entry, { kind: 'handler', exact: true, label: 'review.prepare' })
  assert.deepEqual(scan.nodes.n7!.entry, { kind: 'job', exact: true })
  // A route of an odd shape is left out on its own: the entry is still an entry.
  const odd = readPack({ anchors: [{ id: 'n1', symbol: 'a', kind: 'method', path: 'a.rb', startLine: 1, endLine: 2, changedLines: [1], entry: { kind: 'controller', exact: false, routes: [{ verbs: 'GET' }] }, tests: [] }] })
  assert.deepEqual(odd.anchors[0]!.entry, { kind: 'controller', exact: false })
})

test('a real pack names the way in at each call site, a property\'s key, and the new kinds of entry with their doors and routes', () => {
  const packs = JSON.parse(readFileSync(new URL('./fixtures/entry-packs.json', import.meta.url), 'utf8')) as Record<'js' | 'rails', unknown>
  const js = readPack(packs.js)
  const prepare = js.anchors.find((anchor) => anchor.symbol === 'Reviews.prepare')!
  const handler = prepare.callSites!.find((site) => site.line === 6)!
  assert.equal(handler.key, 'review.prepare')
  assert.deepEqual(handler.entry, { kind: 'handler', exact: false, doors: [{ kind: 'handler', title: 'review.prepare', file: 'src/seat.ts', line: 6 }] })
  assert.equal(prepare.callSites!.find((site) => site.symbol === 'menu')!.key, 'prepare', 'a key with no way in is kept on the call')
  const sync = js.anchors.find((anchor) => anchor.symbol === 'sync')!
  assert.deepEqual(sync.callSites!.find((site) => site.line === 10)!.entry, { kind: 'route', exact: true, routes: [{ verbs: ['PUT', 'PATCH'], path: '/hono/sync', file: 'src/server.ts', line: 10 }] })
  assert.deepEqual(js.anchors.find((anchor) => anchor.symbol === 'refresh')!.entry?.kind, 'ui-handler')
  const rails = readPack(packs.rails)
  assert.deepEqual(rails.anchors.map((anchor) => [anchor.symbol, anchor.entry?.kind ?? null]), [['ReportMailer#daily', 'mailer'], ['ChatChannel#speak', 'channel'], ['Cleanup.prune', null], ['reports:daily', 'task']])
})

test('the test call sites of a definition are counted, not taken for its callers', () => {
  const scan = readPack({
    anchors: [
      {
        id: 'n1', symbol: 'total', kind: 'function', path: 'src/total.js', startLine: 1, endLine: 3, changedLines: [2],
        callerCount: { total: 0, shown: 0, complete: true },
        callers: [
          { id: 'n5', symbol: 'adds two numbers', path: 'test/total.test.js', line: 4, guards: [], test: true },
          { id: 'n6', symbol: 'rounds', path: 'test/total.test.js', line: 9, guards: [], test: true },
        ],
        tests: [],
      },
    ],
  })
  assert.deepEqual(scan.anchors[0]!.callSites, [])
  assert.equal(scan.anchors[0]!.testCallers, 2)
})

test('the test definitions the pack lists with every test are kept with the changed definitions each references', () => {
  const scan = readPack({
    testDefinitions: [
      { id: 'n9', symbol: 'a topic shows its posts', path: 'test/e2e/topics.test.js', startLine: 4, endLine: 6, anchors: [{ id: 'n1', lines: [5] }], changed: false, setup: [] },
      { id: 'n10', symbol: 'repeated mentions are one lookup', path: 'test/helpers/posts.test.js', startLine: 6, endLine: 10, anchors: [{ id: 'n1', lines: [8, 9] }], changed: true, setup: [] },
      { id: 'n11', symbol: 'no anchors' },
    ],
  })
  assert.deepEqual(scan.testDefinitions, [
    { id: 'n9', symbol: 'a topic shows its posts', path: 'test/e2e/topics.test.js', startLine: 4, endLine: 6, anchors: [{ id: 'n1', lines: [5] }], changed: false },
    { id: 'n10', symbol: 'repeated mentions are one lookup', path: 'test/helpers/posts.test.js', startLine: 6, endLine: 10, anchors: [{ id: 'n1', lines: [8, 9] }], changed: true },
  ])
  assert.match(scan.coverage.notes.at(-1)!, /1 test definition\b/)
  assert.equal(readPack({}).testDefinitions, undefined, 'a pack written without every test has none, which is not the same as no test')
})

test('call sites with an unexpected shape are left out whole, and an edge with odd guards keeps none of them', () => {
  const scan = readPack({
    anchors: [{ id: 'n1', symbol: 'a', kind: 'function', path: 'a.rb', startLine: 1, endLine: 2, changedLines: [1], callerCount: { total: 2, shown: 2, complete: true }, callers: [{ id: 'n2', symbol: 'b', path: 'b.rb', line: 3, guards: [] }, { id: 'n3' }], tests: [] }],
    edges: [{ from: 'n2', to: 'n1', relationship: 'called_by', resolution: 'exact', guards: [{ text: 'if x' }], via: 7 }],
  })
  assert.deepEqual(scan.anchors[0]!.callers, { total: 2, shown: 2, complete: true })
  assert.equal(scan.anchors[0]!.callSites, undefined)
  assert.deepEqual(scan.edges[0], { from: 'n2', to: 'n1', relationship: 'called_by', resolution: 'exact' })
})

test('scanAnchors scans the places it is given, one call deep, with every call site', async (t) => {
  const fake = fakeProgram(t, `fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(out + '/pack.json', ${JSON.stringify(JSON.stringify(PACK))})`)
  const answer = await scanAnchors({ cwd: fake.dir, anchors: ['app/helpers/posts_helper.rb:23', 'app/views/posts/_post.html.erb:79'], program: fake.program })
  assert.equal(answer.ok, true)
  const args = fake.args()
  const out = args[args.indexOf('--output-dir') + 1]!
  assert.deepEqual(args.filter((arg) => arg !== out), [
    'scan', '--anchor', 'app/helpers/posts_helper.rb:23', '--anchor', 'app/views/posts/_post.html.erb:79', '--cwd', fake.dir, '--json', '--output-dir', '--callers', 'all', '--max-anchors', '2', '--max-depth', '1',
  ])
  assert.equal(existsSync(out), false)
})

test('runScan asks for every call site', async (t) => {
  const fake = fakeProgram(t, "fs.mkdirSync(out, { recursive: true })\nfs.writeFileSync(out + '/pack.json', '{}')")
  await runScan({ cwd: fake.dir, base: 'a', head: 'b', program: fake.program })
  const args = fake.args()
  assert.deepEqual(args.slice(args.indexOf('--callers'), args.indexOf('--callers') + 2), ['--callers', 'all'])
})
