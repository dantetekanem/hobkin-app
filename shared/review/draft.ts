/**
 * Passes 2 and 3 of preparing a review: what the host knows before any model is asked.
 * Units become nodes, pairing and certain references become wires, and the spec becomes acceptance nodes.
 */
import { parseSpec, type Spec, type SpecProof } from '../spec/parse.ts'
import { sideText, type Capture, type CapturedFile } from './capture.ts'
import { hashLines, splitLines } from './lines.ts'
import { fileName } from './paths.ts'
import { cleanProse, count } from './prose.ts'
import { HOST_TEXT_LIMIT, NO_SPEC_NOTICE, SIZE_LIMIT, TITLE_LIMIT, type EdgeKind, type NodeStatus, type ReviewAnchor, type ReviewEdge, type ReviewFile, type ReviewNode } from './types.ts'
import { findDeclaration, mergeTestSupport, pairTests, prepareUnits, unitReferences, type Unit, type UnitRange } from './units.ts'

export interface PrepareInput {
  id: string
  change: { project: string; item: string; title: string; branch: string; risk?: string }
  capture: Capture
  /** The change's `spec.md` at head, or null when it has none. */
  spec: { path: string; text: string } | null
  /** A file at head that is not part of the change: context the model found, or a test a Proof line names. */
  readHead(path: string): Promise<string | null>
  /** Test results from the item's proof, keyed `path › name`. A test that is not named counts as not run. */
  results?: Readonly<Record<string, 'passed' | 'failed'>>
}

/** A connection the host saw by name but could not confirm. The model may propose it. */
export interface CandidateWire {
  from: string
  to: string
  kind: EdgeKind
}

export interface Draft {
  input: PrepareInput
  spec: Spec | null
  files: ReviewFile[]
  /** Nodes with their anchors and facts. Positions are set when the review is completed. */
  nodes: ReviewNode[]
  /** Wires the host derived. */
  edges: ReviewEdge[]
  candidates: CandidateWire[]
  notices: string[]
  /** Unchanged files at head the review points into, by path. */
  headFiles: Map<string, string>
}

export const edgeId = (kind: EdgeKind, from: string, to: string) => `${kind}:${from}>${to}`

export function anchorOf(text: string, range: UnitRange): ReviewAnchor {
  return { fileId: range.fileId, side: range.side, startLine: range.startLine, endLine: range.endLine, hash: hashLines(text, range.startLine, range.endLine) }
}

export const unchangedFile = (path: string): ReviewFile => ({ id: path, path, status: 'unchanged', binary: false, additions: 0, deletions: 0, summarized: false })

function changeSentence(additions: number, deletions: number): string {
  const parts = [additions > 0 ? `${count(additions, 'line')} added` : '', deletions > 0 ? `${count(deletions, 'line')} removed` : ''].filter(Boolean)
  return parts.length > 0 ? `${parts.join(' and ')}.` : 'No lines changed.'
}

/** Which lines of the capture changed, for asking about one line at a time. */
function changedLookup(capture: Capture): (fileId: string, side: 'added' | 'deleted', line: number) => boolean {
  const changed = new Map<string, Set<number>>()
  for (const change of capture.changes) {
    const key = `${change.side}:${change.fileId}`
    if (!changed.has(key)) changed.set(key, new Set())
    for (let line = change.startLine; line <= change.endLine; line += 1) changed.get(key)!.add(line)
  }
  return (fileId, side, line) => changed.get(`${side}:${fileId}`)?.has(line) ?? false
}

function unitNode(unit: Unit, file: CapturedFile, isChanged: ReturnType<typeof changedLookup>, results: PrepareInput['results']): ReviewNode {
  let additions = 0
  let deletions = 0
  // A unit is new when every line it holds was added, and gone when every line was removed. Blank lines do not count:
  // a diff may hand the empty line between two functions to either of them.
  let untouched = false
  for (const range of unit.ranges) {
    const text = splitLines(sideText(file, range.side))
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      if (isChanged(range.fileId, range.side, line)) {
        if (range.side === 'added') additions += 1
        else deletions += 1
      } else if ((text[line - 1] ?? '').trim()) untouched = true
    }
  }
  const sides = new Set(unit.ranges.map((range) => range.side))
  const change = untouched || sides.size > 1 ? 'modified' : sides.has('added') ? 'added' : 'deleted'
  const kind = unit.role
  const testCase = kind === 'test' && !unit.helper && !unit.loose
  const named = !unit.loose && kind !== 'file'
  const status: NodeStatus | undefined = testCase ? (results?.[`${unit.path} › ${unit.symbol}`] ?? 'not-run') : undefined

  let summary = change === 'added' ? `New in this change. ${changeSentence(additions, deletions)}` : change === 'deleted' ? `Removed in this change. ${changeSentence(additions, deletions)}` : changeSentence(additions, deletions)
  if (unit.summarized) summary = `Shown whole, without its parts, because this change is over the size limits. ${changeSentence(additions, deletions)}`

  return {
    id: unit.id,
    kind,
    title: cleanProse(named ? unit.symbol : fileName(unit.path), TITLE_LIMIT),
    subtitle: unit.path,
    change: kind === 'file' ? (file.status === 'added' ? 'added' : file.status === 'deleted' ? 'deleted' : 'modified') : change,
    stats: { additions, deletions },
    summary,
    ...(status ? { status } : {}),
    anchors: unit.ranges.map((range) => anchorOf(sideText(file, range.side), range)),
    position: { x: 0, y: 0 },
  }
}

/** A file with no lines to show: binary, empty, or only renamed. It is still part of the change, so it is still a node. */
function wholeFileNode(id: string, file: CapturedFile): ReviewNode {
  const summary = file.binary
    ? 'A binary file. Its contents are not shown.'
    : file.status === 'renamed'
      ? `Renamed from ${file.oldPath}. Its contents did not change.`
      : file.status === 'deleted'
        ? 'Removed in this change. It was empty.'
        : file.status === 'added'
          ? 'New in this change. It is empty.'
          : 'Changed without a changed line, such as its file mode.'
  return {
    id,
    kind: 'file',
    title: fileName(file.path),
    subtitle: file.path,
    change: file.status === 'added' ? 'added' : file.status === 'deleted' ? 'deleted' : 'modified',
    stats: { additions: 0, deletions: 0 },
    summary,
    anchors: [],
    position: { x: 0, y: 0 },
  }
}

export async function draftReview(input: PrepareInput): Promise<Draft> {
  const { capture } = input
  const fileOf = new Map(capture.files.map((file) => [file.id, file]))
  const files: ReviewFile[] = capture.files.map(({ id, path, oldPath, status, binary, additions, deletions, summarized }) => ({
    id,
    path,
    ...(oldPath ? { oldPath } : {}),
    status,
    binary,
    additions,
    deletions,
    summarized,
  }))
  const headFiles = new Map<string, string>()
  const notices: string[] = []

  // Pass 2: units, pairing and references.
  const extracted = prepareUnits(capture)
  const units = mergeTestSupport(extracted)
  const isChanged = changedLookup(capture)
  const nodes: ReviewNode[] = units.map((unit) => unitNode(unit, fileOf.get(unit.fileId)!, isChanged, input.results))
  const covered = new Set(units.map((unit) => unit.fileId))
  let whole = 0
  for (const file of capture.files) if (!covered.has(file.id)) nodes.push(wholeFileNode(`f${(whole += 1)}`, file))

  const edges: ReviewEdge[] = []
  const candidates: CandidateWire[] = []
  const wired = new Set<string>()
  const wire = (kind: EdgeKind, from: string, to: string) => {
    if (wired.has(`${from}>${to}`)) return
    wired.add(`${from}>${to}`)
    edges.push({ id: edgeId(kind, from, to), from, to, kind, certainty: 'host' })
  }

  const merged = new Set(units.map((unit) => unit.id))
  for (const [test, code] of pairTests(extracted)) if (merged.has(test)) wire('exercises', test, code)
  for (const unit of units) {
    if (unit.role === 'file') continue
    for (const reference of unitReferences(unit, extracted, capture)) {
      if (unit.role === 'test') {
        if (!wired.has(`${unit.id}>${reference.to}`)) candidates.push({ from: unit.id, to: reference.to, kind: 'exercises' })
      } else if (reference.certain) wire(reference.kind, unit.id, reference.to)
      else candidates.push({ from: unit.id, to: reference.to, kind: reference.kind })
    }
  }

  const summarized = capture.files.filter((file) => file.summarized).length
  if (summarized > 0) {
    notices.push(
      `${count(summarized, 'file is', 'files are')} summarized without ${summarized === 1 ? 'its' : 'their'} parts, because this change is over ${SIZE_LIMIT.files} files or ${SIZE_LIMIT.changedLines.toLocaleString('en-US')} changed lines.`,
    )
  }

  // Pass 3: the spec.
  let spec: Spec | null = null
  if (input.spec == null) notices.push(NO_SPEC_NOTICE)
  else {
    spec = parseSpec(input.spec.text)
    for (const problem of spec.problems) notices.push(`The spec does not follow its format. ${problem}`)
    if (!fileOf.has(input.spec.path)) {
      files.push(unchangedFile(input.spec.path))
      headFiles.set(input.spec.path, input.spec.text)
    }
    const specFile = fileOf.get(input.spec.path)
    const changedSpecLines = capture.changes.filter((change) => change.fileId === input.spec!.path && change.side === 'added')

    let unchangedTests = 0
    for (const line of spec.acceptance.filter((entry) => !entry.retired)) {
      const proof = spec.proof.find((entry) => entry.id === line.id)
      const node: ReviewNode = {
        id: line.id,
        kind: 'criterion',
        title: line.id,
        subtitle: input.spec.path,
        change: !specFile ? 'unchanged' : specFile.status === 'added' ? 'added' : changedSpecLines.some((change) => change.startLine <= line.endLine && line.line <= change.endLine) ? 'modified' : 'unchanged',
        summary: cleanProse(line.text, HOST_TEXT_LIMIT),
        status: 'proven',
        ...(proof ? { proof: cleanProse(proof.text, HOST_TEXT_LIMIT) } : {}),
        anchors: [anchorOf(input.spec.text, { fileId: input.spec.path, side: 'added', startLine: line.line, endLine: line.endLine })],
        position: { x: 0, y: 0 },
      }
      nodes.push(node)

      if (!proof) {
        node.status = 'unproven'
        node.warning = 'This line has no Proof line.'
        continue
      }
      if (proof.kind !== 'test') continue

      const changed = units.find((unit) => unit.role === 'test' && !unit.helper && !unit.loose && unit.path === proof.path && unit.symbol === proof.name)
      const known = changed?.id ?? nodes.find((entry) => entry.kind === 'test' && entry.change === 'unchanged' && entry.subtitle === proof.path && entry.title === proof.name)?.id
      const test = known ?? (await unchangedTest(proof, `t${unchangedTests + 1}`))
      if (test == null) {
        node.status = 'unproven'
        node.warning = `The Proof line names a test that does not exist: \`${proof.path}\` › "${proof.name}".`
        continue
      }
      if (typeof test !== 'string') {
        unchangedTests += 1
        nodes.push(test)
      }
      wire('proves', line.id, typeof test === 'string' ? test : test.id)
    }
  }

  /** A test a Proof line names that this change did not touch. It joins the graph when it is really there at head. */
  async function unchangedTest(proof: Extract<SpecProof, { kind: 'test' }>, id: string): Promise<ReviewNode | undefined> {
    const captured = fileOf.get(proof.path)
    const text = captured ? captured.head : (headFiles.get(proof.path) ?? (await input.readHead(proof.path)))
    if (text == null) return undefined
    const found = findDeclaration(text, proof.name, true)
    if (!found) return undefined
    if (!captured && !headFiles.has(proof.path)) {
      headFiles.set(proof.path, text)
      files.push(unchangedFile(proof.path))
    }
    return {
      id,
      kind: 'test',
      title: cleanProse(proof.name, TITLE_LIMIT),
      subtitle: proof.path,
      change: 'unchanged',
      stats: { additions: 0, deletions: 0 },
      summary: 'This test did not change. It is here because a Proof line names it.',
      status: input.results?.[`${proof.path} › ${proof.name}`] ?? 'not-run',
      anchors: [anchorOf(text, { fileId: proof.path, side: 'added', ...found })],
      position: { x: 0, y: 0 },
    }
  }

  // Acceptance lines lead the list, as they lead the graph.
  const order = { criterion: 0, test: 1, code: 2, file: 3, context: 4 } as const
  nodes.sort((a, b) => order[a.kind] - order[b.kind])
  return { input, spec, files, nodes, edges, candidates, notices, headFiles }
}

export interface ModelRequest {
  change: { title: string }
  spec: { outcome: string; acceptance: { id: string; text: string }[]; steps: { id: string; serves: string[]; text: string }[] } | null
  /** Every node the host prepared. `changes` holds its changed lines, removed before added. */
  nodes: { id: string; kind: string; path: string; title: string; changes: string }[]
  /** Wires the host already drew. */
  wires: CandidateWire[]
  /** Connections the host saw by name and could not confirm. */
  candidates: CandidateWire[]
}

/**
 * What the model is given: prepared ids, the wires already drawn, the candidate wires and the spec.
 * No line range and no hash leaves the host.
 */
export function modelRequest(draft: Draft): ModelRequest {
  const { capture } = draft.input
  const fileOf = new Map(capture.files.map((file) => [file.id, file]))
  const limit = Math.max(8, Math.min(60, Math.floor(2400 / Math.max(1, draft.nodes.length))))
  const sources = new Map<string, string[]>()
  const source = (fileId: string, side: 'added' | 'deleted') => {
    const key = `${side}:${fileId}`
    const file = fileOf.get(fileId)
    if (!sources.has(key)) sources.set(key, file ? splitLines(sideText(file, side)) : [])
    return sources.get(key)!
  }
  const changesOf = (node: ReviewNode) => {
    const rows: string[] = []
    for (const side of ['deleted', 'added'] as const) {
      for (const anchor of node.anchors.filter((entry) => entry.side === side)) {
        const text = source(anchor.fileId, side)
        for (const change of capture.changes) {
          if (change.fileId !== anchor.fileId || change.side !== side) continue
          for (let line = Math.max(change.startLine, anchor.startLine); line <= Math.min(change.endLine, anchor.endLine); line += 1) {
            rows.push(`${side === 'added' ? '+' : '-'} ${(text[line - 1] ?? '').slice(0, 200)}`)
          }
        }
      }
    }
    return rows.length <= limit ? rows.join('\n') : [...rows.slice(0, limit), `… ${rows.length - limit} more changed lines`].join('\n')
  }

  return {
    change: { title: draft.input.change.title },
    spec: draft.spec && {
      outcome: draft.spec.outcome,
      acceptance: draft.spec.acceptance.filter((line) => !line.retired).map(({ id, text }) => ({ id, text })),
      steps: draft.spec.steps.filter((step) => !step.retired).map(({ id, serves, text }) => ({ id, serves, text })),
    },
    nodes: draft.nodes.map((node) => ({ id: node.id, kind: node.kind, path: node.subtitle ?? '', title: node.title, changes: node.kind === 'criterion' ? '' : changesOf(node) })),
    wires: draft.edges.map(({ from, to, kind }) => ({ from, to, kind })),
    candidates: draft.candidates,
  }
}
