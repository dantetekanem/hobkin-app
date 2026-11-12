import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { completeReview, draftReview, modelRequest, prepareReview, type PrepareInput } from '../review/prepare.ts'
import { signatureOf } from '../review/signature.ts'
import type { Review } from '../review/types.ts'
import { validateReview } from '../review/validate.ts'
import type { Vicinity } from '../review/vicinity.ts'

const mood = lines('export function searchingTool(name: string) {', "  return name === 'read';", '}', '', 'export const MOODS = 18;')
const app = lines("import { listen } from './runtime.ts';", 'export function start(main: Main) {', '  return listen(main);', '}')
const base: Tree = {
  'src/doing.ts': lines('export function doingAfter(previous: string) {', '  return previous;', '}'),
  'src/runtime.ts': lines("import { doingAfter } from './doing.ts';", 'export function listen(main: Main) {', '  return main;', '}'),
  'src/mood.ts': mood,
  'src/app.ts': app,
}
const head: Tree = {
  'src/doing.ts': lines(
    "import { searchingTool } from './mood.ts';",
    '',
    'const toolDoing = (name: string) => {',
    "  return searchingTool(name) ? 'researching' : 'working';",
    '};',
    '',
    'export function doingAfter(previous: string, event: Event): string {',
    "  if (event.type === 'tool') return toolDoing(event.name);",
    '  return previous;',
    '}',
  ),
  'src/runtime.ts': lines("import { doingAfter } from './doing.ts';", 'export function listen(main: Main) {', '  main.doing = doingAfter(main.doing, main.event);', '  return main;', '}'),
  'src/mood.ts': mood,
  'src/app.ts': app,
  'test/doing.test.ts': lines("import { doingAfter } from '../src/doing.ts';", '', "test('a tool says what kind of work it is', () => {", "  assert.equal(doingAfter('', { type: 'tool', name: 'read' }), 'researching');", '});'),
}

async function input(vicinity?: Vicinity): Promise<PrepareInput> {
  return {
    id: 'r1',
    change: { project: 'hobkin', item: '7d02c9', title: 'Say what hobkin is doing', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing' },
    capture: await captureChange(memoryReader(base, head), 'base', 'head'),
    spec: null,
    readHead: async (path) => (typeof head[path] === 'string' ? (head[path] as string) : null),
    ...(vicinity ? { vicinity } : {}),
  }
}

const idOf = (review: { nodes: readonly { id: string; title: string }[] }, title: string) => {
  const node = review.nodes.find((entry) => entry.title === title)
  assert.ok(node, `a node titled ${title}`)
  return node.id
}

test('reads what goes into a declaration and what comes out of it', () => {
  assert.deepEqual(signatureOf(['export function reviewTier(root: string): TierChoice | null {']), { in: 'root: string', out: 'TierChoice | null' })
  assert.deepEqual(signatureOf(['export function doingAfter(previous: string, event: Event) {']), { in: 'previous: string, event: Event', out: '' })
  assert.deepEqual(signatureOf(['const toolDoing = (name: string) => {']), { in: 'name: string', out: '' })
  assert.deepEqual(signatureOf(['  async verdict(id: string, verdict: Verdict): Promise<{ message: string }> {']), { in: 'id: string, verdict: Verdict', out: 'Promise<{ message: string }>' })
  assert.deepEqual(signatureOf(['  def merge(root, slug)']), { in: 'root, slug', out: '' })
  assert.deepEqual(signatureOf(['export function open(', '  id: string,', '  { force = false }: Options = {},', '): Review {']), { in: 'id: string, { force = false }: Options = {}', out: 'Review' })
  assert.deepEqual(signatureOf(['export async function ping() {']), { in: '', out: '' })
  assert.equal(signatureOf(["test('a tool says what kind of work it is', () => {"]), null)
  assert.equal(signatureOf(['const MOODS = 18']), null)
})

test('each test starts a path that follows its wires inward, and the host walks the paths first', async () => {
  const review = await prepareReview(await input())
  const [testId, doingAfter, toolDoing, listen] = ['a tool says what kind of work it is', 'doingAfter', 'toolDoing', 'listen'].map((title) => idOf(review, title))
  assert.deepEqual(review.paths, [{ id: 'p1', test: testId, hops: [testId, doingAfter, toolDoing] }])
  assert.deepEqual(review.nodes.find((node) => node.id === doingAfter)?.io, { in: 'previous: string, event: Event', out: 'string' })

  const walk = review.story.filter((step) => step.kind === 'walk')
  assert.deepEqual(walk.map((step) => [step.focus, step.path]), [[[testId], 'p1'], [[doingAfter], 'p1'], [[toolDoing], 'p1'], [[listen], undefined]])
  assert.equal(walk[1]!.travel, `exercises:${testId}>${doingAfter}`)
  assert.equal(walk[2]!.travel, `calls:${doingAfter}>${toolDoing}`)
  assert.deepEqual(validateReview(review), [])
})

test('the call-graph scan adds the unchanged code around the change: what it calls and what calls it', async () => {
  const vicinity: Vicinity = {
    links: [
      { near: { changed: { path: 'src/doing.ts', line: 4 } }, other: { path: 'src/mood.ts', symbol: 'searchingTool', startLine: 1, endLine: 3 }, direction: 'callee', hops: 1, call: { line: 4, name: 'searchingTool' }, proven: true },
      { near: { changed: { path: 'src/runtime.ts', line: 3 } }, other: { path: 'src/app.ts', symbol: 'start', startLine: 2, endLine: 4 }, direction: 'caller', hops: 1, call: { line: 3, name: 'listen' }, proven: true },
      // Code the change itself touched is a node already, and a file that is not at head is nobody's vicinity.
      { near: { changed: { path: 'src/runtime.ts', line: 3 } }, other: { path: 'src/doing.ts', symbol: 'doingAfter', startLine: 7, endLine: 10 }, direction: 'callee', hops: 1, call: { line: 3, name: 'doingAfter' }, proven: true },
      { near: { changed: { path: 'src/doing.ts', line: 8 } }, other: { path: 'src/gone.ts', symbol: 'gone', startLine: 1, endLine: 2 }, direction: 'callee', hops: 1, call: { line: 8, name: 'toolDoing' }, proven: true },
    ],
    notice: 'Callers and callees come from a static scan.',
  }
  const review = await prepareReview(await input(vicinity))
  const [testId, doingAfter, toolDoing, listen, searchingTool, start] = ['a tool says what kind of work it is', 'doingAfter', 'toolDoing', 'listen', 'searchingTool', 'start'].map((title) => idOf(review, title))

  const context = review.nodes.filter((node) => node.kind === 'context')
  assert.deepEqual(context.map((node) => [node.title, node.subtitle, node.change]), [['searchingTool', 'src/mood.ts', 'unchanged'], ['start', 'src/app.ts', 'unchanged']])
  const host = (from: string, to: string) => review.edges.find((edge) => edge.from === from && edge.to === to)
  assert.deepEqual([host(toolDoing, searchingTool)?.kind, host(toolDoing, searchingTool)?.certainty], ['calls', 'host'])
  assert.deepEqual([host(listen, start)?.kind, host(listen, start)?.certainty], ['called-by', 'host'])
  assert.deepEqual(review.paths?.[0]?.hops, [testId, doingAfter, toolDoing, searchingTool])
  assert.ok(review.notices.includes('Callers and callees come from a static scan.'))
  assert.ok(review.files.some((file) => file.path === 'src/app.ts' && file.status === 'unchanged'))
  assert.deepEqual(validateReview(review), [])
})

test('the model is given the in and out, the context code and the paths, and its own words replace the host signature', async () => {
  const vicinity: Vicinity = { links: [{ near: { changed: { path: 'src/doing.ts', line: 4 } }, other: { path: 'src/mood.ts', symbol: 'searchingTool', startLine: 1, endLine: 3 }, direction: 'callee', hops: 1, call: { line: 4, name: 'searchingTool' }, proven: true }] }
  const draft = await draftReview(await input(vicinity))
  const request = modelRequest(draft)
  const doingAfter = idOf(draft, 'doingAfter')
  const testId = idOf(draft, 'a tool says what kind of work it is')
  assert.deepEqual(request.nodes.find((node) => node.id === doingAfter)?.io, { in: 'previous: string, event: Event', out: 'string' })
  assert.match(request.nodes.find((node) => node.title === 'searchingTool')?.code ?? '', /export function searchingTool/)
  assert.equal(request.paths[0]?.test, testId)

  const { review, corrections } = await completeReview(draft, {
    nodes: { [doingAfter]: { summary: 'Picks the word.', in: 'the last word and the event that came', out: 'the word to show' } },
    story: [
      { title: 'The test asks for researching', text: 'It sends a read tool.', focus: [testId], path: 'p1' },
      { title: 'doingAfter picks the word', text: 'It reads the event.', focus: [doingAfter], path: 'p9' },
    ],
  })
  assert.deepEqual(review.nodes.find((node) => node.id === doingAfter)?.io, { in: 'the last word and the event that came', out: 'the word to show' })
  const walk = review.story.filter((step) => step.kind === 'walk')
  assert.equal(walk[0]!.path, 'p1')
  assert.equal(walk[1]!.path, undefined)
  assert.ok(corrections.some((line) => /p9/.test(line)))
  assert.deepEqual(validateReview(review), [])
})

test('a review whose step or path names what is not there is refused', async () => {
  const review: Review = await prepareReview(await input())
  const broken = structuredClone(review)
  broken.story.find((step) => step.kind === 'walk')!.path = 'p7'
  broken.paths = [{ id: 'p1', test: 'nowhere', hops: ['nowhere'] }]
  const problems = validateReview(broken)
  assert.ok(problems.some((problem) => /p7/.test(problem)))
  assert.ok(problems.some((problem) => /nowhere/.test(problem)))
})
