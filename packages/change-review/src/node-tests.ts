/**
 * The tests that cover a changed part (spec 055): each one with how it relates to the change (there before, added,
 * edited or removed), how it was found, how it did at the change's commit and what it showed when the part was
 * changed. What the proof worked out for each test file is kept here instead of only in the proof's one sentence, so
 * a reviewer sees what covered the code before the change, and whether the change took any of it away. Removed tests
 * are read from the diff's test hunks, by text: the pack does not list them.
 */
import type { NodeProof, TestCandidate } from './proof.ts'
import { isTestPath } from './triage.ts'
import type { FileDiff, FileStatus, Finding, NodeTest, RemovedTest, ReviewNode, TestDefinition, TestRun } from './types.ts'

/** The start of a test, as written: `test('…'`, `it("…"`, `it '…' do`, `specify`, `scenario`, or `def test_…`. */
const TEST_START = /^(\s*)(?:(?:test|it|specify|scenario)\s*\(?\s*(['"`])(.+?)\2|def\s+(test_\w+))/
/** A line that ends a block at its own indentation: `})`, `}`, `end`. */
const BLOCK_END = /^\s*(\}\)?;?|end)\s*$/
/** A line that asserts: `assert…`, `expect(…)`, `refute…`, `.should`, `must_…`, `wont_…`. */
const ASSERTION = /\bassert\w*\b|\bexpect\s*[({]|\brefute\w*\b|\.should\b|\bmust_\w+|\bwont_\w+/

const RELATION_ORDER: Record<NodeTest['relation'], number> = { before: 0, edited: 1, added: 2, removed: 3 }

/** The name a symbol is called by: `total` for `Cart#total` or `Billing::Cart.total`. */
const shortName = (symbol: string) => symbol.split(/#|::|\./).filter(Boolean).at(-1) ?? symbol
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const indentOf = (text: string) => /^\s*/.exec(text)![0].length

interface Started {
  name: string
  /** Its line at base. */
  line: number
  indent: number
  python: boolean
  body: string[]
}

/** The test blocks a hunk removes whole: their start line is removed, and so is what follows it up to their end. */
function removedBlocks(lines: readonly string[], oldStart: number): Started[] {
  const blocks: Started[] = []
  let open: Started | null = null
  let at = oldStart
  for (const raw of lines) {
    const side = raw[0]
    const text = raw.slice(1)
    if (side === '-') {
      const start = TEST_START.exec(text)
      const ends = open && (open.python ? text.trim() !== '' && indentOf(text) <= open.indent : BLOCK_END.test(text) && indentOf(text) <= open.indent)
      if (open && ends && !open.python) {
        open.body.push(text)
        open = null
      } else if (open && ends) open = null
      if (start && !open) {
        open = { name: start[3] ?? start[4]!, line: at, indent: start[1]!.length, python: Boolean(start[4]), body: [text] }
        blocks.push(open)
      } else if (open) open.body.push(text)
    } else open = null
    if (side !== '+') at += 1
  }
  return blocks
}

/** The names of the tests a hunk adds or keeps: a test removed and written again under its name was edited, not removed. */
function testsKept(lines: readonly string[]): Set<string> {
  return new Set(lines.filter((line) => line[0] !== '-').flatMap((line) => {
    const start = TEST_START.exec(line.slice(1))
    return start ? [start[3] ?? start[4]!] : []
  }))
}

/**
 * The tests the change removes, from the hunks of its test files: each removed test block with the changed parts it
 * names, by symbol. A block named in a line the diff adds again is an edit of that test, not a removal.
 */
export function removedTestsOf(diffs: readonly FileDiff[], symbols: readonly string[]): RemovedTest[] {
  const removed: RemovedTest[] = []
  for (const diff of diffs.filter((file) => isTestPath(file.path))) {
    const kept = testsKept(diff.hunks.flatMap((hunk) => hunk.lines))
    for (const hunk of diff.hunks) {
      for (const block of removedBlocks(hunk.lines, hunk.oldStart)) {
        if (kept.has(block.name)) continue
        const text = block.body.join('\n')
        const names = symbols.filter((symbol) => new RegExp(`(?<![\\w$])${escape(shortName(symbol))}(?![\\w$])`).test(text))
        removed.push({ path: diff.path, symbol: block.name, base_line: block.line, names })
      }
    }
  }
  return removed
}

/**
 * Whether the diff takes assertions out of a test whose lines at head are within `ranges`: more assertion lines
 * removed there than added. Says how many fewer, and the base lines of every assertion line removed.
 */
export function weakenedIn(diff: FileDiff, ranges: readonly (readonly [number, number])[]): NodeTest['weakened'] | undefined {
  const inside = (line: number) => ranges.some(([start, end]) => start <= line && line <= end)
  // The lines of a test removed whole are that test's, wherever the diff puts them beside another.
  const kept = testsKept(diff.hunks.flatMap((hunk) => hunk.lines))
  const gone = diff.hunks.flatMap((hunk) => removedBlocks(hunk.lines, hunk.oldStart)).filter((block) => !kept.has(block.name))
  const ofRemovedTest = (line: number) => gone.some((block) => block.line <= line && line < block.line + block.body.length)
  let removed = 0
  let added = 0
  const lines: number[] = []
  for (const hunk of diff.hunks) {
    let before = hunk.oldStart
    let after = hunk.newStart
    for (const raw of hunk.lines) {
      const side = raw[0]
      const asserts = ASSERTION.test(raw.slice(1))
      // A removed line sits where the next line at head would be.
      if (side === '-' && asserts && inside(after) && !ofRemovedTest(before)) {
        removed += 1
        lines.push(before)
      }
      if (side === '+' && asserts && inside(after)) added += 1
      if (side !== '+') before += 1
      if (side !== '-') after += 1
    }
  }
  return removed > added ? { assertions_removed: removed - added, lines } : undefined
}

export interface NodeTestsInput {
  node: Pick<ReviewNode, 'id' | 'symbol' | 'path' | 'kind'>
  /** The test files picked for its proof. */
  candidates: readonly TestCandidate[]
  /** The test definitions the scan says reference it: those the proof did not pick are listed as not run. */
  definitions: readonly TestDefinition[]
  /** The changed test definitions the scan anchored, by id, with whether each existed at base. */
  testAnchors: readonly { id: string; status?: 'added' | 'modified' }[]
  proof?: NodeProof
  /** Every run the proof made. */
  runs: readonly TestRun[]
  /** What the proof found before it changed anything: a test that fails or hangs at the commit. */
  findings: readonly Finding[]
  /** How the diff changed a file, or undefined when it did not. */
  status: (path: string) => FileStatus | undefined
  diffs: readonly FileDiff[]
  /** The tests the change removes. */
  removed: readonly RemovedTest[]
  isLifecycleTest: (path: string) => boolean
}

/** How a test file did at the change's commit: its first run with nothing changed. */
function atHeadOf(path: string, runs: readonly TestRun[], findings: readonly Finding[]): NonNullable<NodeTest['at_head']> {
  if (findings.some((finding) => finding.rule === 'test-timeout' && finding.text.startsWith(`${path} `))) return 'timed-out'
  const ran = runs.find((run) => run.kind === 'baseline' && !run.node && run.tests.includes(path))
  if (!ran || ran.not_run) return 'not-run'
  return ran.failed.includes(path) ? 'failed' : 'passed'
}

/** What a test file showed with the part changed, by what the proof worked out for each file. */
function showsOf(path: string, proof: NodeProof | undefined): NodeTest['shows'] {
  if (!proof) return undefined
  if (proof.observedBy.includes(path)) return proof.doubles.some((double) => double.startsWith(`${path}:`)) ? 'mocks' : 'proves'
  if (proof.reachedBy.includes(path)) return 'reaches'
  if (proof.stillPass.includes(path)) return 'still-passes'
  return undefined
}

/** A test file's relation to the change: by the file's status, and in a changed file by its test definitions that cover the part. */
function relationOf(path: string, definitions: readonly TestDefinition[], input: NodeTestsInput): NodeTest['relation'] {
  const status = input.status(path)
  if (!status) return 'before'
  if (status === 'added' || status === 'copied') return 'added'
  if (status === 'deleted') return 'removed'
  if (!definitions.length) return 'edited'
  const changed = definitions.filter((definition) => definition.changed)
  if (!changed.length) return 'before'
  const isNew = (definition: TestDefinition) => input.testAnchors.find((anchor) => anchor.id === definition.id)?.status === 'added'
  return changed.every(isNew) ? 'added' : 'edited'
}

/**
 * The tests that cover a part: the files its proof picked, each with what it showed; the tests the scan links that
 * the proof did not pick, as not run; and the tests the change removes that name it. The older first.
 */
export function nodeTestsOf(input: NodeTestsInput): NodeTest[] {
  const { node, candidates, proof, runs, findings, diffs } = input
  if (node.kind === 'test') return []
  const covering = input.definitions.filter((definition) => definition.anchors.some((anchor) => anchor.id === node.id))
  const inFile = (path: string) => covering.filter((definition) => definition.path === path)
  const tests: NodeTest[] = []
  const add = (path: string, found: NodeTest['found'], lifecycle: boolean, why: string | undefined, picked: boolean) => {
    const definitions = inFile(path)
    const first = definitions[0]
    const relation = relationOf(path, definitions, input)
    const diff = diffs.find((file) => file.path === path)
    const weakened = relation === 'edited' && diff && definitions.length ? weakenedIn(diff, definitions.map((definition) => [definition.startLine, definition.endLine] as const)) : undefined
    const shows = picked ? showsOf(path, proof) : undefined
    tests.push({
      path,
      ...(first ? { symbol: first.symbol, line: first.startLine } : {}),
      relation,
      found,
      lifecycle,
      at_head: atHeadOf(path, runs, findings),
      ...(shows ? { shows } : {}),
      ...(why ? { why } : {}),
      ...(weakened ? { weakened } : {}),
    })
  }
  for (const candidate of candidates) add(candidate.path, candidate.found ?? 'scan', candidate.lifecycle, candidate.why, true)
  const picked = new Set(candidates.map((candidate) => candidate.path))
  for (const path of new Set(covering.map((definition) => definition.path))) {
    if (picked.has(path) || path === node.path) continue
    add(path, 'scan', input.isLifecycleTest(path), 'the scan links it; it was not among the tests run', false)
  }
  for (const gone of input.removed.filter((entry) => entry.names.includes(node.symbol))) {
    tests.push({ path: gone.path, symbol: gone.symbol, line: gone.base_line, relation: 'removed', found: 'diff', lifecycle: input.isLifecycleTest(gone.path) })
  }
  return tests.map((entry, index) => ({ entry, index })).sort((a, b) => RELATION_ORDER[a.entry.relation] - RELATION_ORDER[b.entry.relation] || a.index - b.index).map(({ entry }) => entry)
}
