import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Review } from '#shared/review/types.ts'
import { focusLevels, hoverLevels } from '../src/features/review/graph/levels.ts'
import { nodeAlongWire, nodeToward } from '../src/features/review/graph/navigate.ts'
import { pressKey } from '../src/features/review/keys.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'
import { backToStep, focusNode, focusOf, goToStep, leaveFocus, offPath, startStory, stepFrom } from '../src/features/review/story/story.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const idOf = (title: string) => sample.nodes.find((node) => node.title === title)!.id
const stepOf = (title: string) => sample.story.findIndex((step) => step.title === title)
const sorted = (ids: Iterable<string>) => [...ids].sort()
const withLevel = (levels: Record<string, string>, level: string) => sorted(Object.keys(levels).filter((id) => levels[id] === level))

test('assigns focus, neighbor and background levels for a step', () => {
  const story = goToStep(sample, startStory(sample), stepOf('doingAfter: from an event to a word')).state
  const focus = focusOf(sample, story)
  const doingAfter = idOf('doingAfter')
  assert.deepEqual(focus, [doingAfter])

  const levels = focusLevels(sample, focus)

  // The focus is sharp, what is wired to it is its neighbors, and everything else is background.
  assert.deepEqual(withLevel(levels.nodes, 'focus'), [doingAfter])
  const wired = sample.edges.filter((edge) => edge.from === doingAfter || edge.to === doingAfter)
  const neighbors = sorted(new Set(wired.map((edge) => (edge.from === doingAfter ? edge.to : edge.from))))
  assert.deepEqual(withLevel(levels.nodes, 'neighbor'), neighbors)
  assert.deepEqual(neighbors, sorted(['A3', idOf('toolDoing'), idOf('streamedDoing'), idOf('connectMain'), ...sample.nodes.filter((node) => node.subtitle === 'test/cli-doing.test.mjs').map((node) => node.id)]))
  assert.equal(withLevel(levels.nodes, 'background').length, sample.nodes.length - 1 - neighbors.length)
  assert.equal(withLevel(levels.nodes, 'rest').length, 0)

  // Wires that touch the focus stay bright, and the others fade.
  assert.deepEqual(withLevel(levels.wires, 'bright'), sorted(wired.map((edge) => edge.id)))
  assert.equal(withLevel(levels.wires, 'faded').length, sample.edges.length - wired.length)

  // A step with several focus nodes: each is focus, and none is demoted to a neighbor of another.
  const promises = focusLevels(sample, ['A1', 'A2', 'A3'])
  assert.deepEqual(withLevel(promises.nodes, 'focus'), ['A1', 'A2', 'A3'])
  const helpers = focusLevels(sample, [idOf('doingAfter'), idOf('toolDoing')])
  assert.deepEqual(withLevel(helpers.nodes, 'focus'), sorted([idOf('doingAfter'), idOf('toolDoing')]))

  // The first step frames the whole graph: nothing is focused and nothing is pushed back.
  const whole = focusLevels(sample, focusOf(sample, startStory(sample)))
  assert.equal(withLevel(whole.nodes, 'rest').length, sample.nodes.length)
  assert.equal(withLevel(whole.wires, 'rest').length, sample.edges.length)
})

test('hovering a node lights its wires and neighbors and dims the rest', () => {
  const workingRow = idOf('workingRow')
  const levels = hoverLevels(sample, workingRow)
  const wired = sample.edges.filter((edge) => edge.from === workingRow || edge.to === workingRow)

  assert.deepEqual(withLevel(levels.nodes, 'lit'), sorted([workingRow, ...wired.map((edge) => (edge.from === workingRow ? edge.to : edge.from))]))
  assert.equal(withLevel(levels.nodes, 'dim').length, sample.nodes.length - wired.length - 1)
  assert.deepEqual(withLevel(levels.wires, 'lit'), sorted(wired.map((edge) => edge.id)))
  assert.equal(withLevel(levels.wires, 'dim').length, sample.edges.length - wired.length)

  const none = hoverLevels(sample, null)
  assert.equal(withLevel(none.nodes, 'none').length, sample.nodes.length)
})

test('reveals a node once', () => {
  let story = startStory(sample)
  assert.deepEqual(story.revealed, [], 'the first step frames the whole graph and draws nothing in')

  // The first walk step: its focus and the nodes wired to it draw in, and so do the wires between them.
  const first = goToStep(sample, story, 1)
  assert.deepEqual(first.fresh.nodes.slice(0, 3), ['A1', 'A2', 'A3'])
  assert.ok(first.fresh.nodes.length > 3, 'neighbors draw in with the focus')
  assert.ok(first.fresh.wires.length > 0)
  for (const wire of first.fresh.wires) {
    const edge = sample.edges.find((entry) => entry.id === wire.id)!
    assert.ok(['A1', 'A2', 'A3'].includes(edge.from), 'only wires that touch the focus')
    assert.equal(wire.from, 'source', 'drawn from the focus, the end that is on screen')
  }

  // Walk the whole story forward. Every node and every wire draws in exactly once.
  const drawn = new Map<string, number>()
  const count = (ids: string[]) => ids.forEach((id) => drawn.set(id, (drawn.get(id) ?? 0) + 1))
  story = first.state
  count([...first.fresh.nodes, ...first.fresh.wires.map((wire) => wire.id)])
  for (let index = 2; index < sample.story.length; index += 1) {
    const moved = goToStep(sample, story, index)
    count([...moved.fresh.nodes, ...moved.fresh.wires.map((wire) => wire.id)])
    story = moved.state
  }
  assert.deepEqual(sorted(drawn.keys()), sorted([...sample.nodes.map((node) => node.id), ...sample.edges.map((edge) => edge.id)]))
  assert.ok([...drawn.values()].every((times) => times === 1))

  // On later visits everything is already there.
  for (let index = sample.story.length - 1; index >= 0; index -= 1) {
    const back = goToStep(sample, story, index)
    assert.deepEqual(back.fresh, { nodes: [], wires: [] }, sample.story[index]!.title)
    story = back.state
  }
})

test('a wire draws from the end that was already on screen', () => {
  // Jump straight to the context step: searchingTool and toolDoing are both new, and so is the wire between them.
  const context = idOf('searchingTool')
  const jumped = goToStep(sample, startStory(sample), sample.story.findIndex((step) => step.focus.includes(context)))
  assert.deepEqual(jumped.fresh.wires, [{ id: `calls:${idOf('toolDoing')}>${context}`, from: 'target' }], 'with neither end seen before, it grows out of the focus')
  assert.deepEqual(jumped.fresh.nodes, [context, idOf('toolDoing')])

  // See the row first. That shows project as a neighbor. Then go to A4, which is wired to project.
  const row = goToStep(sample, startStory(sample), stepOf('The row')).state
  assert.ok(row.revealed.includes(idOf('project')))
  const promise = goToStep(sample, row, stepOf('The promise that the word gets out'))
  const from = (id: string) => promise.fresh.wires.find((wire) => wire.id === id)?.from
  assert.equal(from(`implements:A4>${idOf('project')}`), 'target', 'project was on screen, so the wire grows from project toward A4')
  assert.equal(from(`implements:A4>${idOf('connectMain')}`), 'source', 'connectMain was not, so that wire grows out of A4')
})

test('remembers the step when focus leaves the path', () => {
  const at = stepOf('doingAfter: from an event to a word')
  const story = goToStep(sample, startStory(sample), at).state
  const changelog = idOf('CHANGELOG.md')
  assert.equal(offPath(sample, story), false)

  // Clicking a node that is not in the current step focuses it, and the step is kept.
  const detour = focusNode(sample, story, changelog).state
  assert.deepEqual(focusOf(sample, detour), [changelog])
  assert.deepEqual([detour.step, detour.detour, offPath(sample, detour)], [at, changelog, true])
  assert.deepEqual(detour.seen, story.seen, 'a detour is not a step, so nothing new is marked seen')

  // "Back to step N" returns to that step.
  const back = backToStep(sample, detour).state
  assert.deepEqual([back.step, back.detour, offPath(sample, back)], [at, null, false])
  assert.deepEqual(focusOf(sample, back), sample.story[at]!.focus)

  // Clicking a node of the current step is not a detour.
  assert.equal(focusNode(sample, story, sample.story[at]!.focus[0]!).state.detour, null)

  // Leaving focus for the whole graph is off the path too, and comes back the same way.
  const whole = leaveFocus(sample, story)
  assert.deepEqual([focusOf(sample, whole), offPath(sample, whole), whole.step], [[], true, at])
  assert.equal(backToStep(sample, whole).state.whole, false)

  // From off the path, Left returns to the step and Right moves on to the next.
  assert.equal(stepFrom(sample, detour, -1), at)
  assert.equal(stepFrom(sample, detour, 1), at + 1)
  assert.equal(stepFrom(sample, story, -1), at - 1)
  assert.equal(stepFrom(sample, story, 1), at + 1)
  // The ends of the story hold.
  assert.equal(stepFrom(sample, startStory(sample), -1), 0)
  const last = goToStep(sample, story, sample.story.length - 1).state
  assert.equal(stepFrom(sample, last, 1), sample.story.length - 1)
})

test('the arrows walk the graph: up and down a column, left and right across columns', () => {
  const column = (x: number) => sample.nodes.filter((node) => node.position.x === x).sort((a, b) => a.position.y - b.position.y)
  const spec = column(0)

  // With nothing focused the walk starts at the top left.
  assert.equal(nodeToward(sample.nodes, null, 'down'), spec[0]!.id)
  // Down and up move along the column, and stop at its ends.
  assert.equal(nodeToward(sample.nodes, spec[0]!.id, 'down'), spec[1]!.id)
  assert.equal(nodeToward(sample.nodes, spec[1]!.id, 'up'), spec[0]!.id)
  assert.equal(nodeToward(sample.nodes, spec[0]!.id, 'up'), null)
  assert.equal(nodeToward(sample.nodes, spec.at(-1)!.id, 'down'), null)
  // Right crosses to the next column, to the node nearest in height. Left comes back.
  const right = nodeToward(sample.nodes, spec[0]!.id, 'right')!
  assert.equal(sample.nodes.find((node) => node.id === right)!.kind, 'test')
  assert.equal(sample.nodes.find((node) => node.id === nodeToward(sample.nodes, right, 'left'))!.kind, 'criterion')
  assert.equal(nodeToward(sample.nodes, spec[0]!.id, 'left'), null)

  // Every node can be reached from the first by some walk.
  const reached = new Set<string>([spec[0]!.id])
  for (let grew = true; grew; ) {
    grew = false
    for (const id of [...reached]) {
      for (const direction of ['up', 'down', 'left', 'right'] as const) {
        const next = nodeToward(sample.nodes, id, direction)
        if (next && !reached.has(next)) grew = reached.add(next).size > 0
      }
    }
  }
  assert.equal(reached.size, sample.nodes.length)
})

test('Shift with the arrows follows a wire to the node it connects to', () => {
  const [doingAfter, toolDoing, streamedDoing, connectMain] = [idOf('doingAfter'), idOf('toolDoing'), idOf('streamedDoing'), idOf('connectMain')]

  // To the right, along a wire that leaves this node: of doingAfter's two, the one nearest in height.
  const right = nodeAlongWire(sample.nodes, sample.edges, doingAfter, 'right')
  assert.ok(right === toolDoing || right === streamedDoing)
  const middle = (id: string) => sample.nodes.find((node) => node.id === id)!.position.y
  const other = right === toolDoing ? streamedDoing : toolDoing
  assert.ok(Math.abs(middle(right!) - middle(doingAfter)) <= Math.abs(middle(other) - middle(doingAfter)))
  // To the left, along a wire that arrives: the tests and the runtime call doingAfter. The nearest in height wins.
  const left = nodeAlongWire(sample.nodes, sample.edges, doingAfter, 'left')!
  assert.ok(sample.edges.some((edge) => edge.from === left && edge.to === doingAfter))
  // A wire from the acceptance line leads to the test that proves it.
  assert.equal(nodeAlongWire(sample.nodes, sample.edges, 'A1', 'right'), idOf('what the model streams says whether it is thinking or writing its reply'))
  // Nothing arrives at an acceptance line, and nothing leaves context.
  assert.equal(nodeAlongWire(sample.nodes, sample.edges, 'A1', 'left'), null)
  assert.equal(nodeAlongWire(sample.nodes, sample.edges, idOf('searchingTool'), 'right'), null)
  assert.equal(nodeAlongWire(sample.nodes, sample.edges, connectMain, 'right'), doingAfter)
})

function keyboard() {
  const memory = createReviewMemory(memoryStorage())
  const session = createSession(sample, memory)
  const press = (key: string, shift = false) => pressKey(session.getState(), { key, shift, alt: false }, { panelKey: () => false, toggleSteps: () => {}, talk: () => {}, verdict: () => {} })
  return { session, press }
}

test('digits jump to a step, G shows the whole graph, and history goes back and forward', () => {
  const { session, press } = keyboard()
  // Fifteen steps: 1 could still become 10 to 15, so it waits and shows what was typed.
  assert.equal(press('1'), true)
  assert.deepEqual([session.getState().pendingDigits, session.getState().story.step], ['1', 0])
  // 5 makes 15, which cannot grow, so it is taken at once: one camera movement, not a walk through every step.
  assert.equal(press('5'), true)
  assert.deepEqual([session.getState().pendingDigits, session.getState().story.step, session.getState().move.kind], ['', 14, 'jump'])
  // 2 cannot grow into another step, so it is taken at once.
  assert.equal(press('2'), true)
  assert.equal(session.getState().story.step, 1)
  assert.equal(press('g'), true)
  assert.deepEqual(session.getState().focus, [])

  // Jump around, then walk the history back and forward. CHANGELOG.md is not part of the row's step.
  session.getState().goTo(stepOf('The row'))
  session.getState().focusOn(idOf('CHANGELOG.md'))
  assert.equal(press(','), true)
  assert.equal(session.getState().story.detour, null)
  assert.equal(session.getState().story.step, stepOf('The row'))
  assert.equal(press('.'), true)
  assert.equal(session.getState().story.detour, idOf('CHANGELOG.md'))
  // Walking the story one step at a time is not history: Left and Right already do that.
  session.getState().step(1)
  assert.equal(press(','), true)
  assert.equal(session.getState().story.detour, null)
  assert.equal(session.getState().story.step, stepOf('The row'))
})
