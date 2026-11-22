import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { prepareReview } from '../review/prepare.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'

const base: Tree = {
  'src/parser.ts': 'export function parse() {}\n',
  'src/legacy.ts': 'export const legacy = true;\n',
  'src/old-name.ts': lines('export function keep() {', '  return 1;', '}'),
  'assets/logo.png': new Uint8Array([0, 1, 2]),
  'README.md': 'same\n',
}
const head: Tree = {
  'src/parser.ts': lines('export function parse() {', '  return 1;', '}'),
  'src/parser.test.ts': lines("it('parses', () => {", '  expect(parse()).toBe(1);', '});'),
  'src/new-name.ts': lines('export function keep() {', '  return 2;', '}'),
  'assets/logo.png': new Uint8Array([0, 1, 3]),
  'README.md': 'same\n',
}
const renames = { 'src/old-name.ts': 'src/new-name.ts' }

test('captures both sides and fingerprints every byte', async () => {
  const capture = await captureChange(memoryReader(base, head, renames), 'base', 'head')

  assert.deepEqual(
    capture.files.map((file) => [file.path, file.status, file.base, file.head]),
    [
      ['assets/logo.png', 'modified', null, null],
      ['src/legacy.ts', 'deleted', 'export const legacy = true;\n', null],
      ['src/new-name.ts', 'renamed', base['src/old-name.ts'], head['src/new-name.ts']],
      ['src/parser.test.ts', 'added', null, head['src/parser.test.ts']],
      ['src/parser.ts', 'modified', base['src/parser.ts'], head['src/parser.ts']],
    ],
    'every changed file, with both sides of each text file, and nothing for the file that did not change',
  )
  assert.equal(capture.files.find((file) => file.path === 'assets/logo.png')!.binary, true)
  assert.equal(capture.files.find((file) => file.path === 'src/new-name.ts')!.oldPath, 'src/old-name.ts')
  assert.deepEqual([capture.additions, capture.deletions], [3 + 3 + 1, 1 + 1 + 1])
  assert.deepEqual(
    capture.changes.filter((change) => change.fileId === 'src/parser.ts'),
    [
      { fileId: 'src/parser.ts', side: 'deleted', startLine: 1, endLine: 1 },
      { fileId: 'src/parser.ts', side: 'added', startLine: 1, endLine: 3 },
    ],
  )

  const again = await captureChange(memoryReader(base, head, renames), 'base', 'head')
  assert.equal(again.fingerprint, capture.fingerprint, 'the same bytes give the same fingerprint')
  assert.match(capture.fingerprint, /^[0-9a-f]{64}$/)

  // One byte of any side of any text file changes the fingerprint.
  const fingerprints = new Set([capture.fingerprint])
  for (const [side, tree] of [['base', base], ['head', head]] as const) {
    for (const [path, text] of Object.entries(tree)) {
      if (typeof text !== 'string' || path === 'README.md') continue
      const flipped = { ...tree, [path]: `${text.slice(0, -1)}\t` }
      const changed = await captureChange(memoryReader(side === 'base' ? flipped : base, side === 'head' ? flipped : head, renames), 'base', 'head')
      assert.equal(fingerprints.has(changed.fingerprint), false, `${side} ${path}`)
      fingerprints.add(changed.fingerprint)
    }
  }
})

test('a file with no text on either side is named and carries no lines', async () => {
  const capture = await captureChange(memoryReader({}, { 'art.bin': new Uint8Array([0]), 'empty.txt': '' }), 'base', 'head')

  assert.deepEqual(
    capture.files.map((file) => [file.path, file.binary, file.additions]),
    [
      ['art.bin', true, 0],
      ['empty.txt', false, 0],
    ],
  )
  assert.deepEqual(capture.changes, [])
})

test('summarizes files beyond the limits', async () => {
  const changedFile = (index: number) => [`src/part${String(index).padStart(2, '0')}.ts`, `export function part${index}() {\n  return ${index};\n}\n`] as const
  const many = Object.fromEntries(Array.from({ length: 63 }, (_, index) => changedFile(index)))
  const reader = memoryReader({}, { ...many, 'notes.md': 'A note.\n' })
  const capture = await captureChange(reader, 'base', 'head')

  assert.equal(capture.files.length, 64)
  assert.deepEqual(
    capture.files.filter((file) => file.summarized).map((file) => file.path),
    ['notes.md', 'src/part60.ts', 'src/part61.ts', 'src/part62.ts'],
    'code keeps its detail before prose, and files past the sixtieth are summarized',
  )

  const review = await prepareReview({
    id: 'big',
    change: { project: 'demo', item: 'big', title: 'A big change', branch: 'hobkin/big' },
    capture,
    spec: null,
    readHead: async () => null,
  })
  const summarized = review.nodes.filter((node) => node.kind === 'file')
  assert.equal(summarized.length, 4)
  assert.ok(review.notices.some((notice) => /^4 files are summarized/.test(notice)), review.notices.join('\n'))
  assert.equal(review.files.filter((file) => file.summarized).length, 4)
  assert.equal(review.nodes.filter((node) => node.kind === 'code').length, 60)

  // The line limit works the same way: the file that would pass 4,000 changed lines is summarized.
  const long = (name: string, count: number) => Array.from({ length: count }, (_, line) => `export const ${name}${line} = ${line};`).join('\n') + '\n'
  const heavy = await captureChange(memoryReader({}, { 'a.ts': long('a', 2500), 'b.ts': long('b', 2500), 'c.ts': long('c', 1000) }), 'base', 'head')
  assert.deepEqual(heavy.files.map((file) => [file.path, file.summarized]), [['a.ts', false], ['b.ts', true], ['c.ts', false]])
  const within = await captureChange(memoryReader({}, many), 'base', 'head', { files: 100, changedLines: 4000 })
  assert.equal(within.files.some((file) => file.summarized), false, 'the limits can be set')
})

test('a change of 200 files and 10,000 lines spends its detail on the code a person must read: none on generated files, lockfiles, locale files or docs', async () => {
  const body = (name: string, count: number) => Array.from({ length: count }, (_, line) => `export const ${name}${line} = ${line};`).join('\n') + '\n'
  /** `count` files, each the path and text `file` gives for its index. */
  const many = (count: number, file: (index: number) => [string, string]) => Object.fromEntries(Array.from({ length: count }, (_, index) => file(index)))
  /** A locale code for each index: `aa` to `zz`, then `aax` and on. */
  const localeOf = (index: number) => {
    const letter = String.fromCharCode(97 + (index % 26))
    return `${letter}${letter}${index >= 26 ? 'x' : ''}`
  }
  const tree: Tree = {
    'pnpm-lock.yaml': body('lock', 1230),
    ...many(20, (index) => [`dist/chunk${index}.js`, body(`chunk${index}_`, 50)]),
    ...many(120, (index) => [`src/feature${String(index).padStart(3, '0')}.ts`, body(`feature${index}_`, 50)]),
    ...many(30, (index) => [`ui/locales/${localeOf(index)}/common.json`, body(`word${index}_`, 30)]),
    ...many(29, (index) => [`docs/guide${index}.md`, body(`guide${index}_`, 30)]),
  }
  const capture = await captureChange(memoryReader({}, tree), 'base', 'head')
  assert.deepEqual([capture.files.length, capture.additions], [200, 10_000])

  const detailed = capture.files.filter((file) => !file.summarized)
  assert.equal(detailed.length, 60)
  assert.ok(detailed.every((file) => file.path.startsWith('src/')), detailed.map((file) => file.path).join(', '))
})

test('a file the source already counted is summarized without reading it', async () => {
  const reads: string[] = []
  const reader = {
    changed: async () => [
      { path: 'src/a.ts', status: 'modified' as const },
      { path: 'vendor/huge.js', status: 'added' as const, counted: { additions: 90000, deletions: 0 } },
    ],
    read: async (commit: string, path: string) => {
      reads.push(`${commit}:${path}`)
      return { kind: 'text' as const, text: commit === 'base' ? 'export const a = 1\n' : 'export const a = 2\n' }
    },
  }
  const capture = await captureChange(reader, 'base', 'head')

  assert.deepEqual(reads.sort(), ['base:src/a.ts', 'head:src/a.ts'], 'the counted file is never read')
  const huge = capture.files.find((file) => file.path === 'vendor/huge.js')!
  assert.deepEqual([huge.summarized, huge.skipped, huge.additions, huge.deletions, huge.base, huge.head], [true, true, 90000, 0, null, null])
  assert.equal(capture.additions, 90001)
  assert.equal(capture.changes.some((change) => change.fileId === 'vendor/huge.js'), false)

  const review = await prepareReview({ id: 'counted', change: { project: 'demo', item: 'c', title: 'Counted', branch: 'b' }, capture, spec: null, readHead: async () => null })
  const node = review.nodes.find((entry) => entry.subtitle === 'vendor/huge.js')!
  assert.deepEqual([node.kind, node.stats], ['file', { additions: 90000, deletions: 0 }])
  assert.match(node.summary, /not read/i)
})
