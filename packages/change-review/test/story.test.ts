import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { levelsInStory, renderStory } from '../src/story.ts'
import type { Graph, Level, ReviewNode, Triage, Unit, Units } from '../src/types.ts'

const example = (name: string) => readFileSync(new URL(`../skills/change-review/examples/${name}`, import.meta.url), 'utf8')
const exampleUnits = JSON.parse(example('units.json')) as Units
const exampleTriage = JSON.parse(example('triage.json')) as Triage

/** The smallest node the story can read a name and a proof run from. */
function stub(id: string, symbol: string, entries: string[]): ReviewNode {
  return {
    id,
    kind: 'function',
    symbol,
    path: 'app/x.rb',
    lines: [1, 2],
    change: 'modified',
    changed_lines: [1],
    entries,
    facts: {
      effect: { value: 'behaviour', evidence: '' },
      proof: { value: 'none', evidence: '' },
      exposure: { value: 'everyone', evidence: '' },
      undo: { value: 'rollback', evidence: '' },
    },
    extras: {},
    conditions: [],
    hosts_condition: false,
    runs: [],
    sensitive: [],
    level: null,
    critical: false,
    findings: [],
    watch: null,
    questions: [],
  }
}

const symbols: Record<string, string> = { n5: 'round_money', n6: 'totals_cache_key', x1: 'legacy_discount', n4: 'compute_totals', n7: 'per_line_totals', n8: 'round_line_tax', n9: 'TAX_PRECISION', n10: 'AddLineTaxCentsToCarts' }

function exampleGraph(units: Unit[]): Graph {
  const ids = [...new Set(units.flatMap((unit) => unit.nodes))]
  const nodes = ids.map((id) => stub(id, symbols[id] ?? id, ['CheckoutController#create']))
  return { schema: 'review-graph/1', range: 'main...x', base: 'a', head: 'b', nodes, edges: [], coverage: { truncated: false, notes: [] } }
}

/** Heading lines and bold labels of a story, outside code blocks, in order. */
function skeleton(markdown: string) {
  const out: { sections: string[]; headings: string[]; labels: string[][]; fences: number[] } = { sections: [], headings: [], labels: [[]], fences: [] }
  let fence = ''
  let unit = -1
  for (const line of markdown.split('\n')) {
    const open = /^(`{3,})/.exec(line)
    if (fence) {
      if (open && open[1]!.length >= fence.length && line.trim() === open[1]) fence = ''
      continue
    }
    if (open) {
      fence = open[1]!
      if (unit >= 0) out.fences[unit] = (out.fences[unit] ?? 0) + 1
      continue
    }
    if (line.startsWith('## ')) {
      out.sections.push(line.slice(3))
      unit = -1
      out.labels.push([])
    } else if (line.startsWith('### ')) {
      out.headings.push(line)
      unit = out.headings.length - 1
      out.labels.push([])
    } else {
      const label = /^\*\*([A-Z][a-z]+(?: [a-z]+)*)/.exec(line)
      if (label) out.labels[out.labels.length - 1]!.push(label[1]!)
    }
  }
  return out
}

// ───────────────────────── The spec test ─────────────────────────

test('opening, setting, units by level, conclusion, and no level changed', () => {
  const markdown = renderStory({ triage: exampleTriage, graph: exampleGraph(exampleUnits.units), units: exampleUnits })
  const read = levelsInStory(markdown)
  assert.equal(read.length, exampleUnits.units.length)
  const byRank = [...exampleUnits.units].sort((a, b) => ['high', 'mid', 'safe'].indexOf(a.level) - ['high', 'mid', 'safe'].indexOf(b.level))
  assert.deepEqual(read.map((item) => item.level), byRank.map((unit) => unit.level))
  assert.deepEqual(read.map((item) => item.critical), byRank.map((unit) => unit.critical))
  assert.deepEqual(read.map((item) => item.number), byRank.map((_, index) => index + 1))
  assert.deepEqual(skeleton(markdown).sections, ['Opening', 'Setting', 'Needs you', 'Worth a look', 'Safe', 'Conclusion'])
  assert.match(markdown, /^# /)
})

test('the story has the example story\'s shape, section by section', () => {
  const markdown = renderStory({ triage: exampleTriage, graph: exampleGraph(exampleUnits.units), units: exampleUnits })
  const made = skeleton(markdown)
  const wanted = skeleton(example('story.md'))
  assert.deepEqual(made.sections, wanted.sections)
  // Unit headings: same numbers, titles and levels as the example.
  assert.deepEqual(made.headings, wanted.headings)
  // Labels: the opening, then each unit's, then the conclusion's, in order. Section 1 is the opening, 2 the setting.
  assert.deepEqual(made.labels[1], wanted.labels[1])
  assert.deepEqual(made.labels[made.labels.length - 1], wanted.labels[wanted.labels.length - 1])
  const unitLabels = (shape: ReturnType<typeof skeleton>) => shape.labels.filter((labels) => labels[0] === 'Where')
  assert.equal(unitLabels(made).length, 8)
  assert.deepEqual(unitLabels(made), unitLabels(wanted))
  // Code blocks per unit.
  assert.deepEqual(made.fences, wanted.fences)
})

test('the opening names the high units by title with critical first, then the counts', () => {
  const markdown = renderStory({ triage: exampleTriage, graph: exampleGraph(exampleUnits.units), units: exampleUnits })
  assert.match(markdown, /\*\*Level: high\.\*\* Becomes \*\*mid\*\*/)
  assert.match(markdown, /\*\*Needs you \(3\):\*\*\n- \*\*Critical\.\*\* Unit 1: round_money changes its rounding mode/)
  assert.match(markdown, /- Unit 2: The totals cache key prefix changes/)
  assert.match(markdown, /Then 2 worth a look, and 3 that are safe\./)
  assert.match(markdown, /\*\*Risky to deploy\.\*\* round_money changes its rounding mode for every caller, flag on or off\. 2 more parts can break\./, 'the one answer for the whole change comes before any level')
  assert.match(markdown, /\*\*Verdict: risky to deploy\*\* \(high, because of units 1 to 3\)/)
})

// ───────────────────────── Words and code ─────────────────────────

test('words replace the title, the what and the setting; they never change a level, a fact or the code', () => {
  const first = exampleUnits.units[0]!
  const markdown = renderStory({
    triage: exampleTriage,
    graph: exampleGraph(exampleUnits.units),
    units: exampleUnits,
    words: { title: 'Rounding, told plainly', setting: ['Checkout starts here.', 'Then the receipt job.'], units: { [first.id]: { title: 'Money rounds the other way for everyone', what: 'The rounding rule flipped.' } } },
  })
  assert.match(markdown, /^# Rounding, told plainly\n/)
  assert.match(markdown, /1\. Checkout starts here\.\n2\. Then the receipt job\./)
  assert.match(markdown, /### 1\. Money rounds the other way for everyone \(high, critical\)/)
  assert.match(markdown, /\*\*What changed:\*\* The rounding rule flipped\./)
  assert.match(markdown, /Does: \*\*behaviour\*\*/)
  assert.match(markdown, /\+  amount\.round\(2, half: :even\)/)
  assert.deepEqual(levelsInStory(markdown).map((item) => item.level), levelsInStory(renderStory({ triage: exampleTriage, graph: exampleGraph(exampleUnits.units), units: exampleUnits })).map((item) => item.level))
})

test('code, with headings and fences inside it, stays inside its block and is never read as story', () => {
  const unit: Unit = { ...exampleUnits.units[5]!, id: 'u1', code: [{ path: 'a.md', why: 'the changed line', diff: '+## Conclusion\n+### 9. Pretend (high, critical)\n+```\n+**Verdict: safe**' }] }
  const units: Units = { ...exampleUnits, attention: { units: 1, reading_minutes: 0.5 }, units: [unit] }
  const markdown = renderStory({ triage: exampleTriage, graph: exampleGraph([unit]), units })
  assert.deepEqual(levelsInStory(markdown), [{ number: 1, level: 'safe', critical: false }])
  assert.deepEqual(skeleton(markdown).sections, ['Opening', 'Setting', 'Safe', 'Conclusion'])
  assert.match(markdown, /````diff\n\+## Conclusion/)
})

test('a story without high units says what it is, omits empty sections and reports contradicted claims', () => {
  const unit: Unit = { ...exampleUnits.units[5]!, id: 'u1' }
  const units: Units = { ...exampleUnits, attention: { units: 1, reading_minutes: 0.5 }, units: [unit] }
  const triage: Triage = { ...exampleTriage, description_source: 'pull-request', claims: [{ text: 'No behaviour change', source: 'PR description', status: 'contradicted', evidence: 'round_money changed' }] }
  const markdown = renderStory({ triage, graph: exampleGraph([unit]), units })
  assert.match(markdown, /\*\*Level: safe\.\*\*/)
  assert.match(markdown, /\*\*Contradicted:\*\* .*No behaviour change/)
  assert.doesNotMatch(markdown, /## Needs you/)
  assert.doesNotMatch(markdown, /## Worth a look/)
  assert.match(markdown, /\*\*Verdict: safe to deploy\*\* \(safe\)/)
})

test('the conclusion tells a unit only direct tests prove from one no test shows', () => {
  const withProof = (id: string, value: 'isolated' | 'none'): Unit => ({ ...exampleUnits.units[0]!, id, facts: { ...exampleUnits.units[0]!.facts, proof: { value, evidence: '' } } })
  const units: Units = { ...exampleUnits, attention: { units: 2, reading_minutes: 4 }, units: [withProof('u1', 'none'), withProof('u2', 'isolated')] }
  const markdown = renderStory({ triage: exampleTriage, graph: exampleGraph(units.units), units })
  assert.match(markdown, /\*\*Proof:\*\* .*No test shows unit 1\. Only tests that call it directly show unit 2: no test goes through a request to it\./)
})

test('what the blind check led to is reported in the conclusion', () => {
  const markdown = renderStory({
    triage: exampleTriage,
    graph: exampleGraph(exampleUnits.units),
    units: exampleUnits,
    blind: { units: [], needs: ['who reads the cache key'] },
    actions: [{ unit: 'u2', answer: 'unknown', did: 'became a question' }],
  })
  assert.match(markdown, /\*\*Blind check:\*\*/)
  assert.match(markdown, /Unit 2: became a question/)
  assert.match(markdown, /who reads the cache key/)
})

test('split reviews say so and name the part of each unit', () => {
  const units: Units = { ...exampleUnits, attention: { ...exampleUnits.attention, parts: 2 }, units: exampleUnits.units.map((unit, index) => ({ ...unit, part: index < 4 ? 1 : 2 })) }
  const markdown = renderStory({ triage: exampleTriage, graph: exampleGraph(units.units), units })
  assert.match(markdown, /split into 2 parts by entry point/)
  assert.match(markdown, /Part 2\./)
  const levels: Level[] = levelsInStory(markdown).map((item) => item.level)
  assert.equal(levels.length, 8)
})
