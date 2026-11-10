import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseSpec } from '../spec/parse.ts'

const spec = `---
{
  "id": "004-signin",
  "title": "Sign in with OpenAI",
  "kind": "work",
  "status": "ready",
  "depends": ["002-host"],
  "updated": "2026-11-09"
}
---
# Sign in with OpenAI

## Outcome
A person who opens the app signed out sees the sign-in screen,
finishes it in the browser, and lands in the chat.

## Decisions
- Pi owns credentials.
- Tokens never reach the UI,
  not even in a log line.

### Later
- Other providers use the same screen.

## Out of scope
- Providers other than OpenAI.

## Acceptance
- A1. Signing in over the socket ends with the chat open.
- A2. A signed-out start shows the sign-in screen before the chat.
- ~~A3. The token is shown once.~~ Retired: tokens never reach the UI.
- A4. Cancelling returns to the sign-in screen.

## Proof
- A1. \`host/test/signin.test.ts\` › "finishes the sign-in over the socket"
- A2. check: open the app signed out. The sign-in screen shows before the chat.

## Steps
- [x] S1 (A1). Carry the sign-in interaction over the socket.
- [ ] S2 (A1, A2). The sign-in screen.

## Open questions
- Should the callback port be configurable? A fixed port collides with the Codex CLI.
`

test('reads the frontmatter and every section of a spec', () => {
  const parsed = parseSpec(spec)

  assert.deepEqual(parsed.problems, [])
  assert.deepEqual(
    { id: parsed.id, title: parsed.title, kind: parsed.kind, status: parsed.status, depends: parsed.depends, updated: parsed.updated },
    { id: '004-signin', title: 'Sign in with OpenAI', kind: 'work', status: 'ready', depends: ['002-host'], updated: '2026-11-09' },
  )
  assert.equal(parsed.heading, 'Sign in with OpenAI')
  assert.equal(parsed.outcome, 'A person who opens the app signed out sees the sign-in screen, finishes it in the browser, and lands in the chat.')
  assert.deepEqual(parsed.decisions, ['Pi owns credentials.', 'Tokens never reach the UI, not even in a log line.', 'Other providers use the same screen.'])
  assert.deepEqual(parsed.outOfScope, ['Providers other than OpenAI.'])
  assert.deepEqual(parsed.acceptance, [
    { id: 'A1', text: 'Signing in over the socket ends with the chat open.', retired: false, line: 29, endLine: 29 },
    { id: 'A2', text: 'A signed-out start shows the sign-in screen before the chat.', retired: false, line: 30, endLine: 30 },
    { id: 'A3', text: 'The token is shown once.', retired: true, line: 31, endLine: 31 },
    { id: 'A4', text: 'Cancelling returns to the sign-in screen.', retired: false, line: 32, endLine: 32 },
  ])
  // A line that wraps keeps the lines it spans, so a review can point at the whole of it.
  const wrapped = parseSpec(spec.replace('- A2. A signed-out start shows the sign-in screen before the chat.', '- A2. A signed-out start shows the sign-in screen\n  before the chat.'))
  assert.deepEqual(wrapped.acceptance[1], { id: 'A2', text: 'A signed-out start shows the sign-in screen before the chat.', retired: false, line: 30, endLine: 31 })
  assert.deepEqual(parsed.proof, [
    { id: 'A1', kind: 'test', path: 'host/test/signin.test.ts', name: 'finishes the sign-in over the socket', text: '`host/test/signin.test.ts` › "finishes the sign-in over the socket"' },
    { id: 'A2', kind: 'check', text: 'check: open the app signed out. The sign-in screen shows before the chat.' },
  ])
  assert.deepEqual(parsed.steps, [
    { id: 'S1', done: true, serves: ['A1'], text: 'Carry the sign-in interaction over the socket.', retired: false },
    { id: 'S2', done: false, serves: ['A1', 'A2'], text: 'The sign-in screen.', retired: false },
  ])
  assert.deepEqual(parsed.openQuestions, ['Should the callback port be configurable? A fixed port collides with the Codex CLI.'])
})

test('a retired proof line and a retired step are struck through, and read as retired', () => {
  const parsed = parseSpec(
    spec
      .replace('- A2. check: open the app signed out. The sign-in screen shows before the chat.', '- ~~A2. check: open the app signed out.~~ Retired with A2.')
      .replace('- [ ] S2 (A1, A2). The sign-in screen.', '- ~~S2 (A1, A2). The sign-in screen.~~ Retired with A2. See S3.'),
  )

  assert.deepEqual(parsed.problems, [])
  assert.deepEqual(parsed.proof.map((line) => line.id), ['A1'], 'a retired proof proves nothing')
  assert.deepEqual(parsed.steps.map((step) => [step.id, step.retired]), [['S1', false], ['S2', true]])
})

test('a proof that points at another spec is kept as written', () => {
  const parsed = parseSpec(spec.replace('- A2. check: open the app signed out. The sign-in screen shows before the chat.', '- A2. See `001-foundation` A4.'))

  assert.deepEqual(parsed.proof[1], { id: 'A2', kind: 'other', text: 'See `001-foundation` A4.' })
})

test('says what does not follow the format, and still reads what it can', () => {
  const noFrontmatter = parseSpec('# Loose notes\n\n## Outcome\nSomething.\n\n## Acceptance\n- A1. It works.\n')
  assert.deepEqual(noFrontmatter.problems, ['The spec does not start with JSON frontmatter between two --- lines.'])
  assert.equal(noFrontmatter.acceptance[0]!.id, 'A1')

  const broken = parseSpec(
    spec
      .replace('"status": "ready"', '"status": "started"')
      .replace('## Outcome', '## Result')
      .replace('- A4. Cancelling returns to the sign-in screen.', '- A1. Cancelling returns to the sign-in screen.\n- It also feels fast.')
      .replace('- A2. check:', '- A9. check:')
      .replace('- [ ] S2 (A1, A2).', '- [ ] S2 (A1, A7).'),
  )
  assert.deepEqual(broken.problems, [
    'Frontmatter: `status` must be draft, ready, doing, done or dropped.',
    'The Outcome section is missing.',
    'Acceptance: A1 is used twice.',
    'Acceptance: "It also feels fast." has no id.',
    'Proof: A9 is not an acceptance id.',
    'Steps: S2 serves A7, which is not an acceptance id.',
  ])

  const noAcceptance = parseSpec('---\n{"id":"x","title":"X","kind":"work","status":"draft","depends":[],"updated":"2026-11-09"}\n---\n# X\n\n## Outcome\nSomething.\n')
  assert.deepEqual(noAcceptance.problems, ['The Acceptance section is missing.'])

  const badJson = parseSpec('---\n{ id: nope }\n---\n# X\n\n## Outcome\nO.\n\n## Acceptance\n- A1. It works.\n')
  assert.deepEqual(badJson.problems, ['Frontmatter is not valid JSON.'])

  const moved = parseSpec(`${spec.replace(/## Proof[\s\S]*?(?=## Steps)/, '')}\n## Proof\n- A1. check: look at it.\n`)
  assert.deepEqual(moved.problems, ['Sections are out of order: Proof comes after Open questions.'])
  assert.equal(moved.proof.length, 1)
})

test('every spec in this repository follows its own format', () => {
  const root = new URL('../../_specs/', import.meta.url)
  const folders = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  assert.ok(folders.length >= 10)

  for (const folder of folders) {
    const parsed = parseSpec(readFileSync(new URL(`${folder.name}/spec.md`, root), 'utf8'))
    assert.deepEqual(parsed.problems, [], folder.name)
    assert.equal(parsed.id, folder.name)
    assert.ok(parsed.outcome.length > 0, folder.name)
    assert.ok(parsed.acceptance.length > 0, folder.name)
    if (parsed.kind === 'context') assert.equal(parsed.steps.length, 0, folder.name)
  }
})
