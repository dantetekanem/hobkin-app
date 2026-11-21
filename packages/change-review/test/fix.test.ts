import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixBrief } from '../src/fix.ts'
import type { Unit } from '../src/types.ts'

const fact = (value: string, evidence: string) => ({ value, evidence }) as never

function unit(id: string, level: Unit['level'], title: string, more: Partial<Unit> = {}): Unit {
  return {
    id,
    title,
    level,
    critical: false,
    nodes: [`n-${id}`],
    grouping: 'single',
    story_order: 0,
    where: 'on the path, called by `POST /orders`',
    what: 'It rounds the total before it is charged.',
    code: [{ path: 'src/total.js', lines: [12, 18], why: 'the changed lines', diff: '-a\n+b' }],
    facts: { effect: fact('data', 'writes `orders.total`'), proof: fact('none', 'no test that ran reaches it'), exposure: fact('everyone', 'every checkout'), undo: fact('rollback', 'a deploy rolls it back') },
    why_level: ['It changes data it writes, sends or keeps, everyone runs it, and no test goes through a request to it.'],
    would_change: [{ text: 'a test that goes through `POST /orders` and fails without the change', level: 'mid' }],
    watch: 'not assessed',
    questions: [],
    reading_minutes: 2,
    ...more,
  }
}

test('the brief names each part that can break, the critical first: what breaks, where, the evidence and why it is high', () => {
  const brief = fixBrief({
    units: [
      unit('u1', 'high', '`total` rounds 2.675 down to 2.67'),
      unit('u2', 'mid', 'Worth a look only'),
      unit('u3', 'high', 'A test that passed before fails now', { critical: true, code: [{ path: 'src/pay.js', lines: [3, 3], why: 'the changed lines', diff: '' }], why_level: ['A test that passes without the change fails with it.'] }),
    ],
  })
  assert.ok(brief)
  const [first, second] = brief.split('\n\n').slice(1)
  assert.match(brief, /^2 parts can break\./)
  assert.match(first!, /^1\. A test that passed before fails now\. Critical\./, 'the critical one comes first')
  assert.match(first!, /src\/pay\.js:3\b/)
  assert.match(second!, /^2\. `total` rounds 2\.675 down to 2\.67\./)
  assert.match(second!, /Where: on the path, called by `POST \/orders`, at src\/total\.js:12-18\./)
  assert.match(second!, /What changed: It rounds the total before it is charged\./)
  // The floor row that made it high, in its own words, and the four facts with their evidence.
  assert.match(second!, /Why it is high: It changes data it writes, sends or keeps, everyone runs it, and no test goes through a request to it\./)
  assert.match(second!, /Evidence: it does data \(writes `orders\.total`\); proven by none \(no test that ran reaches it\); runs for everyone \(every checkout\); undone by rollback \(a deploy rolls it back\)\./)
  assert.match(second!, /What would lower it: a test that goes through `POST \/orders` and fails without the change \(mid\)\./)
  assert.doesNotMatch(brief, /Worth a look only/, 'a part that cannot break is not the fixer’s')
})

test('a question the code cannot answer is in the brief, and a change with no part that can break has none', () => {
  const asked = unit('u1', 'high', 'Nothing undoes the email it sends', { questions: [{ text: 'Should a retry send it twice?', why: 'Only the product owner knows.' }] })
  assert.match(fixBrief({ units: [asked] })!, /Open question: Should a retry send it twice\? Only the product owner knows\./)
  assert.equal(fixBrief({ units: [unit('u1', 'mid', 'A'), unit('u2', 'safe', 'B')] }), null)
  assert.equal(fixBrief({ units: [] }), null)
})

test('a long review stays a brief: at most six parts named, the rest counted, and no field runs on', () => {
  const many = Array.from({ length: 9 }, (_, index) => unit(`u${index + 1}`, 'high', `Break ${index + 1}`, { what: 'x'.repeat(2000) }))
  const brief = fixBrief({ units: many })!
  assert.match(brief, /^9 parts can break\./)
  assert.match(brief, /\n\n6\. Break 6\./)
  assert.doesNotMatch(brief, /Break 7\./)
  assert.match(brief, /3 more parts can break: the review in Change Review names them\.$/)
  assert.ok(brief.length < 6000, `${brief.length} characters`)
})
