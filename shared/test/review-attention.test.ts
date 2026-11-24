import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attentionOf, detailOrder, fileBuckets, pathBucket, rankAttention, type AttentionInput, type BucketFile, type RatedFacts } from '../review/attention.ts'
import type { NodeBucket } from '../review/types.ts'

const code = (rated: RatedFacts[], more: Partial<AttentionInput> = {}): AttentionInput => ({ kind: 'code', bucket: 'code', change: 'modified', size: 4, rated, ...more })
const rated = (more: Partial<RatedFacts>): RatedFacts => ({ level: 'safe', critical: false, effect: 'behaviour', proof: 'lifecycle', ...more })

/** Words a reviewer acts on never name the engine's fields or rules. */
const ENGINE_WORDS = /\b(effect|proof|exposure|undo|unverified|confidence|floor|rule|lifecycle|isolated|mocked|finding)\b|_/i

test('what the reviewer must read needs them: high, critical, a finding, a question, a failed test, a test of the change that did not run, the blind check disagreeing, an acceptance line with a warning', () => {
  const cases: [string, AttentionInput, string][] = [
    ['high', code([rated({ level: 'high', effect: 'data', proof: 'none' })]), 'Changes data it writes, and no test covers it.'],
    ['critical', code([rated({ level: 'high', critical: true, effect: 'interface', proof: 'lifecycle' })]), 'Needs a fix, not only a look.'],
    ['a break a test found', code([rated({ level: 'high', findings: [{ rule: 'breaks-test', by: 'proof' }] })]), 'Breaks a test that passes without this change.'],
    ['a reference left dangling', code([rated({ level: 'high', findings: [{ rule: 'dangling-reference', by: 'search' }] })]), 'Removes something other code still uses.'],
    ['a test that fails here', code([rated({ level: 'mid', findings: [{ rule: 'failing-test', by: 'proof' }] })]), 'A test that runs it fails with this change in place.'],
    ['an open question', code([rated({ level: 'mid', proof: 'isolated', questions: 2 })]), 'It leaves you 2 questions to answer.'],
    ['the blind check disagreeing', code([rated({ level: 'mid', proof: 'isolated', blind: { agrees: false, level: 'high' } })]), 'A second, blind reading would rate it high risk.'],
    ['a failed test', { kind: 'test', bucket: 'test', change: 'modified', size: 3, status: 'failed', rated: [] }, 'This test fails with the change in place.'],
    [
      'a test the change adds that did not run',
      { kind: 'test', bucket: 'test', change: 'added', size: 3, status: 'not-run', notRun: 'the test command could not start here (Could not find rails-8.1.3.1)', rated: [] },
      'This test of the change did not run: the test command could not start here (Could not find rails-8.1.3.1).',
    ],
    ['a test the change edits that did not run', { kind: 'test', bucket: 'test', change: 'modified', size: 3, status: 'not-run', rated: [] }, 'This test of the change did not run.'],
    ['an acceptance line with a warning', { kind: 'criterion', bucket: 'docs', change: 'unchanged', size: 0, status: 'unproven', warning: 'Its Proof line names a test that does not exist', rated: [] }, 'Its Proof line names a test that does not exist.'],
  ]
  for (const [why, input, reason] of cases) {
    const { tier, reasons } = attentionOf(input)
    assert.equal(tier, 'needs-you', why)
    assert.equal(reasons[0], reason, why)
  }
})

test('mid and what is unverified are worth a look; the rest is safe, and says why when it can', () => {
  const look: [string, AttentionInput, string][] = [
    ['a mid node no test covers', code([rated({ level: 'mid', effect: 'behaviour', proof: 'none' })]), 'No test covers it.'],
    ['direct tests only', code([rated({ level: 'mid', proof: 'isolated' })]), 'Only tests that call it directly cover it.'],
    ['tests that could not run', code([rated({ level: 'mid', proof: 'unknown' })]), 'Its tests could not run here.'],
    ['a map entry that could not be checked', code([rated({ level: 'safe', unverified: true })]), 'Its place in the map could not be checked, so read it yourself.'],
    ['an unsure rating', code([rated({ level: 'safe', confidence: 'low' })]), 'The review was unsure of its rating.'],
    ['an acceptance line nothing proves', { kind: 'criterion', bucket: 'docs', change: 'unchanged', size: 0, status: 'unproven', rated: [] }, 'Nothing proves this acceptance line yet.'],
    ['code the review did not rate', code([], { kind: 'file' }), 'The review did not rate it, so give it a look.'],
  ]
  for (const [why, input, reason] of look) {
    const { tier, reasons } = attentionOf(input)
    assert.deepEqual([tier, reasons[0]], ['worth-a-look', reason], why)
  }

  assert.deepEqual(attentionOf(code([rated({})])), { tier: 'safe', strength: 0, reasons: [] }, 'shown working through a request')
  assert.deepEqual(attentionOf(code([rated({ effect: 'text', proof: 'not-applicable' })])).reasons, ['Only comments or whitespace changed.'])
  // Not rated, a file is safe by its kind only when nobody reads it line by line: generated files, lockfiles and locale files.
  const safe: [AttentionInput['bucket'], string][] = [
    ['lockfile', 'A lockfile: the package manager writes it.'],
    ['generated', 'Generated or vendored: nobody writes it by hand.'],
    ['locale', 'Words for the app, in a locale file.'],
  ]
  for (const [bucket, reason] of safe) {
    assert.deepEqual(attentionOf(code([], { kind: 'file', bucket })), { tier: 'safe', strength: 1, reasons: [reason] }, bucket)
  }
  const unrated: [AttentionInput['bucket'], string][] = [
    ['moved', 'It looks moved, with no other change: check it arrived whole.'],
    ['format', 'It looks like only formatting changed: check nothing else did.'],
    ['docs', 'Docs or media the review did not rate.'],
    ['test', 'A test file the review did not rate.'],
  ]
  for (const [bucket, reason] of unrated) {
    const { tier, reasons } = attentionOf(code([], { kind: 'file', bucket }))
    assert.deepEqual([tier, reasons], ['worth-a-look', [reason]], bucket)
  }
  assert.equal(attentionOf({ kind: 'context', bucket: 'code', change: 'unchanged', size: 0, rated: [] }).tier, 'safe', 'context changed nothing')
  assert.equal(attentionOf({ kind: 'test', bucket: 'test', change: 'modified', size: 3, status: 'proves-change', rated: [] }).tier, 'safe')
  assert.equal(attentionOf({ kind: 'test', bucket: 'test', change: 'unchanged', size: 0, status: 'not-run', notRun: 'the proof was stopped', rated: [] }).tier, 'safe', 'a test the change did not touch asks nothing')
  assert.equal(attentionOf({ kind: 'criterion', bucket: 'docs', change: 'unchanged', size: 0, status: 'proven', rated: [] }).tier, 'safe')
})

test('a node over several definitions takes the worst of them; its reasons are the strongest three, once each, in plain words', () => {
  const { tier, reasons } = attentionOf(
    code([
      rated({ level: 'mid', proof: 'isolated' }),
      rated({ level: 'high', critical: true, effect: 'data', proof: 'none', questions: 1, sensitive: ['money', 'tax'], callers: 12, findings: [{ rule: 'breaks-test', by: 'proof' }] }),
      rated({ level: 'mid', proof: 'isolated' }),
    ]),
  )
  assert.equal(tier, 'needs-you')
  assert.deepEqual(reasons, ['Breaks a test that passes without this change.', 'Needs a fix, not only a look.', 'Changes data it writes, and no test covers it.'])

  // Everything at once still gives three reasons, none in the engine's words.
  const everything = rated({
    level: 'high',
    critical: true,
    effect: 'data',
    proof: 'unknown',
    undo: 'none',
    questions: 1,
    blind: { agrees: false },
    sensitive: ['auth'],
    callers: 9,
    unverified: true,
    confidence: 'low',
    findings: [
      { rule: 'failing-test', by: 'proof' },
      { rule: 'test-timeout', by: 'proof' },
      { rule: 'not-mapped', by: 'search' },
    ],
  })
  const all = attentionOf(code([everything]))
  assert.equal(all.reasons.length, 3)
  for (const reason of all.reasons) assert.doesNotMatch(reason, ENGINE_WORDS, reason)

  const highUndone = attentionOf(code([rated({ level: 'high', effect: 'data', proof: 'unknown', undo: 'none' })]))
  assert.match(highUndone.reasons[0]!, /^Changes data it writes, nothing undoes it, and its tests could not run here\.$/)
  const midSensitive = attentionOf(code([rated({ level: 'mid', proof: 'isolated', sensitive: ['auth', 'token'] })]))
  assert.deepEqual(midSensitive.reasons, ['Only tests that call it directly cover it.', 'Its name touches auth and token.'])
})

test('rank orders every node from 1: by tier, then by how strong its reasons are, then by how much it changes', () => {
  const ranks = rankAttention([
    { id: 'safe-big', tier: 'safe', strength: 0, size: 900 },
    { id: 'look', tier: 'worth-a-look', strength: 30, size: 2 },
    { id: 'need-small', tier: 'needs-you', strength: 60, size: 2 },
    { id: 'need-strong', tier: 'needs-you', strength: 150, size: 1 },
    { id: 'need-big', tier: 'needs-you', strength: 60, size: 40 },
    { id: 'safe-small', tier: 'safe', strength: 0, size: 1 },
  ])
  assert.deepEqual([...ranks].sort((a, b) => a[1] - b[1]).map(([id]) => id), ['need-strong', 'need-big', 'need-small', 'look', 'safe-big', 'safe-small'])
  assert.deepEqual([...ranks.values()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6])
})

test("a file's bucket is what its path says it is: a lockfile, generated or vendored, a locale, docs or media, a test, or code", () => {
  const cases: [string, string][] = [
    ['pnpm-lock.yaml', 'lockfile'],
    ['Gemfile.lock', 'lockfile'],
    ['dist/app.js', 'generated'],
    ['vendor/acme/client.rb', 'generated'],
    ['web/app.min.js', 'generated'],
    ['test/__snapshots__/cart.test.ts.snap', 'generated'],
    ['config/locales/fr.yml', 'locale'],
    ['ui/locales/pt-BR/common.json', 'locale'],
    ['README.md', 'docs'],
    ['docs/guide/setup.md', 'docs'],
    ['assets/logo.png', 'docs'],
    ['test/models/cart_test.rb', 'test'],
    ['src/cart.test.ts', 'test'],
    ['app/models/cart.rb', 'code'],
    ['config/routes.rb', 'code'],
    ['package.json', 'code'],
    ['prompts/review.md', 'code'],
  ]
  for (const [path, bucket] of cases) assert.equal(pathBucket(path), bucket, path)
})

const linesOf = (...lines: string[]) => `${lines.join('\n')}\n`
const TOTAL = ['export function total(items) {', '  const sum = items.reduce((all, item) => all + item.price, 0)', '  const tax = Math.round(sum * 0.13)', '  return sum + tax', '}']
const TAX = ['export function rate(region) {', '  const found = RATES[region]', '  if (!found) throw new Error(`no rate for ${region}`)', '  return found', '}']

test('a file is moved only when it was renamed and nothing more, or each block it removes or adds is several lines that arrive whole at the same indent elsewhere', () => {
  const buckets = fileBuckets([
    // `total` left cart.ts and arrived whole in totals.ts, and nothing else changed in either.
    { path: 'src/cart.ts', status: 'modified', additions: 0, deletions: 5, base: linesOf(...TAX, '', ...TOTAL), head: linesOf(...TAX) },
    { path: 'src/totals.ts', status: 'added', additions: 5, deletions: 0, base: null, head: linesOf(...TOTAL) },
    // Two whole functions changed places in one file.
    { path: 'src/swap.ts', status: 'modified', additions: 5, deletions: 5, base: linesOf(...TAX, '', ...TOTAL), head: linesOf(...TOTAL, '', ...TAX) },
    { path: 'src/old-name.ts', status: 'renamed', additions: 0, deletions: 0 },
    { path: 'pnpm-lock.yaml', status: 'renamed', additions: 0, deletions: 0 },
  ])
  assert.deepEqual(Object.fromEntries(buckets), { 'src/cart.ts': 'moved', 'src/totals.ts': 'moved', 'src/swap.ts': 'moved', 'src/old-name.ts': 'moved', 'pnpm-lock.yaml': 'lockfile' })

  const changes: [string, NodeBucket, BucketFile[]][] = [
    // One line that moved, counted once where it left and once where it arrived, is still one line.
    ['one moved line', 'code', [{ path: 'src/rate.ts', status: 'modified', additions: 1, deletions: 1, base: linesOf('export const rate = 0.13', 'export const cap = 10'), head: linesOf('export const cap = 10', 'export const rate = 0.13') }]],
    // The order of two calls is what the code does.
    ['two calls swapped', 'code', [{ path: 'src/save.ts', status: 'modified', additions: 1, deletions: 1, base: linesOf('export function store(x) {', '  validate(x)', '  save(x)', '}'), head: linesOf('export function store(x) {', '  save(x)', '  validate(x)', '}') }]],
    // An error check that one file drops and another gains is a change in both.
    [
      'an error check gone from one file and added to another',
      'code',
      [
        { path: 'pkg/a.go', status: 'modified', additions: 0, deletions: 3, base: 'func A() error {\n\terr := run()\n\tif err != nil {\n\t\treturn err\n\t}\n\treturn nil\n}\n', head: 'func A() error {\n\terr := run()\n\treturn nil\n}\n' },
        { path: 'pkg/b.go', status: 'modified', additions: 3, deletions: 0, base: 'func B() error {\n\terr := run()\n\treturn nil\n}\n', head: 'func B() error {\n\terr := run()\n\tif err != nil {\n\t\treturn err\n\t}\n\treturn nil\n}\n' },
      ],
    ],
    // Lines that left an `if` block for the code after it run every time now.
    [
      'lines moved out of a block',
      'code',
      [
        {
          path: 'src/run.ts',
          status: 'modified',
          additions: 4,
          deletions: 4,
          base: linesOf('export function run(ready) {', '  if (ready) {', '    start(ready)', "    log('started', ready)", '    count += ready.size', '  }', '}'),
          head: linesOf('export function run(ready) {', '  if (ready) {', '  }', '  start(ready)', "  log('started', ready)", '  count += ready.size', '}'),
        },
      ],
    ],
  ]
  for (const [why, bucket, files] of changes) {
    for (const [path, found] of fileBuckets(files)) assert.equal(found, bucket, `${why}: ${path}`)
  }
})

test('a file is format only when its tokens are the same outside strings and comments, in a language where spacing between them means nothing', () => {
  const one = (path: string, base: string, head: string) => fileBuckets([{ path, status: 'modified', additions: 1, deletions: 1, base, head }]).get(path)
  assert.equal(one('src/spaced.ts', 'export const f = (a,b) => a+b\n', 'export const f = (a, b) => a + b\n'), 'format')
  assert.equal(one('pkg/x.go', 'func f() int {\n\tx:=1\n\treturn x\n}\n', 'func f() int {\n\tx := 1\n\n\treturn x\n}\n'), 'format')
  assert.equal(one('data/rates.json', '{"on":true,"rate":0.13}\n', '{ "on": true, "rate": 0.13 }\n'), 'format')

  const code: [string, string, string, string][] = [
    ['a space inside a shell command', 'bin/clean.sh', 'rm -rf /tmp/cache\n', 'rm -rf / tmp/cache\n'],
    ['a space inside a string', 'src/clean.ts', "run('rm -rf /tmp/cache')\n", "run('rm -rf / tmp/cache')\n"],
    ['a comment that changed', 'src/note.ts', '// keep the cache\nrun()\n', '// keep the  cache\nrun()\n'],
    ['two operators that now read as one', 'src/sum.ts', 'export const s = a + +b\n', 'export const s = a ++b\n'],
    ['a line break that ends a statement', 'src/ret.ts', 'function f() {\n  return x\n}\n', 'function f() {\n  return\n  x\n}\n'],
    ['a regular expression', 'src/match.ts', 'export const r = / a /\n', 'export const r = /a/\n'],
    ['a selector', 'web/site.css', 'a:hover { color: red }\n', 'a :hover { color: red }\n'],
    ['text between tags', 'web/Page.tsx', 'export const P = () => <p><b>x</b> y</p>\n', 'export const P = () => <p><b>x</b>y</p>\n'],
    ['Python', 'tools/run.py', 'if ready:\n    start()\nstop()\n', 'if ready:\n    start()\n    stop()\n'],
    ['GDScript', 'game/player.gd', 'func _ready():\n\tstart()\nstop()\n', 'func _ready():\n\tstart()\n\tstop()\n'],
    ['Bazel', 'BUILD', 'cc_library(name = "a")\n', 'cc_library(name="a")\n'],
    ['Starlark', 'tools/defs.bzl', 'def f():\n    return 1\n', 'def f():\n  return 1\n'],
    ['Haskell', 'src/Main.hs', 'main = do\n  a\n  b\n', 'main = do\n  a\n    b\n'],
    ['Elm', 'src/Main.elm', 'main =\n  text "a"\n', 'main =\n    text "a"\n'],
    ['F#', 'src/Main.fs', 'let f x =\n    x + 1\n', 'let f x =\n  x + 1\n'],
  ]
  for (const [why, path, base, head] of code) assert.equal(one(path, base, head), 'code', why)
})

test('detail goes to code and tests first, then other files, then generated files, lockfiles, locale files and docs, each the largest change first', () => {
  const file = (path: string, size: number) => ({ path, additions: size, deletions: 0 })
  const ordered = detailOrder([
    file('README.md', 400),
    file('dist/bundle.js', 900),
    file('src/small.ts', 2),
    file('pnpm-lock.yaml', 3000),
    file('config/locales/fr.yml', 50),
    file('src/big.ts', 300),
    file('test/big.test.ts', 300),
    file('config/app.yml', 20),
    file('src/also-big.ts', 300),
  ])
  assert.deepEqual(
    ordered.map(({ path }) => path),
    ['src/also-big.ts', 'src/big.ts', 'test/big.test.ts', 'src/small.ts', 'config/app.yml', 'pnpm-lock.yaml', 'dist/bundle.js', 'README.md', 'config/locales/fr.yml'],
  )
})

test('changed code whose only covering tests the change removed is worth a look, and says so in place of no test covering it', () => {
  const untested = attentionOf(code([rated({ level: 'mid', proof: 'none' })], { testsGone: 1 }))
  assert.deepEqual([untested.tier, untested.reasons], ['worth-a-look', ['The change removed the only test that covered it.']])
  assert.deepEqual(attentionOf(code([], { testsGone: 2 })).reasons[0], 'The change removed every test that covered it.')
})

test('a test the change took assertions out of is worth a look, and says how many', () => {
  const edited: AttentionInput = { kind: 'test', bucket: 'test', change: 'modified', size: 2, status: 'passed', rated: [] }
  assert.deepEqual(attentionOf({ ...edited, assertionsRemoved: 2 }), { tier: 'worth-a-look', strength: 40, reasons: ['The change took 2 assertions out of it.'] })
  assert.deepEqual(attentionOf(edited).tier, 'safe')
})

test('unchanged context on the way in to changed code says so, and stays apart from safe code with nothing to say', () => {
  const context: AttentionInput = { kind: 'context', bucket: 'code', change: 'unchanged', size: 0, rated: [] }
  assert.deepEqual(attentionOf(context), { tier: 'safe', strength: 0, reasons: [] })
  const onTheWay = attentionOf({ ...context, wayIn: 'link_user_tags' })
  assert.deepEqual([onTheWay.tier, onTheWay.reasons], ['safe', ['On the way in to link_user_tags: a request passes here first.']])
  assert.ok(onTheWay.strength > 0, 'it ranks before safe code that says nothing')
})

test('a node that only removes lines is at least worth a look, and a test it removes says so', () => {
  const removed = (more: Partial<AttentionInput>): AttentionInput => ({ kind: 'code', bucket: 'code', change: 'deleted', size: 5, rated: [], ...more })
  assert.deepEqual(attentionOf(removed({ rated: [rated({ level: 'safe', proof: 'not-applicable' })] })).reasons, ['It only removes code: check nothing still needs it.'], 'even when rated safe')
  assert.equal(attentionOf(removed({ kind: 'test', bucket: 'test', status: 'passed' })).tier, 'worth-a-look')
  assert.equal(attentionOf(removed({ kind: 'file', bucket: 'test' })).reasons[0], 'It removes part of the tests: check that what they covered still is.')
  assert.equal(attentionOf(removed({ kind: 'file', bucket: 'generated' })).tier, 'safe', 'a generated file nobody reads')
})

test('a change where most code has no test opens with only what needs the reviewer for another reason on top, and the untested code first of what is worth a look', () => {
  const nodes = [
    ...Array.from({ length: 54 }, (_, index) => ({ id: `untested${index}`, input: code([rated({ level: 'mid', effect: 'behaviour', proof: 'none' })], { size: 10 + index }) })),
    { id: 'breaks', input: code([rated({ level: 'high', findings: [{ rule: 'breaks-test', by: 'proof' }] })]) },
    { id: 'asks', input: code([rated({ level: 'mid', effect: 'behaviour', proof: 'none', questions: 1 })]) },
    { id: 'disputed', input: code([rated({ level: 'mid', proof: 'isolated', blind: { agrees: false, level: 'high' } })]) },
    { id: 'direct', input: code([rated({ level: 'mid', proof: 'isolated', unverified: true })], { size: 900 }) },
    ...Array.from({ length: 19 }, (_, index) => ({ id: `safe${index}`, input: code([rated({})]) })),
  ]
  const weighed = nodes.map(({ id, input }) => ({ id, size: input.size, ...attentionOf(input) }))
  const weighedOf = (id: string) => weighed.find((node) => node.id === id)!
  const idsIn = (tier: string) => weighed.filter((node) => node.tier === tier).map(({ id }) => id)

  assert.deepEqual(idsIn('needs-you'), ['breaks', 'asks', 'disputed'], 'no test alone never needs the reviewer')
  assert.equal(idsIn('worth-a-look').length, 55)
  const untested = weighedOf('untested0')
  assert.deepEqual([untested.tier, untested.reasons], ['worth-a-look', ['No test covers it.']])
  assert.equal(weighedOf('asks').reasons[0], 'It leaves you a question to answer.', 'what needs the reviewer is said first')

  const ranks = rankAttention(weighed)
  const ordered = [...ranks].sort((a, b) => a[1] - b[1]).map(([id]) => id)
  assert.deepEqual(ordered.slice(0, 3).sort(), ['asks', 'breaks', 'disputed'])
  assert.ok(ordered.slice(3, 57).every((id) => id.startsWith('untested')), 'untested code ranks first of what is worth a look')
  assert.equal(ordered[57], 'direct')
})
