/**
 * Passes 2 and 3 of preparing a review: what the host knows before any model is asked.
 * Units become nodes, and every node says in words what it is: a test names its test, what it covers and how it ran,
 * a helper the tests it serves, and code its most telling changed line. Pairing, certain references, what tests
 * import, the life cycle and changed dependencies become wires, and the spec becomes acceptance nodes. A node nothing
 * wires says why.
 */
import { parseSpec, type Spec, type SpecProof } from '../spec/parse.ts'
import { sideText, type Capture, type CapturedFile } from './capture.ts'
import { hashLines, splitLines } from './lines.ts'
import { testPaths } from './flow.ts'
import { extensionOf, fileName, fileRole } from './paths.ts'
import { cleanProse, count, listed } from './prose.ts'
import { declaredSignature } from './signature.ts'
import { HOST_TEXT_LIMIT, NO_SPEC_NOTICE, PROSE_LIMIT, SIZE_LIMIT, TITLE_LIMIT, type EdgeKind, type NodeIO, type NodeStatus, type ReviewAnchor, type ReviewEdge, type ReviewFile, type ReviewNode, type ReviewPath } from './types.ts'
import { codeIdentifiers, findDeclaration, importCandidates, importSpecifiers, mergeTestSupport, pairTests, prepareUnits, relativeImports, resolveImport, testsThatUse, unitReferences, type Unit, type UnitRange } from './units.ts'
import { addVicinity, type Vicinity } from './vicinity.ts'

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
  /** The unchanged code around the change, from a call-graph scan, when one could run. */
  vicinity?: Vicinity
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

/** A test's name in words: `def test_rounds_the_total` reads "rounds the total". */
export const testName = (symbol: string) => (/^test_\w/.test(symbol) ? symbol.slice('test_'.length).replace(/_+/g, ' ').trim() : symbol)

/** The changed lines a unit holds, removed before added, as `-` or `+` and the line. */
function changedRows(unit: Unit, file: CapturedFile, isChanged: ReturnType<typeof changedLookup>): { side: 'added' | 'deleted'; text: string }[] {
  const rows: { side: 'added' | 'deleted'; text: string }[] = []
  for (const side of ['deleted', 'added'] as const) {
    const source = splitLines(sideText(file, side))
    for (const range of unit.ranges.filter((entry) => entry.side === side)) {
      for (let line = range.startLine; line <= range.endLine; line += 1) if (isChanged(range.fileId, side, line)) rows.push({ side, text: source[line - 1] ?? '' })
    }
  }
  return rows
}

/** A line that says nothing on its own: blank, a bracket, a comment, an import. */
const SAYS_LITTLE = /^\s*(?:[{}()[\];,]*|end|\*\/|\/\*.*|\/\/.*|#.*|\*.*|(?:import|export)\s.*\bfrom\b.*|import\s.*|require\(.*|require_relative\s.*)\s*$/

/**
 * The changed line that tells most about a unit, as `+ line` or `- line`: an added line that does something first, a
 * removed one when nothing was added. Imports, comments and brackets come last, and only when nothing else changed.
 */
export function tellingLine(rows: readonly { side: 'added' | 'deleted'; text: string }[]): string | null {
  const score = (row: { side: 'added' | 'deleted'; text: string }) =>
    (SAYS_LITTLE.test(row.text) ? 0 : 4) + (row.side === 'added' ? 2 : 0) + (/[(=:]/.test(row.text) ? 1 : 0)
  let best: { side: 'added' | 'deleted'; text: string } | undefined
  for (const row of rows) if (row.text.trim() && (!best || score(row) > score(best))) best = row
  return best ? `${best.side === 'added' ? '+' : '-'} ${best.text.trim()}` : null
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

  // What changed, in its own most telling line: the card shows the counts already.
  const line = tellingLine(changedRows(unit, file, isChanged))
  let summary = line ?? 'Only blank lines changed.'
  if (unit.summarized) summary = `Shown whole: this change is over the size limits.${line ? ` ${line}` : ''}`

  return {
    id: unit.id,
    kind,
    title: cleanProse(named ? (testCase ? testName(unit.symbol) : unit.symbol) : fileName(unit.path), TITLE_LIMIT),
    subtitle: unit.path,
    change: kind === 'file' ? fileChange(file) : change,
    stats: { additions, deletions },
    summary: cleanProse(summary, PROSE_LIMIT.summary),
    ...(status ? { status } : {}),
    ...(unit.supports ? { supports: [...unit.supports] } : {}),
    anchors: unit.ranges.map((range) => anchorOf(sideText(file, range.side), range)),
    position: { x: 0, y: 0 },
  }
}

/** A file's change as a node reports it: added or deleted as it is, anything else modified. */
function fileChange(file: CapturedFile): ReviewNode['change'] {
  if (file.status === 'added') return 'added'
  if (file.status === 'deleted') return 'deleted'
  return 'modified'
}

function wholeFileSummary(file: CapturedFile): string {
  if (file.skipped) return 'Not read: this change is over the size limits.'
  if (file.binary) return 'A binary file. Its contents are not shown.'
  if (file.status === 'renamed') return `Renamed from ${file.oldPath}. Its contents did not change.`
  if (file.status === 'deleted') return 'Removed in this change. It was empty.'
  if (file.status === 'added') return 'New in this change. It is empty.'
  return 'Changed without a changed line, such as its file mode.'
}

/** A file with no lines to show: binary, empty, or only renamed. It is still part of the change, so it is still a node. */
function wholeFileNode(id: string, file: CapturedFile): ReviewNode {
  return {
    id,
    kind: 'file',
    title: fileName(file.path),
    subtitle: file.path,
    change: fileChange(file),
    stats: { additions: file.additions, deletions: file.deletions },
    summary: wholeFileSummary(file),
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
  // What goes in and out of each changed declaration, from its parameters and return type.
  units.forEach((unit, index) => {
    if (unit.role !== 'code' || unit.loose || unit.summarized) return
    const side = unit.ranges.some((range) => range.side === 'added') ? 'added' : 'deleted'
    const io = declaredSignature(sideText(fileOf.get(unit.fileId)!, side), unit.symbol)
    if (io && (io.in || io.out)) nodes[index]!.io = io
  })
  const covered = new Set(units.map((unit) => unit.fileId))
  let whole = 0
  for (const file of capture.files) if (!covered.has(file.id)) nodes.push(wholeFileNode(`f${(whole += 1)}`, file))

  const edges: ReviewEdge[] = []
  const candidates: CandidateWire[] = []
  const wired = new Set<string>()
  const wire = (kind: EdgeKind, from: string, to: string, label?: string) => {
    if (wired.has(`${from}>${to}`)) return
    wired.add(`${from}>${to}`)
    edges.push({ id: edgeId(kind, from, to), from, to, kind, ...(label ? { label } : {}), certainty: 'host' })
  }

  const merged = new Set(units.map((unit) => unit.id))
  for (const [test, code] of pairTests(extracted)) if (merged.has(test)) wire('exercises', test, code)
  for (const unit of units) {
    if (unit.role === 'file') continue
    for (const reference of unitReferences(unit, extracted, capture)) {
      // A test reaches what it names for certain as code does: by the same file, or by a name it imports from it.
      if (reference.certain) wire(unit.role === 'test' ? 'exercises' : reference.kind, unit.id, reference.to)
      else if (!wired.has(`${unit.id}>${reference.to}`)) candidates.push({ from: unit.id, to: reference.to, kind: unit.role === 'test' ? 'exercises' : reference.kind })
    }
  }

  if (input.vicinity) notices.push(...(await addVicinity(input.vicinity, { capture, nodes, files, headFiles, readHead: input.readHead, wire })))
  await wireTests({ capture, nodes, readHead: input.readHead, vicinity: input.vicinity, wire, edges })
  wireDependencies({ capture, nodes, isChanged, wire })

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

  // Every wire is drawn: each test says what it covers, each helper whom it serves, and a node nothing wires says why.
  describeTests({ nodes, edges, capture, helpers: new Set(units.filter((unit) => unit.helper).map((unit) => unit.id)), vicinity: input.vicinity })
  markUnwired(nodes, edges)

  // Acceptance lines lead the list, as they lead the graph.
  const order = { criterion: 0, test: 1, code: 2, file: 3, context: 4 } as const
  nodes.sort((a, b) => order[a.kind] - order[b.kind])
  return { input, spec, files, nodes, edges, candidates, notices, headFiles }
}

type Wire = (kind: EdgeKind, from: string, to: string, label?: string) => void

/** The node of a kind whose lines at head hold a line of a file. */
function holderAt(nodes: readonly ReviewNode[], kinds: readonly ReviewNode['kind'][], path: string, line: number): ReviewNode | undefined {
  return nodes.find((node) => kinds.includes(node.kind) && node.anchors.some((anchor) => anchor.fileId === path && anchor.side === 'added' && anchor.startLine <= line && line <= anchor.endLine))
}

/** The most unchanged modules a review reads to follow what a test imports, so a large test suite stays quick. */
const MOST_MODULES = 40

/**
 * Wires each changed test to the changed code it reaches: through what its file imports, directly or through an
 * unchanged module that loads it (a test importing `index.ts` reaches what `index.ts` loads), and through what the
 * call-graph scan says it uses.
 */
async function wireTests({ capture, nodes, readHead, vicinity, wire, edges }: { capture: Capture; nodes: ReviewNode[]; readHead: (path: string) => Promise<string | null>; vicinity?: Vicinity; wire: Wire; edges: readonly ReviewEdge[] }) {
  const changed = new Set(capture.files.map((file) => file.path))
  const fileOf = new Map(capture.files.map((file) => [file.path, file]))
  const subjectsIn = (path: string) => nodes.filter((node) => (node.kind === 'code' || node.kind === 'file') && node.subtitle === path)
  const reads = new Map<string, Promise<string | null>>()
  const read = (path: string) => {
    if (!reads.has(path)) reads.set(path, reads.size < MOST_MODULES ? readHead(path) : Promise.resolve(null))
    return reads.get(path)!
  }
  /** The unchanged module a path names, and its text, when it is there at head. */
  const unchangedModule = async (from: string, specifier: string): Promise<{ path: string; text: string } | null> => {
    for (const path of importCandidates(from, specifier).slice(0, 4)) {
      const text = await read(path)
      if (text != null) return { path, text }
    }
    return null
  }

  const tests = nodes.filter((node) => node.kind === 'test' && node.change !== 'unchanged' && node.subtitle)
  for (const path of new Set(tests.map((node) => node.subtitle!))) {
    const text = fileOf.get(path)?.head
    if (text == null) continue
    const reached = new Map<string, string>()
    for (const specifier of relativeImports(text)) {
      const direct = resolveImport(path, specifier, (candidate) => changed.has(candidate))
      if (direct) {
        reached.set(direct, `imports ${direct}`)
        continue
      }
      const module = await unchangedModule(path, specifier)
      for (const next of module ? relativeImports(module.text) : []) {
        const target = resolveImport(module!.path, next, (candidate) => changed.has(candidate))
        if (target && !reached.has(target)) reached.set(target, `imports it through ${fileName(module!.path)}`)
      }
    }
    for (const test of tests.filter((node) => node.subtitle === path)) {
      for (const [target, label] of reached) {
        if (fileRole(target) === 'test') continue
        const subjects = subjectsIn(target)
        if (subjects.some((subject) => edges.some((edge) => edge.from === test.id && edge.to === subject.id))) continue
        for (const subject of subjects.slice(0, 3)) wire('exercises', test.id, subject.id, cleanProse(label, PROSE_LIMIT.label))
      }
    }
  }
  for (const { test, changed: at } of vicinity?.tests ?? []) {
    const from = holderAt(nodes, ['test'], test.path, test.line)
    const to = holderAt(nodes, ['code'], at.path, at.line)
    if (from && to) wire('exercises', from.id, to.id)
  }
}

/** A manifest's lockfiles, in the same folder. */
const LOCKFILES: Record<string, readonly string[]> = {
  'package.json': ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'],
  Gemfile: ['Gemfile.lock'],
  'Cargo.toml': ['Cargo.lock'],
  'pyproject.toml': ['poetry.lock', 'uv.lock'],
  Pipfile: ['Pipfile.lock'],
  'composer.json': ['composer.lock'],
  'go.mod': ['go.sum'],
  'mix.exs': ['mix.lock'],
}

/** The packages whose version a package.json change moves, added or removed, with the version on each side. */
export function changedPackages(base: string | null, head: string | null): Map<string, { from?: string; to?: string }> {
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const
  // Each section on its own: a package can be a peer at any version and a development dependency at a pinned one.
  const read = (text: string | null): Map<string, string> => {
    try {
      const parsed = JSON.parse(text ?? '{}') as Record<string, Record<string, unknown> | undefined>
      return new Map(sections.flatMap((section) => Object.entries(parsed[section] ?? {}).flatMap(([name, version]) => (typeof version === 'string' ? [[`${section}\u0000${name}`, version] as const] : []))))
    } catch {
      return new Map()
    }
  }
  const [before, after] = [read(base), read(head)]
  const moved = new Map<string, { from?: string; to?: string }>()
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const name = key.split('\u0000')[1]!
    const [from, to] = [before.get(key), after.get(key)]
    if (from !== to && !moved.has(name)) moved.set(name, { ...(from ? { from } : {}), ...(to ? { to } : {}) })
  }
  return moved
}

/** The moved package a node's changed lines use: one they import from it, or a line that imports it. */
function packageUsed(node: ReviewNode, packages: ReadonlyMap<string, unknown>, fileOf: ReadonlyMap<string, CapturedFile>, isChanged: ReturnType<typeof changedLookup>): string | null {
  const own = (specifier: string) => [...packages.keys()].find((name) => specifier === name || specifier.startsWith(`${name}/`))
  for (const anchor of node.anchors) {
    const file = fileOf.get(anchor.fileId)
    if (!file) continue
    const text = sideText(file, anchor.side)
    const from = new Map([...importSpecifiers(text)].flatMap(([name, specifier]) => {
      const owner = own(specifier)
      return owner ? [[name, owner] as const] : []
    }))
    const lines = splitLines(text)
    for (let line = anchor.startLine; line <= anchor.endLine; line += 1) {
      if (!isChanged(anchor.fileId, anchor.side, line)) continue
      const said = lines[line - 1] ?? ''
      const loaded = /(?:from|require\(|import\()\s*['"]([^'"]+)['"]/.exec(said)?.[1]
      if (loaded && own(loaded)) return own(loaded)!
      for (const name of codeIdentifiers(said)) if (from.has(name)) return from.get(name)!
    }
  }
  return null
}

/**
 * Wires a manifest to its lockfile, and to the code and tests that use a package whose version it moves: a test that
 * only changed because a dependency renamed something is tied to the change that renamed it.
 */
function wireDependencies({ capture, nodes, isChanged, wire }: { capture: Capture; nodes: ReviewNode[]; isChanged: ReturnType<typeof changedLookup>; wire: Wire }) {
  const fileOf = new Map(capture.files.map((file) => [file.id, file]))
  const nodeOf = (path: string) => nodes.find((node) => (node.kind === 'file' || node.kind === 'code') && node.subtitle === path)
  for (const file of capture.files) {
    const name = fileName(file.path)
    const folder = file.path.slice(0, file.path.length - name.length)
    const manifest = LOCKFILES[name] ? nodeOf(file.path) : undefined
    if (!manifest) continue
    for (const lockfile of LOCKFILES[name]!) {
      const lock = nodeOf(`${folder}${lockfile}`)
      if (!lock) continue
      wire('configures', lock.id, manifest.id, 'lockfile for')
      lock.summary = `The lockfile for ${file.path}: it pins what that file asks for.`
    }
    if (name !== 'package.json') continue
    const packages = changedPackages(file.base, file.head)
    if (packages.size === 0) continue
    manifest.summary = cleanProse(`Moves ${listed([...packages].slice(0, 3).map(([pkg, { from, to }]) => `${pkg} ${from ? `from ${from} ` : ''}to ${to ?? 'nothing'}`))}${packages.size > 3 ? `, and ${count(packages.size - 3, 'more package')}` : ''}.`, PROSE_LIMIT.summary)
    for (const node of nodes.filter((entry) => (entry.kind === 'code' || entry.kind === 'test') && entry.change !== 'unchanged')) {
      const pkg = packageUsed(node, packages, fileOf, isChanged)
      if (!pkg) continue
      const { from, to } = packages.get(pkg)!
      if (node.kind === 'code') wire('configures', manifest.id, node.id, cleanProse(`${pkg} ${from ?? 'new'} → ${to ?? 'gone'}`, PROSE_LIMIT.label))
      else wire('exercises', node.id, manifest.id, cleanProse(`uses ${pkg}${to ? ` ${to}` : ''}`, PROSE_LIMIT.label))
    }
  }
}

/** A few names, quoted: `"a", "b" and 3 more`. */
function some(names: readonly string[], shown = 2): string {
  const quoted = names.slice(0, shown).map((name) => `"${name}"`)
  return names.length > shown ? `${quoted.join(', ')} and ${names.length - shown} more` : listed(quoted)
}

const RESULT_WORDS: Partial<Record<NodeStatus, string>> = { passed: 'It passed.', failed: 'It failed.', 'not-run': 'Not run yet.', 'proves-change': 'It proves the change.' }

/** What a test covers, in words, from its wires: the code it reaches by name, else the package it changed with. */
export function testCovers(nodes: readonly ReviewNode[], edges: readonly ReviewEdge[], test: ReviewNode): { said: string; reaches: boolean } {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const out = edges.filter((edge) => edge.from === test.id && edge.kind === 'exercises')
  const subjects = [...new Set(out.map((edge) => byId.get(edge.to)).filter((entry): entry is ReviewNode => entry != null && entry.kind !== 'file').map((entry) => entry.title))]
  const packages = out.filter((edge) => byId.get(edge.to)?.kind === 'file' && edge.label?.startsWith('uses ')).map((edge) => edge.label!.slice('uses '.length))
  if (subjects.length) return { said: `Covers ${listed(subjects.slice(0, 3))}${subjects.length > 3 ? ` and ${count(subjects.length - 3, 'more')}` : ''}.`, reaches: true }
  if (packages.length) return { said: `Changed with ${packages[0]}.`, reaches: true }
  return { said: 'It reaches none of the code this change touched.', reaches: false }
}

/**
 * The words of every changed test, once every wire is drawn: a test case says what it covers and how it ran, and a
 * helper says it is one, which tests use it, what it covers and what changed in it.
 */
function describeTests({ nodes, edges, capture, helpers, vicinity }: { nodes: ReviewNode[]; edges: readonly ReviewEdge[]; capture: Capture; helpers: ReadonlySet<string>; vicinity?: Vicinity }) {
  const fileOf = new Map(capture.files.map((file) => [file.path, file]))
  for (const node of nodes.filter((entry) => entry.kind === 'test' && entry.change !== 'unchanged')) {
    const { said: covers, reaches } = testCovers(nodes, edges, node)
    if (!helpers.has(node.id)) {
      node.summary = cleanProse(`${covers} ${RESULT_WORDS[node.status ?? 'not-run'] ?? ''}`, PROSE_LIMIT.summary)
      continue
    }
    // Who uses the helper: the tests in its own file that call it, and those elsewhere the scan saw use it.
    const text = node.subtitle ? fileOf.get(node.subtitle)?.head : null
    const own = text != null ? testsThatUse(text, node.title) : []
    const elsewhere = (vicinity?.tests ?? []).filter((link) => link.test.path !== node.subtitle && node.anchors.some((anchor) => anchor.fileId === link.changed.path && anchor.side === 'added' && anchor.startLine <= link.changed.line && link.changed.line <= anchor.endLine)).map((link) => link.test.symbol)
    const users = [...new Set([...own, ...elsewhere])]
    const used = users.length ? `A test helper, used by ${count(users.length, 'test')}: ${some(users)}.` : 'A test helper no test calls by name.'
    node.summary = cleanProse(`${used} ${reaches ? `${covers} ` : ''}${node.summary}`, PROSE_LIMIT.summary)
  }
}

/** Why nothing wires a node, in a few words, by what it is. */
function unwiredWhy(node: ReviewNode): string {
  if (node.kind === 'criterion') return 'No test in this change proves it.'
  if (node.kind === 'test') return node.supports?.length ? 'A helper of the tests beside it: it reaches none of the code this change touched.' : 'It reaches none of the code this change touched.'
  if (node.kind === 'file' && ['md', 'markdown', 'txt', 'rst', 'adoc'].includes(extensionOf(node.subtitle ?? ''))) return 'Documentation: no code in this change reads it.'
  if (node.kind === 'file') return 'Nothing in this change reads it.'
  return 'No test or code in this change reaches it.'
}

/** A node still without a wire says why, so the graph can set it apart with its reason. */
function markUnwired(nodes: ReviewNode[], edges: readonly ReviewEdge[]) {
  const linked = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
  for (const node of nodes) {
    if (node.kind === 'context' || linked.has(node.id)) delete node.unwired
    else node.unwired = unwiredWhy(node)
  }
}

export interface ModelRequest {
  change: { title: string; risk?: string }
  spec: { outcome: string; acceptance: { id: string; text: string }[]; steps: { id: string; serves: string[]; text: string }[]; outOfScope: string[]; openQuestions: string[] } | null
  /**
   * Every node the host prepared. `changes` holds its changed lines, removed before added. `io` is what the host read
   * from the declaration, and `code` the first lines of an unchanged context node.
   */
  nodes: { id: string; kind: string; path: string; title: string; changes: string; io?: NodeIO; code?: string; status?: NodeStatus; warning?: string }[]
  /** Wires the host already drew. */
  wires: CandidateWire[]
  /** Connections the host saw by name and could not confirm. */
  candidates: CandidateWire[]
  /** Each test's path through the code, along the host's wires. */
  paths: ReviewPath[]
}

/** How many lines of an unchanged context node the model reads. */
const CONTEXT_LINES = 12

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
    change: { title: draft.input.change.title, ...(draft.input.change.risk ? { risk: draft.input.change.risk } : {}) },
    spec: draft.spec && {
      outcome: draft.spec.outcome,
      acceptance: draft.spec.acceptance.filter((line) => !line.retired).map(({ id, text }) => ({ id, text })),
      steps: draft.spec.steps.filter((step) => !step.retired).map(({ id, serves, text }) => ({ id, serves, text })),
      outOfScope: draft.spec.outOfScope,
      openQuestions: draft.spec.openQuestions,
    },
    nodes: draft.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      path: node.subtitle ?? '',
      title: node.title,
      changes: node.kind === 'criterion' || node.kind === 'context' ? '' : changesOf(node),
      ...(node.io ? { io: node.io } : {}),
      ...(node.kind === 'context' ? { code: contextCode(node) } : {}),
      ...(node.status ? { status: node.status } : {}),
      ...(node.warning ? { warning: node.warning } : {}),
    })),
    wires: draft.edges.map(({ from, to, kind }) => ({ from, to, kind })),
    candidates: draft.candidates,
    paths: testPaths(draft.nodes, draft.edges),
  }

  function contextCode(node: ReviewNode): string {
    const anchor = node.anchors[0]
    const text = anchor && (fileOf.get(anchor.fileId)?.head ?? draft.headFiles.get(anchor.fileId))
    if (!anchor || text == null) return ''
    return splitLines(text)
      .slice(anchor.startLine - 1, Math.min(anchor.endLine, anchor.startLine - 1 + CONTEXT_LINES))
      .map((line) => line.slice(0, 200))
      .join('\n')
  }
}
