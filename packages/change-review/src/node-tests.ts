/**
 * The tests that cover a changed part (spec 055): each one with how it relates to the change (there before, added,
 * edited or removed), how it was found, how it did at the change's commit and what it showed when the part was
 * changed. What the proof worked out for each test file is kept here instead of only in the proof's one sentence, so
 * a reviewer sees what covered the code before the change, and whether the change took any of it away. Removed tests
 * are read from the diff's test hunks, by text: the pack does not list them.
 */
import type { NodeProof, TestCandidate } from './proof.ts'
import { caseOutcome } from './test-case.ts'
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

/** The test a line starts, at its base line: its name, its indentation, and whether it is a Python `def test_`. */
function startedAt(text: string, line: number): Started | null {
  const start = TEST_START.exec(text)
  if (!start) return null
  return { name: start[3] ?? start[4]!, line, indent: start[1]!.length, python: Boolean(start[4]), body: [text] }
}

/** Whether a removed line ends an open block: a Python block where the indentation falls back, any other at its closing line. */
function endsBlock(block: Started, text: string): boolean {
  if (indentOf(text) > block.indent) return false
  return block.python ? text.trim() !== '' : BLOCK_END.test(text)
}

/** The test blocks a hunk removes whole: their start line is removed, and so is what follows it up to their end. */
function removedBlocks(lines: readonly string[], oldStart: number): Started[] {
  const blocks: Started[] = []
  let open: Started | null = null
  let at = oldStart
  for (const raw of lines) {
    const side = raw[0]
    const text = raw.slice(1)
    if (side !== '-') open = null
    else if (open && !endsBlock(open, text)) open.body.push(text)
    else {
      // A closing `})` or `end` is the block's last line; a Python block ends before the line that falls back.
      if (open && !open.python) open.body.push(text)
      open = startedAt(text, at)
      if (open) blocks.push(open)
    }
    if (side !== '+') at += 1
  }
  return blocks
}

/** The names of the tests a hunk adds or keeps: a test removed and written again under its name was edited, not removed. */
function testsKept(lines: readonly string[]): Set<string> {
  const kept = lines.filter((line) => line[0] !== '-').flatMap((line) => startedAt(line.slice(1), 0) ?? [])
  return new Set(kept.map((test) => test.name))
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
  const baseline = runs.filter((run) => run.kind === 'baseline' && !run.node && run.tests.includes(path))
  const ran = baseline.find((run) => run.tests.length === 1) ?? baseline[0]
  if (!ran || ran.not_run) return 'not-run'
  return ran.failed.includes(path) ? 'failed' : 'passed'
}

/** What a test file showed with the part changed, by what the proof worked out for each file. */
function showsOf(path: string, proof: NodeProof | undefined): NodeTest['shows'] {
  if (!proof) return undefined
  if (proof.observedBy.includes(path)) return proof.doubles.some((double) => double.startsWith(`${path}:`)) ? 'mocks' : 'proves'
  if (proof.reachedBy.includes(path) || proof.reachedByCallers?.includes(path)) return 'reaches'
  if (proof.stillPass.includes(path)) return 'still-passes'
  return undefined
}

/** A test file's relation to the change by its status, or undefined for a changed file, whose tests each say their own. */
function fileRelation(status: FileStatus | undefined): NodeTest['relation'] | undefined {
  if (!status) return 'before'
  if (status === 'added' || status === 'copied') return 'added'
  if (status === 'deleted') return 'removed'
  return undefined
}

/** A covering test's own relation in a changed file: unchanged is before; changed is added when it is new, else edited. */
function definitionRelation(definition: TestDefinition, input: NodeTestsInput): NodeTest['relation'] {
  if (!definition.changed) return 'before'
  const isNew = input.testAnchors.find((anchor) => anchor.id === definition.id)?.status === 'added'
  return isNew ? 'added' : 'edited'
}

/** The reason a candidate gets when this diff changed its file and the file names the definition (proof.ts). */
const CHANGED_REASON = /^this diff changed it and it names /

/**
 * A covering test's own reason in a changed file: the file's reasons, with what this diff did to this test. The file's
 * "this diff changed it" is no reason of a test it did not change, nor the words for one it added.
 */
function definitionWhy(reasons: readonly string[], relation: NodeTest['relation']): string {
  const kept = reasons.filter((reason) => !CHANGED_REASON.test(reason))
  if (relation === 'before') return [...kept, 'this diff did not change it'].join('; ')
  if (relation === 'added') return [...kept, 'this diff added it'].join('; ')
  return kept.length < reasons.length ? reasons.join('; ') : [...reasons, 'this diff edited it'].join('; ')
}

/** A file found by its name alone, in a changed file, where no test names the part: the file was edited, not a test of the part. */
function conventionWhy(reasons: readonly string[], symbol: string): string {
  const named = reasons.map((reason) => `${reason}, found by its file's name`)
  return [...named, `this diff edited the file, and no test in it was found to name ${symbol}`].join('; ')
}

/** How a test file came to cover the part: how it was found, whether it is a life-cycle test, why, and whether the proof ran it for the part. */
interface Found {
  found: NodeTest['found']
  lifecycle: boolean
  why?: string
  picked: boolean
}

/**
 * The tests of one test file that cover the part: one for each test definition the scan says covers it, each with its
 * own relation to the change, plus the file's aggregate result. Named cases use only local failure receipts;
 * a green file cannot establish that any particular case ran.
 */
function fileTests(path: string, how: Found, definitions: readonly TestDefinition[], input: NodeTestsInput): NodeTest[] {
  const byFile = fileRelation(input.status(path))
  const diff = input.diffs.find((file) => file.path === path)
  const shows = how.picked ? showsOf(path, input.proof) : undefined
  const shared = {
    found: how.found,
    lifecycle: how.lifecycle,
    at_head: atHeadOf(path, input.runs, input.findings),
    ...(shows ? { shows } : {}),
  }
  const reasons = how.why ? how.why.split('; ') : []
  if (!definitions.length) {
    const byName = byFile === undefined && how.found === 'convention' && reasons.length > 0 && reasons.every((reason) => reason.startsWith('named after '))
    const why = byName ? conventionWhy(reasons, input.node.symbol) : how.why
    return [{ path, relation: byFile ?? 'edited', ...shared, ...(why ? { why } : {}) }]
  }
  const file: NodeTest = { path, relation: byFile ?? 'edited', ...shared, ...(how.why ? { why: how.why } : {}) }
  return [file, ...definitions.map((definition): NodeTest => {
    const relation = byFile ?? definitionRelation(definition, input)
    // In a file the diff did not touch or that it added whole, the file's reasons are each test's.
    const why = byFile === undefined && reasons.length ? definitionWhy(reasons, relation) : how.why
    const weakened = relation === 'edited' && diff ? weakenedIn(diff, [[definition.startLine, definition.endLine]]) : undefined
    const uniqueName = input.definitions.filter((item) => item.path === path && item.symbol === definition.symbol).length === 1
    const receipt = (run: TestRun) => caseOutcome(run, path, uniqueName ? definition.symbol : undefined)
    const failedHere = (run: TestRun) => {
      const outcome = receipt(run)
      if (outcome) return outcome === 'failed'
      return !run.not_run && run.failed.includes(path) && run.failed_at?.some((at) => at.path === path && definition.startLine <= at.line && at.line <= definition.endLine)
    }
    const baselines = input.runs.filter((run) => run.kind === 'baseline' && !run.node && run.tests.includes(path))
    const failed = baselines.some(failedHere)
    const atHead = failed ? 'failed' : baselines.some((run) => receipt(run) === 'passed') ? 'passed' : 'not-run'
    const mutation = how.picked && input.runs.some((run) => run.node === input.node.id && ['revert', 'probe'].includes(run.kind) && failedHere(run))
    const reach = how.picked && input.runs.some((run) => run.node === input.node.id && run.kind === 'reach' && failedHere(run))
    const caseShows = mutation && (shows === 'proves' || shows === 'mocks') ? shows : reach ? 'reaches' as const : undefined
    return { path, symbol: definition.symbol, line: definition.startLine, relation, found: how.found, lifecycle: how.lifecycle, at_head: atHead, ...(caseShows ? { shows: caseShows } : {}), ...(why ? { why } : {}), ...(weakened ? { weakened } : {}) }
  })]
}

/**
 * The tests that cover a part: the files its proof picked, each with what it showed; the tests the scan links that
 * the proof did not pick, as not run; and the tests the change removes that name it. The older first.
 */
export function nodeTestsOf(input: NodeTestsInput): NodeTest[] {
  const { node, candidates } = input
  if (node.kind === 'test') return []
  const covering = input.definitions.filter((definition) => definition.anchors.some((anchor) => anchor.id === node.id))
  const inFile = (path: string) => covering.filter((definition) => definition.path === path)

  const picked = candidates.flatMap((candidate) =>
    fileTests(candidate.path, { found: candidate.found ?? 'scan', lifecycle: candidate.lifecycle, why: candidate.why, picked: true }, inFile(candidate.path), input),
  )
  const pickedPaths = new Set(candidates.map((candidate) => candidate.path))
  const unpicked = [...new Set(covering.map((definition) => definition.path))]
    .filter((path) => !pickedPaths.has(path) && path !== node.path)
    .flatMap((path) => fileTests(path, { found: 'scan', lifecycle: input.isLifecycleTest(path), why: 'the scan links it; it was not among the tests run', picked: false }, inFile(path), input))
  const removed = input.removed
    .filter((entry) => entry.names.includes(node.symbol))
    .map((gone): NodeTest => ({ path: gone.path, symbol: gone.symbol, line: gone.base_line, relation: 'removed', found: 'diff', lifecycle: input.isLifecycleTest(gone.path) }))

  const tests = [...picked, ...unpicked, ...removed]
  // Stable: within a relation, the order they were found in.
  return tests
    .map((test, index) => ({ test, index }))
    .sort((a, b) => RELATION_ORDER[a.test.relation] - RELATION_ORDER[b.test.relation] || a.index - b.index)
    .map(({ test }) => test)
}
