import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attentionOf, detailOrder, fileBuckets, pathBucket, rankAttention, type AttentionInput, type RatedFacts } from '../review/attention.ts'

const code = (rated: RatedFacts[], more: Partial<AttentionInput> = {}): AttentionInput => ({ kind: 'code', bucket: 'code', change: 'modified', size: 4, rated, ...more })
const rated = (more: Partial<RatedFacts>): RatedFacts => ({ level: 'safe', critical: false, effect: 'behaviour', proof: 'lifecycle', ...more })

/** Words a reviewer acts on never name the engine's fields or rules. */
const ENGINE_WORDS = /\b(effect|proof|exposure|undo|unverified|confidence|floor|rule|lifecycle|isolated|mocked|finding)\b|_/i

test('what the reviewer must read needs them: high, critical, a finding, a question, a failed or missing test, the blind check disagreeing, an acceptance line with a warning', () => {
  const cases: [string, AttentionInput, string][] = [
    ['high', code([rated({ level: 'high', effect: 'data', proof: 'none' })]), 'Changes data it writes, and no test covers it.'],
    ['critical', code([rated({ level: 'high', critical: true, effect: 'interface', proof: 'lifecycle' })]), 'Needs a fix, not only a look.'],
    ['a break a test found', code([rated({ level: 'high', findings: [{ rule: 'breaks-test', by: 'proof' }] })]), 'Breaks a test that passes without this change.'],
    ['a reference left dangling', code([rated({ level: 'high', findings: [{ rule: 'dangling-reference', by: 'search' }] })]), 'Removes something other code still uses.'],
    ['a test that fails here', code([rated({ level: 'mid', findings: [{ rule: 'failing-test', by: 'proof' }] })]), 'A test that runs it fails with this change in place.'],
    ['an open question', code([rated({ level: 'mid', proof: 'isolated', questions: 2 })]), 'It leaves you 2 questions to answer.'],
    ['a missing test', code([rated({ level: 'mid', effect: 'behaviour', proof: 'none' })]), 'Changes what the code does, and no test covers it.'],
    ['the blind check disagreeing', code([rated({ level: 'mid', proof: 'isolated', blind: { agrees: false, level: 'high' } })]), 'A second, blind reading would rate it high risk.'],
    ['a failed test', { kind: 'test', bucket: 'test', change: 'modified', size: 3, status: 'failed', rated: [] }, 'This test fails with the change in place.'],
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
    ['direct tests only', code([rated({ level: 'mid', proof: 'isolated' })]), 'Only tests that call it directly cover it.'],
    ['tests that could not run', code([rated({ level: 'mid', proof: 'unknown' })]), 'Its tests could not run here.'],
    ['a map entry that could not be checked', code([rated({ level: 'safe', unverified: true })]), 'Its place in the map could not be checked, so read it yourself.'],
    ['an unsure rating', code([rated({ level: 'safe', confidence: 'low' })]), 'The AI review was unsure of its rating.'],
    ['a test that did not run', { kind: 'test', bucket: 'test', change: 'added', size: 3, status: 'not-run', rated: [] }, 'This test did not run.'],
    ['an acceptance line nothing proves', { kind: 'criterion', bucket: 'docs', change: 'unchanged', size: 0, status: 'unproven', rated: [] }, 'Nothing proves this acceptance line yet.'],
    ['code the AI review did not rate', code([], { kind: 'file' }), 'The AI review did not rate it, so give it a look.'],
  ]
  for (const [why, input, reason] of look) assert.deepEqual([attentionOf(input).tier, attentionOf(input).reasons[0]], ['worth-a-look', reason], why)

  assert.deepEqual(attentionOf(code([rated({})])), { tier: 'safe', strength: 0, reasons: [] }, 'shown working through a request')
  assert.deepEqual(attentionOf(code([rated({ effect: 'text', proof: 'not-applicable' })])).reasons, ['Only comments or whitespace changed.'])
  const safe: [AttentionInput['bucket'], string][] = [
    ['lockfile', 'A lockfile: the package manager writes it.'],
    ['generated', 'Generated or vendored: nobody writes it by hand.'],
    ['locale', 'Words for the app, in a locale file.'],
    ['docs', 'Docs or media: nothing in it runs.'],
    ['moved', 'Moved, with no other change.'],
    ['format', 'Only whitespace or formatting changed.'],
  ]
  for (const [bucket, reason] of safe) assert.deepEqual(attentionOf(code([], { kind: 'file', bucket })), { tier: 'safe', strength: 1, reasons: [reason] }, bucket)
  assert.equal(attentionOf({ kind: 'context', bucket: 'code', change: 'unchanged', size: 0, rated: [] }).tier, 'safe', 'context changed nothing')
  assert.equal(attentionOf({ kind: 'test', bucket: 'test', change: 'modified', size: 3, status: 'proves-change', rated: [] }).tier, 'safe')
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
  const all = attentionOf(code([rated({ level: 'high', critical: true, effect: 'data', proof: 'unknown', undo: 'none', questions: 1, blind: { agrees: false }, sensitive: ['auth'], callers: 9, unverified: true, confidence: 'low', findings: [{ rule: 'failing-test', by: 'proof' }, { rule: 'test-timeout', by: 'proof' }, { rule: 'not-mapped', by: 'search' }] })]))
  assert.equal(all.reasons.length, 3)
  for (const reason of all.reasons) assert.doesNotMatch(reason, ENGINE_WORDS, reason)
  assert.match(attentionOf(code([rated({ level: 'high', effect: 'data', proof: 'unknown', undo: 'none' })])).reasons[0]!, /^Changes data it writes, nothing undoes it, and its tests could not run here\.$/)
  assert.deepEqual(attentionOf(code([rated({ level: 'mid', proof: 'isolated', sensitive: ['auth', 'token'] })])).reasons, ['Only tests that call it directly cover it.', 'Its name touches auth and token.'])
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

test('a file whose lines only moved, or that was renamed and nothing more, is moved; one that changed only in whitespace is format', () => {
  const total = ['export function total(items) {', '  return items.reduce((sum, item) => sum + item.price, 0)', '}', '']
  const tax = ['export function tax(amount) {', '  return Math.round(amount * 0.13)', '}', '']
  const buckets = fileBuckets([
    // `total` moved from cart.ts to totals.ts, with nothing else changed in either.
    { path: 'src/cart.ts', status: 'modified', additions: 0, deletions: 3, base: [...tax, ...total].join('\n'), head: tax.join('\n') },
    { path: 'src/totals.ts', status: 'added', additions: 3, deletions: 0, base: null, head: total.join('\n') },
    // Two functions swapped places in one file.
    { path: 'src/swap.ts', status: 'modified', additions: 3, deletions: 3, base: [...tax, ...total].join('\n'), head: [...total, ...tax].join('\n') },
    { path: 'src/old-name.ts', status: 'renamed', additions: 0, deletions: 0 },
    { path: 'src/spaced.ts', status: 'modified', additions: 1, deletions: 1, base: 'export const f = (a,b) => a+b\n', head: 'export const f = (a, b) => a + b\n' },
    // In Python the indent is the block, so a line that moved into it is a change.
    { path: 'tools/run.py', status: 'modified', additions: 1, deletions: 1, base: 'if ready:\n    start()\nstop()\n', head: 'if ready:\n    start()\n    stop()\n' },
    { path: 'src/real.ts', status: 'modified', additions: 1, deletions: 1, base: 'export const rate = 0.13\n', head: 'export const rate = 0.15\n' },
    // A line that happens to match a line elsewhere is no move.
    { path: 'src/small.ts', status: 'modified', additions: 1, deletions: 0, base: 'export const a = 1\n', head: 'export const a = 1\n}\n' },
    { path: 'pnpm-lock.yaml', status: 'renamed', additions: 0, deletions: 0 },
  ])
  assert.deepEqual(Object.fromEntries(buckets), {
    'src/cart.ts': 'moved',
    'src/totals.ts': 'moved',
    'src/swap.ts': 'moved',
    'src/old-name.ts': 'moved',
    'src/spaced.ts': 'format',
    'tools/run.py': 'code',
    'src/real.ts': 'code',
    'src/small.ts': 'code',
    'pnpm-lock.yaml': 'lockfile',
  })
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
