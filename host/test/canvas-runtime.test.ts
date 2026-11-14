import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { readCanvasRuntime } from '../src/canvas-runtime/inject.ts'

interface Box {
  left: number
  top: number
  width: number
  height: number
}
interface Point {
  x: number
  y: number
}
interface Press {
  key: string
  code?: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}
interface Delta {
  x: number
  y: number
  sx: number
  sy: number
}
interface Sibling {
  tag: string
  id: string | null
}
type Step = { op: 'keep'; from: number } | { op: 'insert' }
interface Arrow {
  d: string
  head: string
  start: Point
  end: Point
  control: Point
  label: Point
}

/** The runtime's pure rules, as the served script lends them to a test. */
interface Rules {
  passesKey(press: Press): boolean
  preventsDefault(press: Press): boolean
  revisionMode(mine: { runtime: boolean }[] | null, theirs: { runtime: boolean }[] | null): 'morph' | 'load'
  planSiblings(old: Sibling[], next: Sibling[]): { steps: Step[]; remove: number[] }
  staggerDelays(count: number): number[]
  traceDuration(length: number): number
  flipDelta(before: Box, after: Box, origin?: Point | null, parent?: { delta: Delta; origin: Point } | null): Delta | null
  arrowGeometry(from: Box, to: Box, curve?: number, gap?: number): Arrow | null
  appearanceFromQuery(search: string): { theme: 'light' | 'dark' | null; still: boolean }
  colorRule(colors: unknown): string
  readMessage(data: unknown): unknown
}

/**
 * The very file the host serves, evaluated in a context with no window and no document. With `__hbCanvasTest`
 * present it only hands over its rules; a runtime that started anyway would throw here, reaching for the page.
 */
function rules(): Rules {
  const hook = {} as Rules
  runInNewContext(readCanvasRuntime().js, { __hbCanvasTest: hook }, { filename: 'runtime.js' })
  return hook
}

/** A value made inside the evaluated script, as plain data: objects from another context never compare equal by prototype. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height })

test('under test the runtime hands over its rules and starts nothing', () => {
  const hook = rules()
  const names = [
    'passesKey',
    'preventsDefault',
    'revisionMode',
    'planSiblings',
    'staggerDelays',
    'traceDuration',
    'flipDelta',
    'arrowGeometry',
    'appearanceFromQuery',
    'colorRule',
    'readMessage',
  ] as const

  for (const name of names) {
    assert.equal(typeof hook[name], 'function', name)
  }
})

test('the keys a drawing passes on', () => {
  const { passesKey, preventsDefault } = rules()
  const command = (key: string, more: Partial<Press> = {}): Press => ({ key, meta: true, ...more })
  const passed: Press[] = [
    { key: 'Escape', code: 'Escape' },
    command('s', { code: 'KeyS' }),
    command('1'),
    command('9'),
    command('k'),
    command('l'),
    command('Enter'),
    command(','),
    command('j'),
    command('y'),
    // Caps Lock makes the letter upper case, and it is the same key.
    command('S'),
    { key: 'Tab', code: 'Tab', ctrl: true },
  ]
  for (const press of passed) assert.equal(passesKey(press), true, JSON.stringify(press))

  const kept: Press[] = [
    // Nothing that ends, stops, sends or reloads.
    { key: 'x', code: 'KeyX', ctrl: true },
    command('r'),
    command('n'),
    command('w'),
    command('q'),
    // Plain keys are the drawing's own.
    { key: 's' },
    { key: 'a' },
    { key: 'Enter' },
    { key: 'Tab' },
    { key: '1' },
    // Other modifiers make another shortcut.
    command('0'),
    command('s', { shift: true }),
    command('s', { alt: true }),
    command('k', { ctrl: true }),
    command('Escape'),
    { key: 'Escape', shift: true },
    { key: 'Tab', ctrl: true, meta: true },
    { key: 'Tab', ctrl: true, shift: true },
    command('ArrowLeft'),
    command('t'),
  ]
  for (const press of kept) assert.equal(passesKey(press), false, JSON.stringify(press))

  // Command+S and Control+Tab are taken from the page once passed on; the rest keep whatever the page does with them.
  assert.equal(preventsDefault(command('s')), true)
  assert.equal(preventsDefault({ key: 'Tab', ctrl: true }), true)
  assert.equal(preventsDefault({ key: 'Escape' }), false)
  assert.equal(preventsDefault(command('k')), false)
  assert.equal(preventsDefault(command('r')), false)
})

test('in place or fresh: a script of its own on either side loads the revision fresh', () => {
  const { revisionMode } = rules()
  const runtime = { runtime: true }
  const own = { runtime: false }
  assert.equal(revisionMode([runtime], [runtime]), 'morph')
  assert.equal(revisionMode([], []), 'morph')
  assert.equal(revisionMode([runtime, own], [runtime]), 'load', 'the open drawing runs a script of its own')
  assert.equal(revisionMode([runtime], [own, runtime]), 'load', 'the revision runs a script of its own')
  assert.equal(revisionMode([runtime], null), 'load', 'the revision could not be fetched or read')
})

test('the sibling plan keeps elements by id, then by tag in order, and text in order', () => {
  const { planSiblings } = rules()
  const element = (tag: string, id: string | null = null): Sibling => ({ tag, id })
  const text: Sibling = { tag: '#text', id: null }
  const comment: Sibling = { tag: '#comment', id: null }
  const plan = (old: Sibling[], next: Sibling[]) => {
    const { steps, remove } = plain(planSiblings(old, next))
    return { kept: steps.map((step) => (step.op === 'keep' ? step.from : 'new')), remove }
  }

  // An element with an id is found wherever it went.
  assert.deepEqual(plan([element('DIV', 'a'), element('DIV', 'b')], [element('DIV', 'b'), element('DIV', 'a')]), { kept: [1, 0], remove: [] })
  // A new id enters and an id that is gone leaves, even beside an element of the same tag.
  assert.deepEqual(plan([element('DIV', 'a'), element('DIV', 'b')], [element('DIV', 'a'), element('DIV', 'c')]), { kept: [0, 'new'], remove: [1] })
  // The same id on another tag is another element.
  assert.deepEqual(plan([element('DIV', 'a')], [element('SECTION', 'a')]), { kept: ['new'], remove: [0] })
  // Without an id: the next unmatched sibling with the same tag, in order.
  assert.deepEqual(plan([element('H1'), element('P'), element('P')], [element('H1'), element('P'), element('UL'), element('P'), element('P')]), {
    kept: [0, 1, 'new', 2, 'new'],
    remove: [],
  })
  assert.deepEqual(plan([element('P'), element('DIV'), element('P')], [element('P'), element('P'), element('DIV')]), { kept: [0, 2, 1], remove: [] })
  // An element with an id is never taken by tag, and an element without one never takes an id.
  assert.deepEqual(plan([element('DIV', 'a'), element('DIV')], [element('DIV'), element('DIV')]), { kept: [1, 'new'], remove: [0] })
  assert.deepEqual(plan([element('DIV')], [element('DIV', 'a')]), { kept: ['new'], remove: [0] })
  // Text and comments match in order.
  assert.deepEqual(plan([text, element('P'), text, comment], [text, comment, element('P')]), { kept: [0, 3, 1], remove: [2] })
  assert.deepEqual(plan([], [text, element('P')]), { kept: ['new', 'new'], remove: [] })
  assert.deepEqual(plan([element('P'), text], []), { kept: [], remove: [0, 1] })
})

test('the stagger and the glide', () => {
  const { staggerDelays, traceDuration, flipDelta } = rules()

  // New parts start in order, 40 ms apart, and a crowd is squeezed so the last one still starts within 600 ms.
  assert.deepEqual(plain(staggerDelays(4)), [0, 40, 80, 120])
  assert.deepEqual(plain(staggerDelays(1)), [0])
  assert.deepEqual(plain(staggerDelays(0)), [])
  const crowd = plain(staggerDelays(200))
  assert.equal(crowd.length, 200)
  assert.equal(crowd[0], 0)
  assert.ok(crowd.at(-1)! <= 600 && crowd.at(-1)! > 500, `the last starts at ${crowd.at(-1)}`)
  assert.ok(
    crowd.every((delay, index) => index === 0 || delay >= crowd[index - 1]!),
    'in order',
  )
  // A stroke takes longer to trace the longer it is, between half a second and 700 ms.
  assert.equal(traceDuration(0), 500)
  assert.equal(traceDuration(1e6), 700)
  assert.ok(traceDuration(300) > 500 && traceDuration(300) < 700)

  // Moved: drawn back where it was, then let go.
  assert.deepEqual(plain(flipDelta(box(0, 0, 100, 50), box(40, 30, 100, 50))), { x: -40, y: -30, sx: 1, sy: 1 })
  // Resized: scaled back to its old box about its center.
  assert.deepEqual(plain(flipDelta(box(0, 0, 100, 50), box(0, 0, 200, 100))), { x: -50, y: -25, sx: 0.5, sy: 0.5 })
  // Still where it was, give or take half a pixel: nothing to do.
  assert.equal(flipDelta(box(10, 10, 100, 50), box(10.2, 9.8, 100, 50)), null)
  // An element with no box before or after has no glide.
  assert.equal(flipDelta(box(0, 0, 0, 0), box(40, 30, 100, 50)), null)

  // Inside a gliding parent, the parent's own movement is taken out.
  const moved = { delta: { x: -100, y: 0, sx: 1, sy: 1 }, origin: { x: 150, y: 25 } }
  assert.equal(flipDelta(box(10, 10, 20, 20), box(110, 10, 20, 20), null, moved), null, 'it moved with its parent')
  assert.deepEqual(plain(flipDelta(box(10, 10, 20, 20), box(10, 10, 20, 20), null, moved)), { x: 100, y: 0, sx: 1, sy: 1 }, 'it stayed while its parent moved')
  // A parent that grew is scaled down while it glides; a child that stayed is held at its size and place.
  const grew = { delta: plain(flipDelta(box(0, 0, 100, 100), box(0, 0, 200, 200)))!, origin: { x: 100, y: 100 } }
  const held = plain(flipDelta(box(10, 10, 20, 20), box(10, 10, 20, 20), null, grew))!
  assert.deepEqual(held, { x: 20, y: 20, sx: 2, sy: 2 })
  // The two together put every point of the child where it was: the parent's map after the child's is the identity.
  const parentMap = (q: number) => grew.origin.x + grew.delta.x + grew.delta.sx * (q - grew.origin.x)
  const childMap = (p: number) => 20 + held.x + held.sx * (p - 20)
  for (const p of [10, 20, 30]) assert.equal(parentMap(childMap(p)), p)
})

test("the arrow's path runs between the boxes' edges, bent by its curve, with the label at its middle", () => {
  const { arrowGeometry } = rules()
  const left = box(0, 0, 100, 50)
  const right = box(300, 0, 100, 50)

  // Side by side and straight: from the right edge of one to the left edge of the other.
  const straight = plain(arrowGeometry(left, right, 0, 0))!
  assert.deepEqual(straight.start, { x: 100, y: 25 })
  assert.deepEqual(straight.end, { x: 300, y: 25 })
  assert.deepEqual(straight.label, { x: 200, y: 25 })
  assert.equal(straight.d, 'M 100 25 Q 200 25 300 25')
  // The head's tip is the end of the line.
  assert.match(straight.head, /L 300 25 L/)

  // Bent: the control point sits off the middle by curve × length, square to the line, and the label is at the
  // middle of the curve, halfway there.
  const bent = plain(arrowGeometry(left, right, 0.2, 0))!
  assert.deepEqual(bent.control, { x: 200, y: -15 })
  assert.deepEqual(bent.label, { x: 200, y: 5 })
  assert.equal(bent.d, 'M 100 25 Q 200 -15 300 25')
  // A negative curve bends the other way, and none given bends by 0.15.
  assert.deepEqual(plain(arrowGeometry(left, right, -0.2, 0))!.control, { x: 200, y: 65 })
  assert.deepEqual(plain(arrowGeometry(left, right, undefined, 0))!.control, { x: 200, y: -5 })

  // Clipped where the center-to-center line crosses each border: the side for a wide gap, the top or bottom for a tall one.
  const diagonal = plain(arrowGeometry(box(0, 0, 100, 100), box(300, 200, 100, 100), 0, 0))!
  assert.deepEqual(diagonal.start, { x: 100, y: 83.3 })
  assert.deepEqual(diagonal.end, { x: 300, y: 216.7 })
  const below = plain(arrowGeometry(box(0, 0, 100, 50), box(20, 300, 100, 50), 0, 0))!
  assert.deepEqual(below.start, { x: 51.7, y: 50 })
  assert.deepEqual(below.end, { x: 68.3, y: 300 })

  // A gap keeps both ends off the boxes.
  const spaced = plain(arrowGeometry(left, right, 0, 6))!
  assert.deepEqual([spaced.start, spaced.end], [
    { x: 106, y: 25 },
    { x: 294, y: 25 },
  ])

  // Boxes that overlap have no room for an arrow.
  assert.equal(arrowGeometry(box(0, 0, 100, 100), box(50, 50, 100, 100), 0.15, 0), null)
  assert.equal(arrowGeometry(left, left, 0.15, 0), null)
})

test('the theme and Still come from the address, and the window colors are taken only as colors', () => {
  const { appearanceFromQuery, colorRule } = rules()
  assert.deepEqual(plain(appearanceFromQuery('?r=3&theme=dark&still=1')), { theme: 'dark', still: true })
  assert.deepEqual(plain(appearanceFromQuery('?theme=light&r=3')), { theme: 'light', still: false })
  assert.deepEqual(plain(appearanceFromQuery('?r=3')), { theme: null, still: false })
  assert.deepEqual(plain(appearanceFromQuery('')), { theme: null, still: false })
  assert.deepEqual(plain(appearanceFromQuery('?theme=blue&still=0&constructor=1')), { theme: null, still: false })

  const rule = colorRule({ paper: '#f8f4e8', ink: 'rgb(22 24 31)', muted: 'oklch(0.5 0.02 90 / 80%)', line: 'red;} body{display:none', accent: 'url(https://example.invalid/x)' })
  assert.match(rule, /--hb-paper: #f8f4e8;/)
  assert.match(rule, /--hb-ink: rgb\(22 24 31\);/)
  assert.match(rule, /--hb-muted: oklch\(0\.5 0\.02 90 \/ 80%\);/)
  assert.doesNotMatch(rule, /--hb-line|--hb-accent|display|url/)
  // A custom palette's mixed colors arrive with the window's variables already put in.
  const mixed = 'color-mix(in oklab, color-mix(in oklab, #0e0f13 45%, #f0ead6) 85%, #ffc940)'
  assert.match(colorRule({ line: mixed }), new RegExp(`--hb-line: ${mixed.replace(/[()]/g, '\\$&')};`))
  for (const refused of ['var(--hb-bg)', 'color-mix(in oklab, var(--hb-bg) 50%, red)', 'rgb(1 2 3', 'rgb(1 2 3))(', 'red /* x */', '"red"', 'red !important']) {
    assert.equal(colorRule({ paper: refused }), '', refused)
  }
  assert.equal(colorRule(null), '')
  assert.equal(colorRule({}), '')
})

test('the drawing takes only the window messages, and only as the contract has them', () => {
  const { readMessage } = rules()
  const url = 'http://127.0.0.1:4000/canvas/0123456789abcdef0123456789abcdef?r=2'
  assert.equal(readMessage(null), null)
  assert.equal(readMessage('show'), null)
  assert.equal(readMessage({ type: 'show' }), null, 'not hobkin’s')
  assert.equal(readMessage({ hobkin: 'canvas', type: 'key', key: 'Escape' }), null, 'the drawing’s own kind')
  assert.equal(readMessage({ hobkin: 'canvas', type: 'ready', version: 1 }), null, 'the drawing’s own kind')
  assert.deepEqual(plain(readMessage({ hobkin: 'canvas', type: 'show' })), { type: 'show' })
  assert.deepEqual(plain(readMessage({ hobkin: 'canvas', type: 'revision', url })), { type: 'revision', url })
  assert.equal(readMessage({ hobkin: 'canvas', type: 'revision', url: 'javascript:alert(1)' }), null)
  assert.equal(readMessage({ hobkin: 'canvas', type: 'revision' }), null)
  assert.deepEqual(plain(readMessage({ hobkin: 'canvas', type: 'appearance', theme: 'dark', still: true, colors: { paper: '#000' } })), {
    type: 'appearance',
    theme: 'dark',
    still: true,
    colors: { paper: '#000' },
  })
  assert.deepEqual(plain(readMessage({ hobkin: 'canvas', type: 'appearance', theme: 'sepia', still: 'yes', colors: 'red' })), {
    type: 'appearance',
    theme: null,
    still: null,
    colors: null,
  })
})

test('the served files hold nothing that would end the element they are served in', () => {
  const { css, js } = readCanvasRuntime()
  assert.ok(css.length > 0 && js.length > 0)
  assert.doesNotMatch(js, /<\/script/i)
  // In a script, the opening of an HTML comment changes how the parser looks for the end of the script.
  assert.doesNotMatch(js, /<!--/)
  assert.doesNotMatch(css, /<\/style/i)
})
