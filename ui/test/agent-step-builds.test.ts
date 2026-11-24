import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { exchangeOf, sameStep, stepsOf, type Step } from '../src/features/agent-activity/steps.ts'

/**
 * Building a step reads what each of its calls printed once, and nothing else of the steps reads it, so the reads of
 * `output` count the steps built. Each entry here is a step of its own, so one read is one step built.
 */
let reads = 0
function counted(entry: ActivityEntry): ActivityEntry {
  const { output, ...rest } = entry
  return Object.defineProperty(rest, 'output', {
    enumerable: true,
    get: () => {
      reads += 1
      return output
    },
  })
}

/** A call at `index`: a command at odd ones and another tool at even ones, so no two in a row are one step. */
function call(index: number, state: ActivityEntry['state'] = 'completed', output = `out ${index}`): ActivityEntry {
  const command = { name: 'bash', input: JSON.stringify({ command: `echo ${index}` }) }
  const otherTool = { name: 'lint', input: JSON.stringify({ file: `f${index}.ts` }) }
  return counted({
    id: `tool:${index}`,
    kind: 'tool',
    state,
    output,
    ...(index % 2 ? command : otherTool),
  })
}

/** 200 entries, each a step of its own, the newest a command still running. */
const held = Array.from({ length: 200 }, (_, index) => call(index, index === 199 ? 'running' : 'completed'))
const options = { cwd: '/repo', tasksOnLine: true }

function built(entries: readonly ActivityEntry[], ended = false): { steps: Step[]; builds: number } {
  reads = 0
  const steps = stepsOf(entries, { ...options, ended })
  return { steps, builds: reads }
}

const sameObjects = (left: readonly Step[], right: readonly Step[], count: number) => left.slice(0, count).every((step, index) => step === right[index])

test('an update to the newest of 200 entries builds that one step, and every other step is the object it was', () => {
  const first = built(held)
  assert.equal(first.steps.length, 200)
  assert.equal(first.builds, 200)

  const finished = [...held.slice(0, -1), call(199, 'completed', 'done')]
  const next = built(finished)
  assert.equal(next.builds, 1, 'only the step whose entry changed is built')
  assert.ok(sameObjects(first.steps, next.steps, 199), 'the steps whose entries did not change are the same objects')
  assert.notEqual(next.steps[199], first.steps[199])
  assert.equal(next.steps[199]?.kind === 'shell' && next.steps[199].commands[0]?.state, 'done')

  // The same entries again build nothing.
  const again = built(finished)
  assert.equal(again.builds, 0)
  assert.ok(sameObjects(next.steps, again.steps, 200))
})

test('an entry added builds only its own step, also when it joins the step before it', () => {
  const first = built(held)
  const added = built([...held, call(200)])
  assert.equal(added.builds, 1, 'a new step of its own')
  assert.equal(added.steps.length, 201)
  assert.ok(sameObjects(first.steps, added.steps, 200))

  // A command after a command joins its group: the group is built again from the one new command.
  const joined = built([...held, counted({ id: 'tool:200', kind: 'tool', name: 'bash', state: 'running', input: '{"command":"ls"}', output: '' })])
  assert.equal(joined.builds, 1)
  assert.equal(joined.steps.length, 200)
  assert.ok(sameObjects(first.steps, joined.steps, 199))
  const group = joined.steps[199]
  assert.ok(group?.kind === 'shell')
  assert.deepEqual(group.commands.map((command) => command.command), ['echo 199', 'ls'])
  assert.equal(first.steps[199]?.kind === 'shell' && first.steps[199].commands[0], group.commands[0], 'its first command is the one built before')
})

test('the run ending builds again only the steps still running, and messages between steps change nothing of the rest', () => {
  const first = built(held)
  const ended = built(held, true)
  assert.equal(ended.builds, 1, 'only the call that was running, now stopped')
  assert.ok(sameObjects(first.steps, ended.steps, 199))
  assert.equal(ended.steps[199]?.kind === 'shell' && ended.steps[199].commands[0]?.state, 'stopped')

  const seenAt = (id: string) => Number(id.slice('tool:'.length)) * 10
  reads = 0
  const exchange = exchangeOf(held, [{ id: 'n1', text: 'Keep going.', at: 1005 }], { ...options, seenAt })
  const notes = exchange.filter((item) => item.kind === 'note')
  assert.equal(notes.length, 1)
  assert.equal(reads, 1, 'the steps around the message are the ones built before, apart from the running one')
  assert.ok(sameObjects(first.steps, exchange.filter((item): item is Step => item.kind !== 'note'), 199))
})

test('edits to one file built on from the calls before them make the change built from the start', () => {
  const edit = (id: number, oldText: string, newText: string, state: ActivityEntry['state'] = 'completed'): ActivityEntry => ({ id: `tool:e${id}`, kind: 'tool', name: 'edit', state, input: JSON.stringify({ path: '/repo/a.ts', edits: [{ oldText, newText }] }) })
  const fresh = (entries: readonly ActivityEntry[], ended = false) => stepsOf(entries.map((entry) => ({ ...entry })), { ...options, ended })
  const one = edit(1, 'a = 1', 'a = 2')
  const running = [one, edit(2, 'a = 2', 'a = 3', 'running')]
  const finished = [one, edit(2, 'a = 2', 'a = 3')]
  const more = [...finished, edit(3, 'return x', 'return y'), edit(4, 'q', 'r', 'failed')]
  for (const [entries, ended] of [[running, false], [finished, false], [more, false], [running, true], [[one], false]] as const) {
    assert.deepEqual(stepsOf(entries, { ...options, ended }), fresh(entries, ended))
  }
})

test('a host that sends every entry anew still gets steps that say the same', () => {
  const first = built(held)
  const next = built(held.map((entry) => ({ ...entry })))
  assert.ok(next.steps.every((step, index) => sameStep(step, first.steps[index]!)))
})
