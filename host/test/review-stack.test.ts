import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { stackHandlers, stackPrompt, type StackFacts, type StackSeat } from '../src/review/stack.ts'

const OWN: StackFacts = { title: 'Add billing', repository: 'shop', folder: '/work/shop', merged: false, start: 'a'.repeat(40), head: 'b'.repeat(40), branch: 'work/billing', kind: 'own', project: 'shop' }
const MINE: StackFacts = { ...OWN, repository: 'me/shop', kind: 'mine', pull: { number: 7, address: 'https://github.com/me/shop/pull/7', author: 'me' } }
const OTHER: StackFacts = { ...MINE, kind: 'other', pull: { number: 183, address: 'https://github.com/them/rpg/pull/183', author: 'them' } }

function fakeSeat(facts: StackFacts = OWN) {
  const started: { cwd: string; title: string; text: string }[] = []
  const ended = new Set<string>()
  const seat: StackSeat = {
    facts: async () => facts,
    start: async (hobkin) => {
      started.push(hobkin)
      return { id: `h${started.length}`, run: `r${started.length}` }
    },
    exists: async (id) => !ended.has(id),
  }
  return { seat, started, ended }
}

test('the prompt carries the change facts, with no place left unfilled, for each kind of change', () => {
  for (const facts of [OWN, MINE, OTHER]) {
    const text = stackPrompt(facts)
    assert.doesNotMatch(text, /\{\{/)
    for (const fact of [facts.title, facts.folder!, facts.start!, facts.head!, facts.branch!]) assert.ok(text.includes(fact), fact)
  }
  assert.ok(stackPrompt(MINE).includes('https://github.com/me/shop/pull/7'))
  assert.ok(stackPrompt(OTHER).includes('written by them'))
  assert.notEqual(stackPrompt(OWN), stackPrompt(MINE))
  assert.notEqual(stackPrompt(MINE), stackPrompt(OTHER))
  assert.ok(stackPrompt({ ...OWN, start: null }).includes('not known'))
})

test('the prompt names the code host the pull request is on', () => {
  const named: StackFacts = { ...OTHER, pull: { number: 183, address: 'https://code.example.invalid/them/rpg/pull/183', author: null, host: 'corp' } }
  const text = stackPrompt(named)
  assert.match(text, /Comment on corp\./)
  assert.match(text, /written by an author corp did not name/)
  assert.doesNotMatch(text, /GitHub/)
  const github = stackPrompt({ ...OTHER, pull: { ...OTHER.pull!, author: null } })
  assert.match(github, /Comment on GitHub\./)
  assert.match(github, /written by an author GitHub did not name/)
  assert.match(stackPrompt(OWN), /Comment on any code host\./)
})

test('it starts one agent in the repository folder with the change title and the prompt', async () => {
  const { seat, started } = fakeSeat()
  const answer = await stackHandlers(seat)['review.stack']!({ id: 'change:shop:billing' })
  assert.deepEqual(answer, { hobkin: 'h1', run: 'r1', already: false })
  assert.equal(started.length, 1)
  assert.equal(started[0]!.cwd, '/work/shop')
  assert.equal(started[0]!.title, 'Stack: Add billing')
  assert.equal(started[0]!.text, stackPrompt(OWN))
})

test('a long title is cut to the title limit', async () => {
  const { seat, started } = fakeSeat({ ...OWN, title: 'x'.repeat(500) })
  await stackHandlers(seat)['review.stack']!({ id: 'change:shop:billing' })
  assert.ok(started[0]!.title.length <= 120)
  assert.ok(started[0]!.title.startsWith('Stack: xxx'))
})

test('a second ask while the agent is there starts nothing, and a new one starts after it ends', async () => {
  const { seat, started, ended } = fakeSeat()
  const handlers = stackHandlers(seat)
  await handlers['review.stack']!({ id: 'change:shop:billing' })
  assert.deepEqual(await handlers['review.stack']!({ id: 'change:shop:billing' }), { hobkin: 'h1', run: null, already: true })
  assert.equal(started.length, 1)
  ended.add('h1')
  assert.deepEqual(await handlers['review.stack']!({ id: 'change:shop:billing' }), { hobkin: 'h2', run: 'r2', already: false })
  assert.equal(started.length, 2)
})

test('two asks at once start one agent', async () => {
  const { seat, started } = fakeSeat()
  const handlers = stackHandlers(seat)
  const [first, second] = await Promise.all([handlers['review.stack']!({ id: 'change:shop:billing' }), handlers['review.stack']!({ id: 'change:shop:billing' })])
  assert.equal(started.length, 1)
  assert.equal(first.already, false)
  assert.equal(second.already, true)
})

test('a merged change and a repository with no folder are refused in plain words', async () => {
  const merged = fakeSeat({ ...OWN, merged: true })
  await assert.rejects(async () => stackHandlers(merged.seat)['review.stack']!({ id: 'change:shop:billing' }), /This change has merged, so there is nothing to split\./)
  const nowhere = fakeSeat({ ...MINE, folder: null })
  await assert.rejects(async () => stackHandlers(nowhere.seat)['review.stack']!({ id: 'pr:me/shop/7' }), /me\/shop.*on this Mac/)
  assert.equal(merged.started.length + nowhere.started.length, 0)
})

test("only the window sends it: hobkin's own client tool neither lists nor runs it", async () => {
  const { seat, started } = fakeSeat()
  const handlers = stackHandlers(seat)
  assert.equal('hobkin' in COMMANDS['review.stack'], false)
  const tool = createClientTool({ run: (name, args) => runCommand(handlers, name, args) })
  const listed = (await tool.execute('1', { action: 'list' })).details as { name: string }[]
  assert.equal(listed.some((command) => command.name === 'review.stack'), false)
  await assert.rejects(tool.execute('2', { action: 'run', name: 'review.stack', args: { id: 'change:shop:billing' } }), /cannot run review.stack/)
  assert.deepEqual(started, [])
})
