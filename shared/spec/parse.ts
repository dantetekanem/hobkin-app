/**
 * Reads a `spec.md` written in the format of `_specs/README.md`.
 *
 * The parser never throws on a malformed spec. It reads what it can and lists what does not follow
 * the format in `problems`, because Change Review shows a spec's gaps instead of refusing the change.
 */

export type SpecKind = 'work' | 'context'
export type SpecStatus = 'draft' | 'ready' | 'doing' | 'done' | 'dropped'

export interface SpecAcceptance {
  /** `A1`, `A2`. Never renumbered. */
  id: string
  text: string
  /** Struck through in the spec. The id stays so nothing is renumbered. */
  retired: boolean
  /** The lines it spans in the file, 1-based and inclusive, so a review can point at it. */
  line: number
  endLine: number
}

export type SpecProof =
  /** Names a test: the path, then `›`, then the test name. */
  | { id: string; kind: 'test'; path: string; name: string; text: string }
  /** Starts with `check:` and says what to look at. */
  | { id: string; kind: 'check'; text: string }
  /** Anything else, such as a pointer to another spec's acceptance line. */
  | { id: string; kind: 'other'; text: string }

export interface SpecStep {
  /** `S1`, `S2`. */
  id: string
  done: boolean
  /** The acceptance ids the step serves. */
  serves: string[]
  text: string
  /** Struck through in the spec. The id stays so nothing is renumbered. */
  retired: boolean
}

export interface Spec {
  id: string
  title: string
  kind: SpecKind
  status: SpecStatus
  depends: string[]
  updated: string
  /** The `#` heading under the frontmatter. */
  heading: string
  outcome: string
  decisions: string[]
  outOfScope: string[]
  acceptance: SpecAcceptance[]
  proof: SpecProof[]
  steps: SpecStep[]
  openQuestions: string[]
  /** What does not follow the format. Empty for a well-formed spec. */
  problems: string[]
}

const SECTIONS = ['Outcome', 'Decisions', 'Out of scope', 'Acceptance', 'Proof', 'Steps', 'Open questions'] as const
type Section = (typeof SECTIONS)[number]

const STATUSES: readonly SpecStatus[] = ['draft', 'ready', 'doing', 'done', 'dropped']

interface Block {
  /** True for a list item, false for a paragraph. */
  item: boolean
  text: string
  /** 1-based lines of the file. */
  line: number
  endLine: number
}

export function parseSpec(source: string): Spec {
  const problems: string[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const { fields, bodyStart } = readFrontmatter(lines, problems)

  let heading = ''
  let section: Section | undefined
  const blocks = new Map<Section, Block[]>()
  const order: Section[] = []
  let open: Block | undefined

  for (let index = bodyStart; index < lines.length; index += 1) {
    const line = lines[index]!
    const title = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (title) {
      open = undefined
      if (title[1] === '#' && !heading) heading = title[2]!
      // A deeper heading groups items inside the section it is in.
      if (title[1] !== '##') continue
      section = SECTIONS.find((name) => name.toLowerCase() === title[2]!.toLowerCase())
      if (section && !blocks.has(section)) {
        blocks.set(section, [])
        order.push(section)
      }
      continue
    }
    if (!section) continue
    if (!line.trim()) {
      open = undefined
      continue
    }
    const item = /^\s{0,3}[-*]\s+(.*)$/.exec(line)
    if (item) {
      open = { item: true, text: item[1]!.trim(), line: index + 1, endLine: index + 1 }
      blocks.get(section)!.push(open)
    } else if (open) {
      open.text += ` ${line.trim()}`
      open.endLine = index + 1
    } else {
      open = { item: false, text: line.trim(), line: index + 1, endLine: index + 1 }
      blocks.get(section)!.push(open)
    }
  }

  const texts = (name: Section) => (blocks.get(name) ?? []).map((block) => block.text)
  const items = (name: Section) => (blocks.get(name) ?? []).filter((block) => block.item)

  if (!blocks.has('Outcome')) problems.push('The Outcome section is missing.')
  if (!blocks.has('Acceptance')) problems.push('The Acceptance section is missing.')

  const acceptance = readAcceptance(items('Acceptance'), problems)
  const known = new Set(acceptance.map((line) => line.id))
  const proof = readProof(items('Proof'), known, problems)
  const steps = readSteps(items('Steps'), known, problems)
  if (fields.kind === 'context' && steps.length > 0) problems.push('A context spec has no steps.')

  for (let index = 1; index < order.length; index += 1) {
    if (SECTIONS.indexOf(order[index]!) < SECTIONS.indexOf(order[index - 1]!)) {
      problems.push(`Sections are out of order: ${order[index]} comes after ${order[index - 1]}.`)
    }
  }

  return {
    ...fields,
    heading,
    outcome: texts('Outcome').join('\n\n'),
    decisions: texts('Decisions'),
    outOfScope: texts('Out of scope'),
    acceptance,
    proof,
    steps,
    openQuestions: texts('Open questions'),
    problems,
  }
}

type Frontmatter = Pick<Spec, 'id' | 'title' | 'kind' | 'status' | 'depends' | 'updated'>

function readFrontmatter(lines: readonly string[], problems: string[]): { fields: Frontmatter; bodyStart: number } {
  const fields: Frontmatter = { id: '', title: '', kind: 'work', status: 'draft', depends: [], updated: '' }
  const first = lines.findIndex((line) => line.trim() !== '')
  const last = first < 0 || lines[first]!.trim() !== '---' ? -1 : lines.findIndex((line, index) => index > first && line.trim() === '---')
  if (last < 0) {
    problems.push('The spec does not start with JSON frontmatter between two --- lines.')
    return { fields, bodyStart: 0 }
  }

  let raw: unknown
  try {
    raw = JSON.parse(lines.slice(first + 1, last).join('\n'))
  } catch {
    problems.push('Frontmatter is not valid JSON.')
    return { fields, bodyStart: last + 1 }
  }
  const record = raw != null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const text = (name: 'id' | 'title' | 'updated') => {
    const value = record[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
    problems.push(`Frontmatter: \`${name}\` is missing.`)
    return ''
  }

  fields.id = text('id')
  fields.title = text('title')
  if (record.kind === 'context' || record.kind === 'work') fields.kind = record.kind
  else if (record.kind !== undefined) problems.push('Frontmatter: `kind` must be work or context.')
  if (STATUSES.includes(record.status as SpecStatus)) fields.status = record.status as SpecStatus
  else problems.push('Frontmatter: `status` must be draft, ready, doing, done or dropped.')
  if (Array.isArray(record.depends) && record.depends.every((entry) => typeof entry === 'string')) fields.depends = record.depends as string[]
  else if (record.depends !== undefined) problems.push('Frontmatter: `depends` must be a list of spec ids.')
  fields.updated = text('updated')
  if (fields.updated && !/^\d{4}-\d{2}-\d{2}$/.test(fields.updated)) problems.push('Frontmatter: `updated` must be a date, YYYY-MM-DD.')
  return { fields, bodyStart: last + 1 }
}

const quoted = (text: string) => JSON.stringify(text.length > 60 ? `${text.slice(0, 59)}…` : text)

function readAcceptance(items: readonly Block[], problems: string[]): SpecAcceptance[] {
  const lines: SpecAcceptance[] = []
  const seen = new Set<string>()
  for (const { text: item, line, endLine } of items) {
    // A retired line is struck through and keeps its id: `~~A3. Old text.~~ Retired: why.`
    const struck = /^~~\s*(A\d+)\.\s+(.*?)\s*~~/.exec(item)
    const plain = /^(A\d+)\.\s+(.*)$/.exec(item)
    const match = struck ?? plain
    if (!match) {
      problems.push(`Acceptance: ${quoted(item)} has no id.`)
      continue
    }
    const id = match[1]!
    if (seen.has(id)) {
      problems.push(`Acceptance: ${id} is used twice.`)
      continue
    }
    seen.add(id)
    lines.push({ id, text: match[2]!.trim(), retired: struck != null, line, endLine })
  }
  return lines
}

function readProof(items: readonly Block[], acceptance: ReadonlySet<string>, problems: string[]): SpecProof[] {
  const proof: SpecProof[] = []
  const seen = new Set<string>()
  for (const { text: item } of items) {
    // A retired proof line is struck through with its acceptance line, and proves nothing.
    if (/^~~\s*A\d+\./.test(item)) continue
    const match = /^(A\d+)\.\s+(.*)$/.exec(item)
    if (!match) {
      problems.push(`Proof: ${quoted(item)} names no acceptance id.`)
      continue
    }
    const id = match[1]!
    const text = match[2]!.trim()
    if (!acceptance.has(id)) {
      problems.push(`Proof: ${id} is not an acceptance id.`)
      continue
    }
    if (seen.has(id)) {
      problems.push(`Proof: ${id} has two Proof lines.`)
      continue
    }
    seen.add(id)
    const named = /^`([^`]+)`\s*[›>]\s*(?:"(.+)"|“(.+)”|'(.+)')\s*$/.exec(text)
    if (named) proof.push({ id, kind: 'test', path: named[1]!.trim(), name: (named[2] ?? named[3] ?? named[4])!, text })
    else if (/^check:/i.test(text)) proof.push({ id, kind: 'check', text })
    else proof.push({ id, kind: 'other', text })
  }
  return proof
}

function readSteps(items: readonly Block[], acceptance: ReadonlySet<string>, problems: string[]): SpecStep[] {
  const steps: SpecStep[] = []
  const seen = new Set<string>()
  for (const { text: item } of items) {
    // A retired step is struck through, with or without its box: `~~S4 (A8). Text.~~ Retired with A8.`
    const struck = /^(?:\[([ xX])\]\s+)?~~\s*(S\d+)\s*(?:\(([^)]*)\))?\s*\.?\s*(.*?)\s*~~/.exec(item)
    if (struck) {
      const id = struck[2]!
      if (seen.has(id)) problems.push(`Steps: ${id} is used twice.`)
      seen.add(id)
      const serves = (struck[3] ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
      steps.push({ id, done: struck[1] != null && struck[1] !== ' ', serves, text: struck[4]!.trim(), retired: true })
      continue
    }
    const match = /^\[([ xX])\]\s+(S\d+)\s*(?:\(([^)]*)\))?\s*\.?\s*(.*)$/.exec(item)
    if (!match) {
      problems.push(`Steps: ${quoted(item)} is not a step. A step reads "- [ ] S1 (A1). What to do."`)
      continue
    }
    const id = match[2]!
    if (seen.has(id)) {
      problems.push(`Steps: ${id} is used twice.`)
      continue
    }
    seen.add(id)
    const serves = (match[3] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (serves.length === 0) problems.push(`Steps: ${id} names no acceptance id in parentheses.`)
    for (const served of serves) {
      if (!acceptance.has(served)) problems.push(`Steps: ${id} serves ${served}, which is not an acceptance id.`)
    }
    steps.push({ id, done: match[1] !== ' ', serves, text: match[4]!.trim(), retired: false })
  }
  return steps
}
