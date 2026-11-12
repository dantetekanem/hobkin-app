import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { memoryReader, type Tree } from '../review/memory.ts'
import { prepareReview } from '../review/prepare.ts'
import { functionOwners, mergeTestSupport, pairTests, prepareUnits, uncoveredChanges, unitReferences, type Unit } from '../review/units.ts'

/** A change as path to [before, after]. Null means the file does not exist on that side. */
type Change = Record<string, [string | null, string | null]>

async function captured(change: Change, renames: Record<string, string> = {}) {
  const oldPathOf = Object.fromEntries(Object.entries(renames).map(([oldPath, path]) => [path, oldPath]))
  const base: Tree = {}
  const head: Tree = {}
  for (const [path, [before, after]] of Object.entries(change)) {
    if (before != null) base[oldPathOf[path] ?? path] = before
    if (after != null) head[path] = after
  }
  return captureChange(memoryReader(base, head, renames), 'base', 'head')
}

const unitsOf = async (change: Change) => prepareUnits(await captured(change))
const ranges = (unit: Unit) => unit.anchors.map(({ side, startLine, endLine }) => [side, startLine, endLine])

const source = (value: number) => `export function parse() {
  return ${value};
}
export function print() {
  return ${value};
}
`
const tests = (value: number) => `import { parse, print } from './parser';
it('parses input', () => {
  expect(parse()).toBe(${value});
});
it('prints output', () => {
  expect(print()).toBe(${value});
});
`
const parserChange: Change = {
  'src/parser.ts': [source(0), source(1)],
  'src/test/parser.test.ts': [tests(0), tests(1)],
}

// The tests below are ported from pi-coder's diff-story-units tests, with a graph where it had a list of steps.

test('extracts changed functions and individual tests, code first', async () => {
  const units = await unitsOf(parserChange)

  assert.deepEqual(
    units.map((unit) => [unit.id, unit.symbol, unit.role]),
    [
      ['u1', 'parse', 'code'],
      ['u2', 'print', 'code'],
      ['u3', 'parses input', 'test'],
      ['u4', 'prints output', 'test'],
    ],
  )
  assert.deepEqual(ranges(units[0]!), [['added', 1, 3], ['deleted', 1, 3]])
  // The import above the first test did not change, so it belongs to no unit.
  assert.deepEqual(ranges(units[2]!), [['added', 2, 4], ['deleted', 2, 4]])
})

test('splits adjacent added functions instead of treating a whole file as one unit', async () => {
  const units = await unitsOf({ 'parser.ts': [null, source(1)] })

  assert.deepEqual(units.map((unit) => unit.symbol), ['parse', 'print'])
  assert.deepEqual(units.map(ranges), [[['added', 1, 3]], [['added', 4, 6]]])
})

test('keeps a multiline signature with its body and separates nested declarations', async () => {
  const units = await unitsOf({
    'request.ts': [
      null,
      `export async function request(
  value: number,
): Promise<number> {
  function nested() {
    return value;
  }
  return nested();
}
const next = (
  value: number,
) => {
  return value;
};
`,
    ],
  })

  assert.deepEqual(units.map((unit) => unit.symbol), ['request', 'nested', 'next'])
  assert.deepEqual(ranges(units[0]!), [['added', 1, 3], ['added', 7, 8]])
  assert.deepEqual(ranges(units[2]!), [['added', 9, 13]])
})

test('a one line arrow function ends at its semicolon and does not swallow the statements after it', async () => {
  const owners = functionOwners([
    'const render = (draft) => {',
    "  const esc = what => (stoppable() ? [] : [['esc', what]]);",
    '  if (draft) return esc(draft);',
    '  return [];',
    '};',
  ])

  assert.deepEqual(owners.owners.map((owner) => owner?.split('\u001f')[0]), ['render', 'esc', 'render', 'render', 'render'])
})

test('a comment right above a declaration belongs to it, even inside another function', async () => {
  const before = ['export function createDashboard() {', '  const blank = 1;', '  const besideFace = () => {', '    return blank;', '  };', '  return besideFace;', '}', ''].join('\n')
  const after = [
    'export function createDashboard() {',
    '  const blank = 1;',
    '  // While the main agent works, the row above the input says what it is doing.',
    '  const workingRow = () => {',
    '    return blank;',
    '  };',
    '  const besideFace = () => {',
    '    return blank;',
    '  };',
    '  return besideFace;',
    '}',
    '',
  ].join('\n')
  const units = await unitsOf({ 'src/ui.mjs': [before, after] })

  // Without this, the comment would count as a change to the 2,000 line function around it.
  assert.deepEqual(units.map((unit) => [unit.symbol, ranges(unit)]), [['workingRow', [['added', 3, 6]]]])

  const owners = functionOwners(['/**', ' * Says a word.', ' */', '@memo', 'function word() {', '  return 1;', '}', '', '#count = 0;', 'next() {', '  return 2;', '}'])
  assert.deepEqual(
    Array.from(owners.owners, (owner) => owner?.split('\u001f')[0]),
    ['word', 'word', 'word', 'word', 'word', 'word', 'word', 'word', undefined, 'next', 'next', 'next'],
    'a doc comment and a decorator join the declaration, and a private field is not a comment',
  )
})

test('keeps the blank line after a test with that test', async () => {
  const units = await unitsOf({
    'test/order_test.rb': [null, "test 'first' do\n  assert first\nend\n\ntest 'second' do\n  assert second\nend\n"],
  })

  assert.deepEqual(units.map((unit) => unit.symbol), ['first', 'second'])
  assert.deepEqual(ranges(units[0]!), [['added', 1, 4]])
})

test('reads a test name whole when it holds another kind of quote', async () => {
  const units = await unitsOf({
    'test/names.test.ts': [null, `test("it's the user's turn", () => {\n  assert.ok(true);\n});\n`],
  })

  assert.deepEqual(units.map((unit) => unit.symbol), ["it's the user's turn"])
})

test('folds loose changes into the nearest declaration, and keeps a file without declarations in one unit', async () => {
  const units = await unitsOf({
    'lib/order.rb': ['class Order\n  LIMIT = 1\n\n  def total\n    1\n  end\nend\n', 'class Order\n  LIMIT = 2\n\n  def total\n    2\n  end\nend\n'],
    'config/app.yml': ['a: 1\nb: 2\nc: 3\nd: 4\ne: 5\nf: 6\ng: 7\n', 'a: 0\nb: 2\nc: 3\nd: 4\ne: 5\nf: 6\ng: 0\n'],
  })

  assert.deepEqual(
    units.map((unit) => [unit.symbol, unit.role, unit.loose]),
    [
      ['total', 'code', false],
      ['lines 1 to 7', 'file', true],
    ],
  )
  assert.deepEqual(ranges(units[0]!), [['added', 2, 2], ['deleted', 2, 2], ['added', 4, 6], ['deleted', 4, 6]])
  assert.equal(units[1]!.anchors.length, 4)
})

test('handles Ruby methods, test blocks and a method that was only deleted', async () => {
  const units = await unitsOf({
    'lib/order.rb': ['class Order\n  def total\n    1\n  end\n  def legacy\n    0\n  end\nend\n', 'class Order\n  def total\n    2\n  end\nend\n'],
    'test/order_test.rb': [null, 'require \'test_helper\'\nclass OrderTest\n  test "total" do\n    assert_equal 2, Order.new.total\n  end\nend\n'],
    'README.md': ['old\n', 'new\n'],
  })

  assert.deepEqual(ranges(units.find((unit) => unit.symbol === 'legacy')!), [['deleted', 5, 7]])
  assert.equal(units.filter((unit) => unit.symbol === 'total').length, 2)
  const pairs = pairTests(units)
  const testTotal = units.find((unit) => unit.symbol === 'total' && unit.role === 'test')!
  assert.equal(pairs.get(testTotal.id), units.find((unit) => unit.symbol === 'total' && unit.role === 'code')!.id)
})

for (const [path, before] of [
  ['src/rename.ts', 'export function oldName() {\n  return 1;\n}\n'],
  ['src/rename.test.ts', "it('oldName', () => {\n  expect(value).toBe(1);\n});\n"],
] as const) {
  test(`keeps both sides of a renamed declaration in one unit for ${path}`, async () => {
    const units = await unitsOf({ [path]: [before, before.replace('oldName', 'newName')] })

    assert.equal(units.length, 1)
    assert.equal(units[0]!.symbol, 'newName')
    assert.deepEqual(ranges(units[0]!), [['added', 1, 3], ['deleted', 1, 3]])
  })
}

test('finds references in the whole changed function, including calls away from the changed line', async () => {
  const before = `function entry() {
  helper();
  const a = 1;
  const b = 2;
  const c = 3;
  const d = 4;
  return 0;
}
function helper() {
  return 0;
}
`
  const capture = await captured({ 'entry.ts': [before, before.replaceAll('return 0', 'return 1')] })
  const units = prepareUnits(capture)

  assert.deepEqual(unitReferences(units[0]!, units, capture), [{ to: 'u2', kind: 'calls', certain: true }])
  assert.deepEqual(unitReferences(units[1]!, units, capture), [])
})

test('a reference across files is certain only when the name is imported from that file', async () => {
  const capture = await captured({
    'src/doing.mjs': [null, 'export function doingAfter(previous, event) {\n  return previous;\n}\n'],
    'src/format.mjs': [null, 'export function format(value) {\n  return String(value);\n}\n'],
    'src/runtime.mjs': [
      "import { doingAfter } from './doing.mjs';\nexport function listen(main) {\n  return main;\n}\n",
      "import { doingAfter } from './doing.mjs';\nexport function listen(main) {\n  main.doing = doingAfter(main.doing, {});\n  main.label = main.format(main.doing);\n  return main;\n}\n",
    ],
  })
  const units = prepareUnits(capture)
  const listen = units.find((unit) => unit.symbol === 'listen')!

  assert.deepEqual(unitReferences(listen, units, capture), [
    { to: units.find((unit) => unit.symbol === 'doingAfter')!.id, kind: 'calls', certain: true },
    { to: units.find((unit) => unit.symbol === 'format')!.id, kind: 'calls', certain: false },
  ])
})

// The helpers of a test file: declarations that are not test cases.
const rendering = [
  'test "shows the price in the merchant money format" do',
  '  assert_equal "$12.00", card_price_text',
  'end',
  '',
  'test "shows the price as today without a money format" do',
  '  assert_equal "12.00 USD", card_price_text',
  'end',
  '',
  'private',
  '',
  'def card_price_text',
  '  storefront.prepare_messages(products: ["shirt"]).first',
  'end',
  '',
].join('\n')
const changed = (name: string): [string, string] => [`def ${name}\n  0\nend\n`, `def ${name}\n  1\nend\n`]
const storefront: Change = {
  'lib/storefront.rb': changed('prepare_messages'),
  'lib/money_format.rb': changed('format'),
  'lib/catalog.rb': changed('products'),
  'test/storefront/rendering_test.rb': [null, rendering],
}

test('pairs tests through the helper they call, ignoring test names and key labels', async () => {
  const units = await unitsOf(storefront)

  assert.deepEqual(
    units.filter((unit) => unit.role === 'test').map((unit) => [unit.id, unit.symbol, unit.helper]),
    [
      ['u4', 'shows the price in the merchant money format', false],
      ['u5', 'shows the price as today without a money format', false],
      ['u6', 'card_price_text', true],
    ],
  )
  // "money format" in a test name and `products:` as a label are data. Only the call through the helper counts.
  assert.equal(units[2]!.symbol, 'prepare_messages')
  assert.deepEqual([...pairTests(units)], [['u4', 'u3'], ['u5', 'u3']])
})

test('a helper one changed test calls joins it; one several tests call stays and names them, and one none calls stays', async () => {
  const one = mergeTestSupport(await unitsOf({ 'test/one_test.rb': [null, 'test "a" do\n  assert fixture\nend\n\ndef fixture\n  1\nend\n'] }))
  assert.deepEqual(one.map((unit) => [unit.symbol, ranges(unit)]), [['a', [['added', 1, 7]]]], 'its lines are its test’s')

  // Both tests call card_price_text, so it is no more one's than the other's.
  const merged = mergeTestSupport(await unitsOf(storefront))
  assert.deepEqual(merged.map((unit) => unit.id), ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'])
  assert.deepEqual([merged[5]!.symbol, merged[5]!.supports, ranges(merged[5]!)], ['card_price_text', ['u4', 'u5'], [['added', 9, 13]]])
  assert.deepEqual(ranges(merged[3]!), [['added', 1, 4]])

  const alone = mergeTestSupport(await unitsOf({ 'test/support_test.rb': [null, 'def fixture\n  1\nend\n'] }))
  assert.deepEqual(alone.map((unit) => [unit.symbol, unit.role, unit.helper, unit.supports]), [['fixture', 'test', true, []]], 'with no test that calls it, the helper stays')
})

test('pairs a test by file and symbol and leaves ambiguous tests unpaired', async () => {
  // The file name decides: `update_cart_test.rb` goes with `update_cart.rb`, though the test also says `call`.
  const byFile = await unitsOf({
    'app/tools/update_cart.rb': changed('build_product'),
    'app/services/localization.rb': changed('call'),
    'test/tools/update_cart_test.rb': [null, 'def test_call_attaches_the_product\n  assert tool.call(lines: [])\nend\n'],
  })
  assert.deepEqual(
    byFile.map((unit) => [unit.symbol, unit.role, unit.helper]).at(-1),
    ['test_call_attaches_the_product', 'test', false],
    'def test_ is a test case',
  )
  assert.equal(byFile[1]!.symbol, 'build_product')
  assert.deepEqual([...pairTests(byFile)], [['u3', 'u2']])

  // The symbol decides when no file is named like the test file.
  const bySymbol = await unitsOf({
    'src/doing.mjs': [null, 'export function doingAfter(previous) {\n  return previous;\n}\nexport function toolDoing(name) {\n  return name;\n}\n'],
    'test/words.test.mjs': [null, "test('keeps the word', () => {\n  assert.equal(doingAfter('a'), 'a');\n});\n"],
  })
  assert.deepEqual([...pairTests(bySymbol)], [['u3', 'u1']])

  // A test file named after its folder and module, as hobkin names them: `cli-doing.test.mjs` for `src/cli/doing.mjs`.
  const byPrefixedName = await unitsOf({
    'src/cli/doing.mjs': [null, 'export function doingAfter(previous) {\n  return previous;\n}\n'],
    'src/cli/other.mjs': [null, 'export function unrelated() {\n  return 1;\n}\n'],
    'test/cli-doing.test.mjs': [null, "test('says a word', () => {\n  assert.ok(true);\n});\n"],
  })
  assert.deepEqual([...pairTests(byPrefixedName)], [['u3', 'u1']])

  // Two candidates with the same claim: the test names both symbols, so the host does not guess.
  const ambiguous = await unitsOf({
    'src/parser.ts': [source(0), source(1)],
    'test/behavior.test.ts': [null, "it('round trips', () => {\n  expect(print(parse())).toBe(1);\n});\n"],
  })
  assert.deepEqual([...pairTests(ambiguous)], [])

  // In the review, every changed test case is a test node, wired when paired and left alone when not.
  const review = await prepareReview({
    id: 'pairs',
    change: { project: 'demo', item: 'pairs', title: 'Pairs', branch: 'hobkin/pairs' },
    capture: await captured({
      'src/parser.ts': [source(0), source(1)],
      'src/parser.test.ts': [null, "it('parses input', () => {\n  expect(parse()).toBe(1);\n});\n"],
      'test/behavior.test.ts': [null, "it('round trips', () => {\n  expect(print(parse())).toBe(1);\n});\n"],
    }),
    spec: null,
    readHead: async () => null,
  })
  const testNodes = review.nodes.filter((node) => node.kind === 'test')
  assert.deepEqual(testNodes.map((node) => [node.title, node.status]), [['parses input', 'not-run'], ['round trips', 'not-run']])
  const exercises = review.edges.filter((edge) => edge.kind === 'exercises')
  const titleOf = (id: string) => review.nodes.find((node) => node.id === id)!.title
  assert.deepEqual(
    exercises.map((edge) => [titleOf(edge.from), titleOf(edge.to), edge.certainty]),
    [['parses input', 'parse', 'host']],
  )
})

test('covers every changed line, including loose lines', async () => {
  const capture = await captured(
    {
      // A changed constant and import outside any function, and a changed function.
      'src/limits.ts': [
        "import { a } from './a';\nconst LIMIT = 1;\n\nexport function check(value: number) {\n  return value < LIMIT;\n}\n\nexport const NAME = 'old';\n",
        "import { a, b } from './a';\nconst LIMIT = 2;\n\nexport function check(value: number) {\n  return value <= LIMIT;\n}\n\nexport const NAME = 'new';\n",
      ],
      // Only loose lines, in a code file.
      'src/constants.ts': ['export const A = 1;\nexport const B = 2;\n', 'export const A = 1;\nexport const B = 3;\nexport const C = 4;\n'],
      'config/app.yml': ['a: 1\nb: 2\n', 'a: 0\nb: 2\nc: 3\n'],
      'src/legacy.ts': ['export function legacy() {\n  return 0;\n}\n', null],
      'test/limits.test.ts': [null, "import { check } from '../src/limits';\n\nconst big = 10;\n\nfunction make() {\n  return big;\n}\n\nit('checks', () => {\n  expect(check(make())).toBe(false);\n});\n"],
      'src/windows.ts': ['export function crlf() {\r\n  return 1;\r\n}\r\n', 'export function crlf() {\r\n  return 2;\r\n}\r\n'],
      'src/newline.ts': ['export const last = 1;', 'export const last = 1;\n'],
      'src/moved.ts': ['export function keep() {\n  return 1;\n}\n', 'export function keep() {\n  return 2;\n}\n'],
    },
    { 'src/was.ts': 'src/moved.ts' },
  )
  assert.ok(capture.changes.length > 10)

  const units = prepareUnits(capture)
  assert.deepEqual(uncoveredChanges(capture.changes, units.flatMap((unit) => unit.anchors)), [])
  assert.deepEqual(uncoveredChanges(capture.changes, mergeTestSupport(units).flatMap((unit) => unit.anchors)), [], 'and still after helpers join their tests')

  const review = await prepareReview({
    id: 'coverage',
    change: { project: 'demo', item: 'coverage', title: 'Coverage', branch: 'hobkin/coverage' },
    capture,
    spec: null,
    readHead: async () => null,
  })
  assert.deepEqual(uncoveredChanges(capture.changes, review.nodes.flatMap((node) => node.anchors)), [])

  // Left out on purpose, the check names what is missing.
  const withoutFirst = units.slice(1).flatMap((unit) => unit.anchors)
  assert.ok(uncoveredChanges(capture.changes, withoutFirst).length > 0)
})

test('a summarized file keeps its changed lines covered without being split into units', async () => {
  const long = Array.from({ length: 30 }, (_, line) => `export function f${line}() {\n  return ${line};\n}`).join('\n') + '\n'
  const capture = await captureChange(memoryReader({}, { 'a.ts': 'export const a = 1;\n', 'b.ts': long }), 'base', 'head', { files: 60, changedLines: 20 })

  const units = prepareUnits(capture)
  assert.deepEqual(units.map((unit) => [unit.path, unit.role, unit.summarized]), [['a.ts', 'code', false], ['b.ts', 'file', true]])
  assert.deepEqual(ranges(units[1]!), [['added', 1, 90]])
  assert.deepEqual(uncoveredChanges(capture.changes, units.flatMap((unit) => unit.anchors)), [])
})

test('prepares 4,000 changed lines in well under a second', async () => {
  const change: Change = Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `src/part${index}.ts`,
      [null, Array.from({ length: 20 }, (_, method) => `export function part${index}_${method}() {\n  const value = ${method};\n  const result = value + 1;\n  return result;\n}\n`).join('')],
    ]),
  )
  const capture = await captured(change)
  assert.equal(capture.additions, 4000)

  const started = performance.now()
  const units = prepareUnits(capture)
  pairTests(units)
  const took = performance.now() - started

  assert.equal(units.length, 800)
  assert.deepEqual(uncoveredChanges(capture.changes, units.flatMap((unit) => unit.anchors)), [])
  assert.ok(took < 1000, `${took}ms`)
})
