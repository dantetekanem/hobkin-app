import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'

// The agents list is a stand-in that counts the times the keyboard is sent to it. `@/` points at ui/src.
const DOCK = `data:text/javascript,${encodeURIComponent('export const dock = { focused: 0 }; export function focusAgentsDock() { dock.focused += 1; return true }')}`
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === '@/app/AgentsDock.tsx') return { url: DOCK, shortCircuit: true }
    return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context)
  },
})
const { dock } = (await import(DOCK)) as { dock: { focused: number } }
const { focusNewestStep, walkSteps } = await import('../src/features/work/agent-keys.ts')
const { walkHere } = await import('../src/features/agent-activity/windowed-rows.ts')

/**
 * A windowed list of 100 rows of which 50 to 59 are drawn; row 30 is the thinking row, which the keyboard does not
 * stand on. Its walk draws a row before moving the keyboard onto it, as `windowed-list.tsx` does.
 */
const ROWS = 100
const THINKING = 30
const screenOf = (selector: string) => (selector === '[data-canvas-screen]' ? screen : null)
const talk = { focused: 0, focus: () => void (talk.focused += 1), closest: screenOf }
const list = { closest: screenOf }
const screen = {
  querySelector: (selector: string) => {
    if (selector === '[data-agent-exchange]') return list
    if (selector === '[data-agent-input]') return talk
    return null
  },
}
const focused: number[] = []
const drawn = new Set(Array.from({ length: 10 }, (_, index) => 50 + index))

interface Row {
  index: number
  parentElement: typeof list
  closest: (selector: string) => unknown
  querySelector: () => null
}
const rows = new Map<number, Row>()
/** A row of the list, the same element each time it is asked for: its own step, on the screen. */
function row(index: number): Row {
  const held = rows.get(index)
  if (held) return held
  const made: Row = {
    index,
    parentElement: list,
    closest: (selector) => (selector === '[data-step]' ? made : screenOf(selector)),
    querySelector: () => null,
  }
  rows.set(index, made)
  return made
}

walkHere(list as never, {
  indexOf: (element) => {
    const drawnRow = element as unknown as Row
    return drawnRow.parentElement === list ? drawnRow.index : -1
  },
  next: (from, by) => {
    for (let index = from + by; index >= 0 && index < ROWS; index += by) {
      if (index !== THINKING) return index
    }
    return -1
  },
  count: () => ROWS,
  focus: (index) => {
    drawn.add(index)
    focused.push(index)
  },
})

/** Presses `key` with the keyboard on row `at`; true when the walk took the key. */
function press(key: string, at: number): boolean {
  const event = {
    key,
    target: row(at),
    currentTarget: list,
    defaultPrevented: false,
    preventDefault: () => void (event.defaultPrevented = true),
  }
  walkSteps(event as never)
  return event.defaultPrevented
}

beforeEach(() => {
  focused.length = 0
  dock.focused = 0
  talk.focused = 0
})

test('up from the first row drawn walks onto the row above it, drawn for it, not out of the list', () => {
  assert.equal(press('ArrowUp', 50), true)
  assert.deepEqual(focused, [49])
  assert.ok(drawn.has(49))
  assert.equal(dock.focused, 0)
})

test('the keyboard steps over a row it cannot stand on', () => {
  press('ArrowUp', 31)
  assert.deepEqual(focused, [29])
})

test('home and end go to the first and the newest rows of the whole list, wherever the view is', () => {
  press('Home', 55)
  press('End', 55)
  assert.deepEqual(focused, [0, 99])
})

test('up from the first row goes to the agents list, and down from the newest to the talk box', () => {
  press('ArrowUp', 0)
  assert.equal(dock.focused, 1)
  press('ArrowDown', 99)
  assert.equal(talk.focused, 1)
  assert.deepEqual(focused, [])
})

test('up from the talk box lands on the newest row of the whole list', () => {
  assert.equal(focusNewestStep(talk as never), true)
  assert.deepEqual(focused, [99])
})
