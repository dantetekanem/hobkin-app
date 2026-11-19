import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { prepareReview } from '../review/prepare.ts'

test('the graph draws the English locale and the code, leaves the other translations out, and still lists every file', async () => {
  const code = lines('export function greet(name: string) {', "  return t('hello', { name })", '}')
  const base: Tree = {
    'src/greet.ts': lines('export function greet(name: string) {', "  return name", '}'),
    'locales/en.json': lines('{', '  "bye": "Bye"', '}'),
    'locales/fr.json': lines('{', '  "bye": "Au revoir"', '}'),
    'locales/pt-BR/common.json': lines('{', '  "bye": "Tchau"', '}'),
    'config/locales/devise.de.yml': lines('de:', '  bye: Tschüss'),
  }
  const head: Tree = {
    'src/greet.ts': code,
    'locales/en.json': lines('{', '  "bye": "Bye",', '  "hello": "Hello, {name}"', '}'),
    'locales/fr.json': lines('{', '  "bye": "Au revoir",', '  "hello": "Bonjour, {name}"', '}'),
    'locales/pt-BR/common.json': lines('{', '  "bye": "Tchau",', '  "hello": "Olá, {name}"', '}'),
    'config/locales/devise.de.yml': lines('de:', '  bye: Tschüss', '  hello: Hallo, %{name}'),
  }
  const review = await prepareReview({
    id: 'r1',
    change: { project: 'shop', item: '#7', title: 'Greet by name', branch: 'greet' },
    capture: await captureChange(memoryReader(base, head), 'base', 'head'),
    spec: null,
    readHead: async (path) => (typeof head[path] === 'string' ? (head[path] as string) : null),
  })

  const drawn = new Set(review.nodes.flatMap((node) => node.anchors.map((anchor) => review.files.find((file) => file.id === anchor.fileId)?.path)))
  assert.deepEqual([...drawn].sort(), ['locales/en.json', 'src/greet.ts'])
  assert.deepEqual(review.files.map((file) => file.path).sort(), ['config/locales/devise.de.yml', 'locales/en.json', 'locales/fr.json', 'locales/pt-BR/common.json', 'src/greet.ts'], 'the change still lists every file')
  assert.ok(review.notices.includes('The graph draws the English locale and leaves out 3 translations of it. They are still in the change.'), review.notices.join('\n'))
})

test('a change with no translation says nothing of them', async () => {
  const review = await prepareReview({
    id: 'r1',
    change: { project: 'shop', item: '#7', title: 'Greet', branch: 'greet' },
    capture: await captureChange(memoryReader({ 'locales/en.json': lines('{}') }, { 'locales/en.json': lines('{', '  "hello": "Hello"', '}') }), 'base', 'head'),
    spec: null,
    readHead: async () => null,
  })
  assert.equal(review.notices.some((notice) => /translation/.test(notice)), false)
})
