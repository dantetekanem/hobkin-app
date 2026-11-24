import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { Reviews } from '../src/review/reviews.ts'
import { codeOf, pullCode, refreshHandlers, refreshPrompt, type RefreshFacts, type RefreshSeat } from '../src/review/refresh-code.ts'
import { sampleReviewSource } from '../src/review/sample-source.ts'
import { reviewStore } from '../src/review/store.ts'
import { temporaryDirectory } from './support.ts'

const BEHIND = { behind: 3, conflict: false, base: 'main' }
const OWN: RefreshFacts = { title: 'Add billing', repository: 'shop', folder: '/work/shop', merged: false, branch: 'work/billing', code: BEHIND, kind: 'own' }
const OWN_PULL: RefreshFacts = { ...OWN, pull: { number: 7, address: 'https://github.com/me/shop/pull/7', author: 'me' } }
const MINE: RefreshFacts = { ...OWN_PULL, repository: 'me/shop', kind: 'mine' }
const OTHER: RefreshFacts = { ...OWN_PULL, repository: 'them/rpg', kind: 'other', pull: { number: 183, address: 'https://github.com/them/rpg/pull/183', author: 'them' } }

function fakeSeat(facts: RefreshFacts = OWN) {
  const started: { cwd: string; title: string; text: string }[] = []
  const ended = new Set<string>()
  const seat: RefreshSeat = {
    facts: async () => facts,
    start: async (hobkin) => {
      started.push(hobkin)
      return { id: `h${started.length}`, run: `r${started.length}` }
    },
    exists: async (id) => !ended.has(id),
  }
  return { seat, started, ended }
}
const ask = (seat: RefreshSeat, id = 'change:shop:billing') => refreshHandlers(seat)['review.refresh-code']!({ id })

test('the prompt is filled for each ending, with no place left unfilled and each ending different', () => {
  const texts = [OWN, OWN_PULL, MINE, OTHER, { ...OWN, code: { behind: null, conflict: null, base: null } }].map(refreshPrompt)
  for (const text of texts) assert.doesNotMatch(text, /\{\{/)
  for (const [facts, text] of [[OWN, texts[0]!], [OWN_PULL, texts[1]!], [MINE, texts[2]!], [OTHER, texts[3]!]] as const) {
    for (const fact of [facts.title, facts.folder!, facts.branch!, 'main']) assert.ok(text.includes(fact), fact)
  }
  assert.ok(texts[2]!.includes('https://github.com/me/shop/pull/7'))
  assert.ok(texts[3]!.includes('written by them'))
  assert.equal(new Set(texts.slice(0, 4)).size, 4)
})

test('it starts one agent in the repository folder with the change title and the prompt', async () => {
  const { seat, started } = fakeSeat()
  assert.deepEqual(await ask(seat), { hobkin: 'h1', run: 'r1', already: false })
  assert.equal(started.length, 1)
  assert.equal(started[0]!.cwd, '/work/shop')
  assert.equal(started[0]!.title, 'Refresh: Add billing')
  assert.equal(started[0]!.text, refreshPrompt(OWN))
})

test('a conflict alone is enough to start it', async () => {
  const { seat, started } = fakeSeat({ ...OWN, code: { behind: 0, conflict: true, base: 'main' } })
  await ask(seat)
  assert.equal(started.length, 1)
})

test('a second ask while the agent is there starts nothing, and a new one starts after it ends', async () => {
  const { seat, started, ended } = fakeSeat()
  const handlers = refreshHandlers(seat)
  await handlers['review.refresh-code']!({ id: 'change:shop:billing' })
  assert.deepEqual(await handlers['review.refresh-code']!({ id: 'change:shop:billing' }), { hobkin: 'h1', run: null, already: true })
  assert.equal(started.length, 1)
  ended.add('h1')
  assert.deepEqual(await handlers['review.refresh-code']!({ id: 'change:shop:billing' }), { hobkin: 'h2', run: 'r2', already: false })
})

test('a merged change, a repository with no folder and a change that is up to date are refused in plain words', async () => {
  const refused = [
    [{ ...OWN, merged: true }, /This change has merged, so there is nothing to refresh\./],
    [{ ...MINE, folder: null }, /me\/shop.*on this Mac/],
    [{ ...OWN, code: { behind: 0, conflict: false, base: 'main' } }, /Its code is up to date with main\./],
    [{ ...OWN, code: { behind: null, conflict: null, base: null } }, /Its code is up to date with the branch it merges into\./],
  ] as const
  for (const [facts, words] of refused) {
    const { seat, started } = fakeSeat(facts)
    await assert.rejects(async () => ask(seat), words)
    assert.equal(started.length, 0)
  }
})

test("only the window sends it: hobkin's own client tool neither lists nor runs it", async () => {
  const { seat, started } = fakeSeat()
  assert.equal('hobkin' in COMMANDS['review.refresh-code'], false)
  const tool = createClientTool({ run: (name, args) => runCommand(refreshHandlers(seat), name, args) })
  const listed = (await tool.execute('1', { action: 'list' })).details as { name: string }[]
  assert.equal(listed.some((command) => command.name === 'review.refresh-code'), false)
  await assert.rejects(tool.execute('2', { action: 'run', name: 'review.refresh-code', args: { id: 'change:shop:billing' } }), /cannot run review.refresh-code/)
  assert.equal(started.length, 0)
})

test("a pull request's code is its conflict from GitHub, its count from the checkout, and null where not known", () => {
  assert.deepEqual(pullCode({ mergeable: true, mergeable_state: 'behind' }, 4, 'main'), { behind: 4, conflict: false, base: 'main' })
  assert.deepEqual(pullCode({ mergeable: false, mergeable_state: 'dirty' }, 0, 'main'), { behind: 0, conflict: true, base: 'main' })
  assert.deepEqual(pullCode({ mergeable: null }, null, 'main'), { behind: null, conflict: null, base: 'main' })
  assert.deepEqual(codeOf({ behind: undefined }), { behind: null, conflict: null, base: null })
})

/** Reviews whose change card (hobkin's own change) or pull source says where the branch stands. */
async function statusOf(t: test.TestContext, id: string, { card, code }: { card?: Partial<RefreshFacts['code']>; code?: RefreshFacts['code'] }) {
  const sample = sampleReviewSource()
  const pull = { ...sample, read: async (...args: Parameters<typeof sample.read>) => ({ ...(await sample.read(...args)), ...(code ? { code } : {}) }) }
  const reviews = new Reviews({
    store: reviewStore(temporaryDirectory(t)),
    sources: { change: sample, pull },
    work: () => {
      throw new Error('No work action is allowed.')
    },
    card: () => ({ landing: 'merge' as const, yes: 'Merge it.', branch: 'hobkin/word', pr: null, ...(card ? { code: codeOf(card) } : {}) }),
  })
  t.after(() => reviews.close())
  reviews.prepare(id)
  await reviews.settled(id)
  return reviews.status(id)
}

test("hobkin's own change carries the Work row's behind and conflict, behind or in conflict or up to date", async (t) => {
  assert.deepEqual((await statusOf(t, 'change:shop:word', { card: BEHIND })).code, BEHIND)
  assert.deepEqual((await statusOf(t, 'change:shop:word', { card: { behind: 0, conflict: true, base: 'main' } })).code, { behind: 0, conflict: true, base: 'main' })
  assert.deepEqual((await statusOf(t, 'change:shop:word', { card: { behind: 0, conflict: false, base: 'main' } })).code, { behind: 0, conflict: false, base: 'main' })
})

test('a pull request carries what its read knew, and has none when its read knew nothing', async (t) => {
  const known = { behind: 2, conflict: null, base: 'main' }
  assert.deepEqual((await statusOf(t, 'pr:acme/shop/9', { code: known })).code, known)
  assert.equal((await statusOf(t, 'pr:acme/shop/10', {})).code, undefined)
})
