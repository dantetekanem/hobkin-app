import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { hashLines } from '../review/lines.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { prepareReview } from '../review/prepare.ts'
import { validateReview } from '../review/validate.ts'

const SPEC_PATH = '_specs/3fa9c1-fix-login-redirect/spec.md'

const spec = `---
{
  "id": "3fa9c1-fix-login-redirect",
  "title": "Fix the login redirect",
  "kind": "work",
  "status": "done",
  "depends": [],
  "updated": "2026-11-09"
}
---
# Fix the login redirect

## Outcome
After signing in, a person lands on the page they asked for.

## Out of scope
- Remembering the page across devices.

## Acceptance
- A1. Signing in from a deep link opens that link.
- A2. Signing in with no link opens the home page.
- A3. A link to another site is ignored.
- A4. The redirect survives a failed first attempt.
- A5. The sign-in page names where it will go.
- ~~A6. The link is kept for a week.~~ Retired: it is kept for the session only.

## Proof
- A1. \`test/redirect.test.ts\` › "opens the deep link after sign-in"
- A2. \`test/home.test.ts\` › "opens home with no link"
- A3. \`test/redirect.test.ts\` › "ignores a link to another site"
- A5. check: open the sign-in page from a deep link and read the line under the button.

## Steps
- [x] S1 (A1, A3). Keep the link through sign-in.
- [x] S2 (A2, A4, A5). The default and the label.

## Open questions
- Should a link older than an hour be dropped?
`

const base: Tree = {
  'src/redirect.ts': lines('export function target(link: string) {', '  return link;', '}'),
  'test/home.test.ts': lines("test('opens home with no link', () => {", "  assert.equal(target(''), '/');", '});'),
}
const head: Tree = {
  'src/redirect.ts': lines('export function target(link: string) {', "  return link || '/';", '}'),
  'test/redirect.test.ts': lines("import { target } from '../src/redirect';", '', "test('opens the deep link after sign-in', () => {", "  assert.equal(target('/a'), '/a');", '});'),
  // Unchanged, so it is no part of the capture. The host reads it at head to check the Proof line.
  'test/home.test.ts': base['test/home.test.ts']!,
}

const input = async (specText: string | null) => ({
  id: 'r1',
  change: { project: 'demo', item: '3fa9c1', title: 'Fix the login redirect', branch: 'hobkin/3fa9c1-fix-login-redirect' },
  capture: await captureChange(memoryReader(base, { ...head, ...(specText == null ? {} : { [SPEC_PATH]: specText }) }), 'base', 'head'),
  spec: specText == null ? null : { path: SPEC_PATH, text: specText },
  readHead: async (path: string) => (typeof head[path] === 'string' ? (head[path] as string) : null),
})

test('turns acceptance lines into nodes and flags missing proof', async () => {
  const review = await prepareReview(await input(spec))
  const node = (id: string) => review.nodes.find((entry) => entry.id === id)!
  const criteria = review.nodes.filter((entry) => entry.kind === 'criterion')

  assert.deepEqual(criteria.map((entry) => entry.id), ['A1', 'A2', 'A3', 'A4', 'A5'], 'one node per acceptance line, and none for the retired one')
  assert.deepEqual(
    [node('A1').title, node('A1').summary, node('A1').subtitle],
    ['A1', 'Signing in from a deep link opens that link.', SPEC_PATH],
  )

  // A1: its Proof names a test of this change.
  const deepLink = review.nodes.find((entry) => entry.title === 'opens the deep link after sign-in')!
  assert.equal(deepLink.kind, 'test')
  assert.deepEqual([node('A1').status, node('A1').warning], ['proven', undefined])
  assert.equal(node('A1').proof, '`test/redirect.test.ts` › "opens the deep link after sign-in"')
  assert.deepEqual(
    review.edges.filter((edge) => edge.from === 'A1'),
    [{ id: `proves:A1>${deepLink.id}`, from: 'A1', to: deepLink.id, kind: 'proves', certainty: 'host' }],
  )

  // A2: its Proof names a test that exists at head and did not change. It joins the graph as an unchanged test.
  const home = review.nodes.find((entry) => entry.title === 'opens home with no link')!
  assert.deepEqual([home.kind, home.change, home.subtitle], ['test', 'unchanged', 'test/home.test.ts'])
  assert.deepEqual(
    home.anchors,
    [{ fileId: 'test/home.test.ts', side: 'added', startLine: 1, endLine: 3, hash: hashLines(head['test/home.test.ts'] as string, 1, 3) }],
  )
  assert.equal(node('A2').status, 'proven')
  assert.ok(review.edges.some((edge) => edge.from === 'A2' && edge.to === home.id && edge.kind === 'proves'))
  assert.deepEqual(
    review.files.find((file) => file.id === 'test/home.test.ts'),
    { id: 'test/home.test.ts', path: 'test/home.test.ts', status: 'unchanged', binary: false, additions: 0, deletions: 0, summarized: false },
  )

  // A3: its Proof names a test that is nowhere. A4: no Proof line at all.
  assert.deepEqual(
    [node('A3').status, node('A3').warning],
    ['unproven', 'The Proof line names a test that does not exist: `test/redirect.test.ts` › "ignores a link to another site".'],
  )
  assert.deepEqual([node('A4').status, node('A4').warning, node('A4').proof], ['unproven', 'This line has no Proof line.', undefined])
  assert.equal(review.edges.some((edge) => edge.from === 'A3' || edge.from === 'A4'), false)

  // A5: a check a person does. It counts as proof, and the node says what to look at.
  assert.deepEqual([node('A5').status, node('A5').proof], ['proven', 'check: open the sign-in page from a deep link and read the line under the button.'])

  // Each acceptance node points at its line of the spec, so the spec opens like code.
  const specLines = spec.split('\n')
  for (const entry of criteria) {
    assert.equal(entry.anchors.length, 1)
    const anchor = entry.anchors[0]!
    assert.equal(anchor.fileId, SPEC_PATH)
    assert.ok(specLines[anchor.startLine - 1]!.startsWith(`- ${entry.id}. `), entry.id)
    assert.equal(anchor.hash, hashLines(spec, anchor.startLine, anchor.endLine))
  }

  assert.deepEqual(review.spec, {
    path: SPEC_PATH,
    outcome: 'After signing in, a person lands on the page they asked for.',
    outOfScope: ['Remembering the page across devices.'],
    openQuestions: ['Should a link older than an hour be dropped?'],
  })
  assert.equal(review.notices.some((notice) => /no spec/i.test(notice)), false)
  assert.deepEqual(validateReview(review), [])
})

test('a spec that does not follow the format is read as far as it goes, and the review says what is wrong', async () => {
  const review = await prepareReview(await input(spec.replace('- A5. check:', '- A9. check:')))

  assert.ok(review.notices.includes('The spec does not follow its format. Proof: A9 is not an acceptance id.'), review.notices.join('\n'))
  assert.equal(review.nodes.find((entry) => entry.id === 'A5')!.status, 'unproven')
})

test('a spec that is not part of the change is still a file of the review', async () => {
  const withoutSpecFile = await input(null)
  const review = await prepareReview({ ...withoutSpecFile, spec: { path: SPEC_PATH, text: spec } })

  assert.deepEqual(
    review.files.find((file) => file.id === SPEC_PATH),
    { id: SPEC_PATH, path: SPEC_PATH, status: 'unchanged', binary: false, additions: 0, deletions: 0, summarized: false },
  )
  assert.equal(review.nodes.some((entry) => entry.kind === 'file' && entry.subtitle === SPEC_PATH), false, 'and no file node, because none of its lines changed')
  assert.equal(review.nodes.filter((entry) => entry.kind === 'criterion').length, 5)
  assert.deepEqual(validateReview(review), [])
})

test('a change without a spec says so', async () => {
  const review = await prepareReview(await input(null))

  assert.equal(review.spec, null)
  assert.deepEqual(review.nodes.filter((entry) => entry.kind === 'criterion'), [])
  assert.deepEqual(review.edges.filter((edge) => edge.kind === 'proves'), [])
  assert.ok(review.notices.includes('This change has no spec.'), review.notices.join('\n'))
  assert.equal(review.story[0]!.kind, 'outcome')
  assert.ok(review.nodes.length > 0)
  assert.deepEqual(validateReview(review), [])
})
