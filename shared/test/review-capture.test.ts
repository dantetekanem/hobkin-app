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
