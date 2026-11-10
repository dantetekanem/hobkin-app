import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange, sideText } from '../review/capture.ts'
import { hashLines } from '../review/lines.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { completeReview, draftReview, modelRequest, prepareReview, type PrepareInput } from '../review/prepare.ts'
import { MAX_FOCUS, PROSE_LIMIT, type AnchorSide, type Review } from '../review/types.ts'
import { openReview, ReviewRefused, validateReview } from '../review/validate.ts'

const SPEC_PATH = '_specs/7d02c9-say-what-hobkin-is-doing/spec.md'

const specText = (extra = '## Out of scope\n- The word for work agents.\n\n', closing = '\n## Open questions\n- Should the word be translated?\n') => `---
{ "id": "7d02c9-say-what-hobkin-is-doing", "title": "Say what hobkin is doing", "kind": "work", "status": "done", "depends": [], "updated": "2026-11-09" }
---
# Say what hobkin is doing

## Outcome
While hobkin works, one word says what it is doing.

${extra}## Acceptance
- A1. A tool says what kind of work it is.
- A2. An event that says nothing new keeps the word.

## Proof
- A1. \`test/doing.test.ts\` › "a tool says what kind of work it is"
- A2. \`test/doing.test.ts\` › "anything else keeps the word"

## Steps
- [x] S1 (A1, A2). The word.
${closing}`

const mood = lines('export function searchingTool(name: string) {', "  return name === 'read';", '}', '', 'export const MOODS = 18;')
const base: Tree = {
  'src/doing.ts': lines('export function doingAfter(previous: string) {', '  return previous;', '}'),
  'src/runtime.ts': lines("import { doingAfter } from './doing.ts';", 'export function listen(main: Main) {', '  return main;', '}'),
  'src/mood.ts': mood,
  'README.md': 'Old.\n',
}
const head: Tree = {
  'src/doing.ts': lines(
    "import { searchingTool } from './mood.ts';",
    '',
    'const toolDoing = (name: string) => {',
    "  return searchingTool(name) ? 'researching' : 'working';",
    '};',
    '',
    'export function doingAfter(previous: string, event: Event) {',
    "  if (event.type === 'tool') return toolDoing(event.name);",
    '  return previous;',
    '}',
  ),
  'src/runtime.ts': lines("import { doingAfter } from './doing.ts';", 'export function listen(main: Main) {', '  main.doing = doingAfter(main.doing, main.event);', '  return main;', '}'),
  'src/mood.ts': mood,
  'test/doing.test.ts': lines(
    "import { doingAfter } from '../src/doing.ts';",
    '',
    "test('a tool says what kind of work it is', () => {",
    "  assert.equal(doingAfter('', { type: 'tool', name: 'read' }), 'researching');",
    '});',
    '',
    "test('anything else keeps the word', () => {",
    "  assert.equal(doingAfter('writing', { type: 'other' }), 'writing');",
    '});',
  ),
  'README.md': 'Says what the agent is doing.\n',
}

async function input(spec: string | null = specText(), change: Partial<PrepareInput['change']> = {}, headTree: Tree = head): Promise<PrepareInput> {
  return {
    id: 'r1',
    change: { project: 'hobkin', item: '7d02c9', title: 'Say what hobkin is doing', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing', ...change },
    capture: await captureChange(memoryReader(base, headTree), 'base', 'head'),
    spec: spec == null ? null : { path: SPEC_PATH, text: spec },
    readHead: async (path) => (typeof headTree[path] === 'string' ? (headTree[path] as string) : null),
  }
}

const idOf = (review: { nodes: Array<{ id: string; title: string }> }, title: string) => {
  const node = review.nodes.find((entry) => entry.title === title)
  assert.ok(node, `a node titled ${title}`)
  return node.id
}

test('the host draws the wires it can read from the code, before any model', async () => {
  const review = await prepareReview(await input())
  const title = (id: string) => review.nodes.find((entry) => entry.id === id)!.title

  assert.deepEqual(
    review.edges.map((edge) => [title(edge.from), edge.kind, title(edge.to), edge.certainty]).sort(),
    [
      ['A1', 'proves', 'a tool says what kind of work it is', 'host'],
      ['A2', 'proves', 'anything else keeps the word', 'host'],
      ['a tool says what kind of work it is', 'exercises', 'doingAfter', 'host'],
      ['anything else keeps the word', 'exercises', 'doingAfter', 'host'],
      ['doingAfter', 'calls', 'toolDoing', 'host'],
      ['listen', 'calls', 'doingAfter', 'host'],
    ],
  )
  assert.deepEqual(validateReview(review), [])
})

test('the model is sent prepared ids, the wires already drawn and the changed lines, and nothing else to decide', async () => {
  const draft = await draftReview(await input())
  const request = modelRequest(draft)
  const doing = request.nodes.find((node) => node.title === 'doingAfter')!

  assert.deepEqual(Object.keys(doing).sort(), ['changes', 'id', 'kind', 'path', 'title'])
  assert.match(doing.changes, /^- export function doingAfter\(previous: string\) \{\n\+ export function doingAfter\(previous: string, event: Event\) \{/)
  assert.deepEqual(request.spec?.acceptance.map((line) => line.id), ['A1', 'A2'])
  assert.equal(request.wires.length, 6)
  assert.equal(JSON.stringify(request).includes('hash'), false, 'ranges and hashes stay with the host')
})

test('drops unknown ids, impossible wires and unverified context', async () => {
  const draft = await draftReview(await input())
  const id = (title: string) => idOf(draft, title)
  const [doingAfter, toolDoing, listen] = [id('doingAfter'), id('toolDoing'), id('listen')]
  const [toolTest, keepTest] = [id('a tool says what kind of work it is'), id('anything else keeps the word')]

  const { review, corrections } = await completeReview(draft, {
    summary: 'One word for what hobkin is doing.\u0007',
    nodes: {
      [doingAfter]: { summary: `Turns each event into a word. ${'Long. '.repeat(60)}` },
      ghost: { summary: 'Not a node.' },
    },
    context: [
      { id: 'mood', path: 'src/mood.ts', symbol: 'searchingTool', summary: 'Says whether a tool reads or searches.' },
      { id: 'no-file', path: 'src/missing.ts', symbol: 'anything', summary: 'Not at head.' },
      { id: 'no-symbol', path: 'src/mood.ts', symbol: 'cheerUp', summary: 'Not in that file.' },
      { id: 'outside', path: '../secrets.ts', symbol: 'key', summary: 'Outside the repository.' },
      { id: 'changed', path: 'src/doing.ts', symbol: 'doingAfter', summary: 'Changed code is not context.' },
      { id: 'unwired', path: 'src/mood.ts', symbol: 'MOODS', summary: 'Nothing connects to it.' },
    ],
    wires: [
      { from: toolDoing, to: 'mood', kind: 'calls', label: 'asks if the tool reads' },
      { from: toolTest, to: keepTest, kind: 'exercises' },
      { from: doingAfter, to: 'ghost', kind: 'calls' },
      { from: doingAfter, to: 'A1', kind: 'implements', label: 'carries A1' },
      { from: listen, to: 'no-file', kind: 'uses' },
      { from: listen, to: 'no-symbol', kind: 'uses' },
      { from: listen, to: 'outside', kind: 'uses' },
      { from: doingAfter, to: doingAfter, kind: 'calls' },
      { from: listen, to: toolDoing, kind: 'teleports' },
      { from: toolTest, to: 'changed', kind: 'exercises' },
      { from: listen, to: doingAfter, kind: 'calls', label: 'on every event' },
      { from: 'mood', to: listen, kind: 'calls' },
    ],
    story: [
      { title: 'The word', text: 'Each event becomes one word.', focus: [doingAfter, 'ghost'], criteria: ['A1', 'A7'], specStep: 'S1' },
      { title: 'Nothing real', text: 'This step names no node of the change.', focus: ['ghost'] },
      { title: 'T'.repeat(200), text: `Control\u0000 characters and ${'far too many words '.repeat(60)}`, focus: [toolDoing, 'mood'], specStep: 'S9' },
    ],
  })

  assert.deepEqual(validateReview(review), [], 'the saved review passes the validator')

  // Context: only the one that is at head, unchanged and wired.
  const context = review.nodes.filter((node) => node.kind === 'context')
  assert.deepEqual(context.map((node) => [node.title, node.subtitle, node.change, node.summary]), [
    ['searchingTool', 'src/mood.ts', 'unchanged', 'Says whether a tool reads or searches.'],
  ])
  assert.deepEqual(context[0]!.anchors, [{ fileId: 'src/mood.ts', side: 'added', startLine: 1, endLine: 3, hash: hashLines(mood, 1, 3) }])
  assert.equal(review.files.find((file) => file.id === 'src/mood.ts')?.status, 'unchanged')

  // Wires: what the model proposed and the host could accept.
  const title = (nodeId: string) => review.nodes.find((entry) => entry.id === nodeId)!.title
  assert.deepEqual(
    review.edges.filter((edge) => edge.certainty === 'model').map((edge) => [title(edge.from), edge.kind, title(edge.to), edge.label]),
    [
      ['toolDoing', 'calls', 'searchingTool', 'asks if the tool reads'],
      // Written from the code to the line, and turned to reading order.
      ['A1', 'implements', 'doingAfter', 'carries A1'],
    ],
  )
  // A wire the host already drew stays the host's, and takes the model's words.
  assert.deepEqual(
    review.edges.filter((edge) => edge.from === listen && edge.to === doingAfter).map((edge) => [edge.kind, edge.certainty, edge.label]),
    [['calls', 'host', 'on every event']],
  )
  // The test already exercises doingAfter, so naming it again as context adds nothing.
  assert.equal(review.edges.filter((edge) => edge.from === toolTest && edge.to === doingAfter).length, 1)
  assert.equal(review.edges.some((edge) => edge.from === toolTest && edge.to === keepTest), false, 'a test is never wired to a test')

  for (const expected of [/ghost/, /a test to a test|exercises/, /src\/missing\.ts/, /cheerUp/, /\.\.\/secrets\.ts/, /teleports/, /MOODS/, /itself/]) {
    assert.ok(corrections.some((line) => expected.test(line)), `${expected} in\n${corrections.join('\n')}`)
  }

  // Prose: control characters go and lengths are capped.
  assert.equal(review.summary, 'One word for what hobkin is doing.')
  const summary = review.nodes.find((node) => node.id === doingAfter)!.summary
  assert.equal(Array.from(summary).length, PROSE_LIMIT.summary)
  const long = review.story.find((step) => step.focus.includes(toolDoing))!
  assert.equal(Array.from(long.title).length, PROSE_LIMIT.title)
  assert.equal(Array.from(long.text).length, PROSE_LIMIT.stepText)
  assert.equal(/[\u0000-\u001f]/.test(long.text), false)
  assert.equal(long.specStep, undefined, 'a spec step that does not exist is dropped')

  // Story: unknown ids leave a step, and a step with no node left goes.
  const word = review.story.find((step) => step.title === 'The word')!
  assert.deepEqual([word.focus, word.criteria, word.specStep], [[doingAfter], ['A1'], 'S1'])
  assert.equal(review.story.some((step) => step.title === 'Nothing real'), false)
})

test('model output that is not what was asked for leaves a complete review from the host alone', async () => {
  for (const output of [undefined, null, 'not json', '```json\n{"story": "nope", "wires": 3, "nodes": []}\n```', 42, []]) {
    const { review } = await completeReview(await draftReview(await input()), output)
    assert.deepEqual(validateReview(review), [], String(output))
    assert.equal(review.edges.every((edge) => edge.certainty === 'host'), true)
  }
  // The model may answer with JSON in a code fence, as models do.
  const draft = await draftReview(await input())
  const fenced = await completeReview(draft, `\`\`\`json\n${JSON.stringify({ summary: 'A word.' })}\n\`\`\``)
  assert.equal(fenced.review.summary, 'A word.')
})

test('gives every node a story step and frames the story', async () => {
  const draft = await draftReview(await input(specText(), { risk: 'The word can lag one event behind.' }))
  const id = (title: string) => idOf(draft, title)
  const { review } = await completeReview(draft, {
    story: [
      { title: 'The word', text: 'Each event becomes one word.', focus: [id('doingAfter')], criteria: ['A1'] },
      { title: 'Tools', text: 'A tool decides the word.', focus: [id('toolDoing')] },
      { title: 'Too much at once', text: 'Five nodes in one step.', focus: [id('listen'), id('doingAfter'), id('toolDoing'), 'A1', 'A2'] },
    ],
  })
  const steps = review.story

  // The first step presents the outcome and frames the whole graph.
  assert.deepEqual(
    [steps[0]!.kind, steps[0]!.text, steps[0]!.focus],
    ['outcome', 'While hobkin works, one word says what it is doing.', []],
  )
  // The last presents what is out of scope, the risk and the open questions.
  const last = steps.at(-1)!
  assert.deepEqual([last.kind, last.focus], ['closing', []])
  assert.deepEqual([review.spec?.outOfScope, review.spec?.openQuestions, review.change.risk], [['The word for work agents.'], ['Should the word be translated?'], 'The word can lag one event behind.'])
  assert.equal(steps.filter((step) => step.kind !== 'walk').length, 2)

  // The model's steps come first, in its order. One step never focuses more than three nodes.
  assert.deepEqual(steps.slice(1, 4).map((step) => step.title), ['The word', 'Tools', 'Too much at once'])
  assert.deepEqual(steps[3]!.focus, [id('listen'), id('doingAfter'), id('toolDoing')])
  for (const step of steps.filter((entry) => entry.kind === 'walk')) {
    assert.ok(step.focus.length >= 1 && step.focus.length <= MAX_FOCUS, step.title)
    assert.ok(step.title.length > 0, 'every step has a title')
  }

  // Every node is the focus of at least one step, whatever the model left out.
  const focused = new Set(steps.flatMap((step) => step.focus))
  assert.deepEqual(review.nodes.filter((node) => !focused.has(node.id)).map((node) => node.title), [])
  assert.ok(review.nodes.some((node) => node.kind === 'file') && review.nodes.some((node) => node.kind === 'test'))

  // A step rides in on the wire that joins it to the step before.
  assert.equal(steps[1]!.travel, undefined, 'nothing to ride from the whole graph')
  assert.equal(steps[2]!.travel, `calls:${id('doingAfter')}>${id('toolDoing')}`)

  assert.deepEqual(validateReview(review), [])
  // The step ids are unique, so progress can be saved against them.
  assert.equal(new Set(steps.map((step) => step.id)).size, steps.length)
})

test('with nothing out of scope, no risk and no open question, the story ends on its last step', async () => {
  const review = await prepareReview(await input(specText('', '')))

  assert.equal(review.story[0]!.kind, 'outcome')
  assert.equal(review.story.at(-1)!.kind, 'walk')
  assert.deepEqual(validateReview(review), [])

  const risky = await prepareReview(await input(specText('', ''), { risk: 'It can lag.' }))
  assert.equal(risky.story.at(-1)!.kind, 'closing')

  const noSpec = await prepareReview(await input(null))
  assert.deepEqual([noSpec.story[0]!.kind, noSpec.story.at(-1)!.kind], ['outcome', 'walk'])
  const focused = new Set(noSpec.story.flatMap((step) => step.focus))
  assert.equal(noSpec.nodes.every((node) => focused.has(node.id)), true)
})

test('the validator names what is wrong with a review', async () => {
  const review = await prepareReview(await input())
  const broken = (change: (copy: Review) => void) => {
    const copy = structuredClone(review)
    change(copy)
    return validateReview(copy)
  }

  assert.match(broken((copy) => (copy.edges[0]!.to = 'nowhere')).join('\n'), /wire .* nowhere/i)
  assert.match(broken((copy) => (copy.story[1]!.focus = ['nowhere'])).join('\n'), /step .* nowhere/i)
  assert.match(broken((copy) => copy.story.splice(1, 1)).join('\n'), /not the focus of any step/)
  assert.match(broken((copy) => (copy.story[0]!.kind = 'walk')).join('\n'), /first step/i)
  assert.match(broken((copy) => (copy.nodes[1]!.position = { ...copy.nodes[0]!.position })).join('\n'), /overlap/)
  assert.match(broken((copy) => (copy.nodes[0]!.summary = 'bad\u0000text')).join('\n'), /summary/)
  assert.match(broken((copy) => copy.nodes.push({ ...copy.nodes[0]! })).join('\n'), /twice/)
  assert.match(broken((copy) => (copy.nodes.find((node) => node.anchors.length > 0)!.anchors[0]!.fileId = 'gone.ts')).join('\n'), /gone\.ts/)
  const tests = review.nodes.filter((node) => node.kind === 'test')
  assert.match(
    broken((copy) => copy.edges.push({ id: 'x', from: tests[0]!.id, to: tests[1]!.id, kind: 'exercises', certainty: 'model' })).join('\n'),
    /test .* test/i,
  )
  assert.match(broken((copy) => ((copy as { version: number }).version = 2)).join('\n'), /version/)
})

test('refuses anchors that no longer match', async () => {
  const given = await input()
  const saved: unknown = JSON.parse(JSON.stringify(await prepareReview(given)))
  const reader = (tree: Tree) => (fileId: string, side: AnchorSide) => {
    const captured = given.capture.files.find((file) => file.id === fileId)
    if (side === 'deleted') return captured ? sideText(captured, 'deleted') : null
    const text = fileId === SPEC_PATH ? specText() : tree[fileId]
    return typeof text === 'string' ? text : null
  }

  const opened = openReview(saved, reader(head))
  assert.equal(opened.id, 'r1')

  // One character of one line at head differs from what the review was prepared from.
  const edited = { ...head, 'src/doing.ts': (head['src/doing.ts'] as string).replace("'researching'", "'reading'") }
  assert.throws(
    () => openReview(saved, reader(edited)),
    (error: unknown) => {
      assert.ok(error instanceof ReviewRefused)
      assert.match(error.message, /no longer match/)
      assert.match(error.message, /src\/doing\.ts, lines 1 to 6/)
      return true
    },
  )

  // A file the review points into is gone.
  const { 'src/runtime.ts': _gone, ...without } = head
  assert.throws(() => openReview(saved, reader(without)), /src\/runtime\.ts is not there to read/)

  // A file that is not a review at all, or one that breaks its own rules, is refused the same way.
  assert.throws(() => openReview({ version: 1 }, reader(head)), ReviewRefused)
  const stale = structuredClone(saved) as Review
  stale.edges[0]!.from = 'nowhere'
  assert.throws(() => openReview(stale, reader(head)), /nowhere/)
})
