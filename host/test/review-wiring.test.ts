import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '#shared/review/capture.ts'
import { lines, memoryReader, type Tree } from '#shared/review/memory.ts'
import { prepareReview } from '#shared/review/prepare.ts'
import type { Review } from '#shared/review/types.ts'
import { validateReview } from '#shared/review/validate.ts'
import type { Vicinity } from '#shared/review/vicinity.ts'

/**
 * A dependency bump, as in pi-agentic-search a5174ad..5a426e0: two packages move to 1.5.2, a schema stops using the
 * old package's helper, test helpers follow a type the new version renamed, the lockfile is written again, and the
 * README changes. Plus a helper two changed tests share, over a search that changed too, and a Ruby test named the
 * `def test_` way.
 */
const manifest = (version: string) => JSON.stringify({ name: 'search', peerDependencies: { 'pi-ai': '*' }, devDependencies: { 'pi-ai': version, 'pi-agent': version, typebox: '^1.1.24' } }, null, 2)
const unchanged: Tree = {
  'index.ts': lines('export { default } from "./src/extension.ts";'),
}
const BASE: Tree = {
  ...unchanged,
  'package.json': manifest('0.74.0'),
  'package-lock.json': lines('{', '  "packages": {', '    "node_modules/pi-ai": { "version": "0.74.0" }', '  }', '}'),
  'README.md': lines('# Search', '', 'Use Node.js 22.'),
  'src/search.ts': lines('export function search(query: string) {', '  return query', '}'),
  'app/models/cart.rb': lines('class Cart', '  def total = 1', 'end'),
  'src/extension.ts': lines(
    'import { StringEnum } from "pi-ai";',
    'import { Type } from "typebox";',
    '',
    'const SearchParams = Type.Object({',
    '  intent: StringEnum(["definition", "references"]),',
    '});',
    '',
    'export default function extension(pi) {',
    '  pi.registerTool({ parameters: SearchParams });',
    '}',
  ),
  'test/cli.test.ts': lines(
    'import type { ExtensionContext } from "pi-agent";',
    'import extension from "../index.ts";',
    '',
    'async function pi(cwd: string) {',
    '  return tool.execute({ cwd } as ExtensionContext);',
    '}',
    '',
    'test("cli matches pi", async () => {',
    '  await pi(".");',
    '});',
  ),
  'test/shared.test.ts': lines(
    'import { search } from "../src/search.ts";',
    '',
    'function lookup(query: string) {',
    '  return search(query);',
    '}',
    '',
    'test("finds the name", () => {',
    '  lookup("name");',
    '});',
    '',
    'test("finds the alias", () => {',
    '  lookup("alias");',
    '});',
  ),
  'test/cart_test.rb': lines('class CartTest', '  def test_rounds_the_total', '    assert_equal 1, total', '  end', 'end'),
}
const HEAD: Tree = {
  ...unchanged,
  'package.json': manifest('1.5.2'),
  'package-lock.json': lines('{', '  "packages": {', '    "node_modules/pi-ai": { "version": "1.5.2" }', '  }', '}'),
  'README.md': lines('# Search', '', 'Use Node.js 22.19 or newer.'),
  'src/search.ts': lines('export function search(query: string) {', '  return query.toLowerCase()', '}'),
  'app/models/cart.rb': lines('class Cart', '  def total = 1.round', 'end'),
  'src/extension.ts': lines(
    'import { Type } from "typebox";',
    '',
    'const SearchParams = Type.Object({',
    '  intent: Type.Enum(["definition", "references"], { type: "string" }),',
    '});',
    '',
    'export default function extension(pi) {',
    '  pi.registerTool({ parameters: SearchParams });',
    '}',
  ),
  'test/cli.test.ts': lines(
    'import type { ExtensionToolContext } from "pi-agent";',
    'import extension from "../index.ts";',
    '',
    'async function pi(cwd: string) {',
    '  return tool.execute({ cwd } as ExtensionToolContext);',
    '}',
    '',
    'test("cli matches pi", async () => {',
    '  await pi(".");',
    '});',
  ),
  'test/shared.test.ts': lines(
    'import { search } from "../src/search.ts";',
    '',
    'function lookup(query: string) {',
    '  return search(query.trim());',
    '}',
    '',
    'test("finds the name", () => {',
    '  lookup("the name");',
    '});',
    '',
    'test("finds the alias", () => {',
    '  lookup("the alias");',
    '});',
  ),
  'test/cart_test.rb': lines('class CartTest', '  def test_rounds_the_total', '    assert_equal 1, total.round', '  end', 'end'),
}

async function bump(vicinity?: Vicinity): Promise<Review> {
  const capture = await captureChange(memoryReader(BASE, HEAD), 'base', 'head')
  const head = (path: string) => (typeof HEAD[path] === 'string' ? (HEAD[path] as string) : null)
  return prepareReview({ id: 'change:search:bump', change: { project: 'search', item: 'bump', title: 'Bump pi', branch: 'bump' }, capture, spec: null, readHead: async (path) => head(path), ...(vicinity ? { vicinity } : {}) })
}

const LINE_COUNT = /\d+ lines? (?:added|removed)/

test('a dependency bump is wired: tests to the schema they reach and the package they changed with, the manifest to its lockfile and to the code it moved', async () => {
  const review = await bump()
  assert.deepEqual(validateReview(review), [])
  const node = (title: string) => review.nodes.find((entry) => entry.title === title)!
  const wire = (from: string, to: string) => review.edges.find((edge) => edge.from === node(from).id && edge.to === node(to).id)
  const wires = (from: string, to: string) => {
    const found = wire(from, to)
    return found && [found.kind, found.label ?? null]
  }

  // The schema is a unit of its own, and says what changed in it.
  assert.deepEqual([node('SearchParams').kind, node('SearchParams').summary], ['code', '+ intent: Type.Enum(["definition", "references"], { type: "string" }),'])
  // A test file that imports index.ts reaches what index.ts loads.
  assert.deepEqual(wires('pi', 'SearchParams'), ['exercises', 'imports it through index.ts'])
  // The helper changed because the new pi-agent renamed a type: it is tied to the bump.
  assert.deepEqual(wires('pi', 'package.json'), ['exercises', 'uses pi-agent 1.5.2'])
  // The schema stopped using pi-ai's StringEnum.
  assert.deepEqual(wires('package.json', 'SearchParams'), ['configures', 'pi-ai 0.74.0 → 1.5.2'])
  assert.deepEqual(wires('package-lock.json', 'package.json'), ['configures', 'lockfile for'])
  assert.equal(node('package.json').summary, 'Moves pi-ai from 0.74.0 to 1.5.2 and pi-agent from 0.74.0 to 1.5.2.')
  assert.equal(node('package-lock.json').summary, 'The lockfile for package.json: it pins what that file asks for.')

  // What nothing wires says why, and nothing is only a count of lines.
  assert.deepEqual(review.nodes.filter((entry) => entry.unwired).map((entry) => [entry.title, entry.unwired]), [['README.md', 'Documentation: no code in this change reads it.']])
  for (const entry of review.nodes) assert.doesNotMatch(entry.summary, LINE_COUNT, `${entry.title}: ${entry.summary}`)
})

test('a test says which test it is, what it covers and how it ran; a helper says it is one and which tests use it', async () => {
  const review = await bump()
  const node = (title: string) => review.nodes.find((entry) => entry.title === title)!

  // Its name in words, and what it covers through its helper and its import.
  assert.deepEqual([node('rounds the total').kind, node('rounds the total').summary], ['test', 'Covers total. Not run yet.'])
  assert.deepEqual([node('finds the name').status, node('finds the name').summary], ['not-run', 'Covers search. Not run yet.'])
  // A helper the two changed tests share stands on its own and names them; one no changed test calls names the tests that use it.
  assert.deepEqual(node('lookup').supports, [node('finds the name').id, node('finds the alias').id])
  assert.equal(node('lookup').summary, 'A test helper, used by 2 tests: "finds the name" and "finds the alias". Covers search. + return search(query.trim());')
  assert.deepEqual(node('pi').supports, [], 'a helper, with no test of this review that uses it')
  assert.equal(node('pi').summary, 'A test helper, used by 1 test: "cli matches pi". Covers SearchParams. + return tool.execute({ cwd } as ExtensionToolContext);')
})

test('what uses a changed schema by name is its life cycle, and the scan’s tests reach what they use', async () => {
  const review = await bump({
    links: [{ near: { changed: { path: 'src/extension.ts', line: 4 } }, other: { path: 'src/extension.ts', symbol: 'extension', startLine: 7, endLine: 9 }, direction: 'caller', hops: 1, call: { line: 8, name: 'SearchParams', reference: true }, proven: true }],
    tests: [{ changed: { path: 'src/search.ts', line: 2 }, test: { path: 'test/shared.test.ts', line: 7, symbol: 'finds the name' } }],
  })
  const node = (title: string) => review.nodes.find((entry) => entry.title === title)!
  const extension = node('extension')
  assert.deepEqual([extension.kind, extension.summary, extension.lifecycle], ['context', 'Unchanged. It uses SearchParams, which the change touched.', { role: 'caller', hops: 1 }])
  const used = review.edges.find((edge) => edge.from === node('SearchParams').id && edge.to === extension.id)
  assert.deepEqual([used?.kind, used?.label], ['called-by', 'uses it on line 8'])
  assert.ok(review.edges.some((edge) => edge.kind === 'exercises' && edge.from === node('finds the name').id && edge.to === node('search').id))
})
