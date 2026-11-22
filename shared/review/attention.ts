/**
 * What a review asks of the reviewer (spec 053), from what the change review found: which nodes need them, which are
 * worth a look and which are safe, the order to read them in, and why, in plain words; what kind of change each node
 * is, so the safe ones fold into groups; and which files of a large change get their detail. Pure, so it is tested
 * without a host.
 *
 * The rule: a node needs the reviewer when the review rated it high or critical, found a test it breaks or a reference
 * it leaves dangling, left a question, found no test for changed code or a test that fails, when the blind check
 * disagreed with its unit's level, or when an acceptance line has a warning. It is worth a look when it is mid, or when
 * something about it could not be checked. Everything else is safe.
 */
import { classify, isLockfile } from '../../packages/change-review/src/triage.ts'
import type { Effect, Proof } from '../../packages/change-review/src/types.ts'
import type { RatedNode } from './assessment.ts'
import { alignRows } from './diff.ts'
import { fileRole } from './paths.ts'
import { listed } from './prose.ts'
import type { AttentionTier, ChangeKind, FileStatus, NodeBucket, NodeKind, NodeStatus } from './types.ts'

/** What the change review found of one definition a node holds. */
export type RatedFacts = Omit<RatedNode, 'id' | 'symbol' | 'path' | 'lines' | 'unit'>

/** What is known of a node when its attention is weighed. */
export interface AttentionInput {
  kind: NodeKind
  bucket: NodeBucket
  change: ChangeKind
  /** The lines it changes, added and removed. */
  size: number
  /** A test's run, or an acceptance line's proof. */
  status?: NodeStatus
  /** Why an acceptance line needs a second look. */
  warning?: string
  /** Every definition the change review rated in its lines. Empty for a node it did not rate. */
  rated: readonly RatedFacts[]
}

/** A node's tier, how strong its reasons are together, and the strongest three of them. */
export interface Weighed {
  tier: AttentionTier
  strength: number
  reasons: string[]
}

interface Reason {
  /** The least tier this reason puts its node in. */
  tier: AttentionTier
  weight: number
  text: string
}

const TIER_ORDER: Record<AttentionTier, number> = { 'needs-you': 0, 'worth-a-look': 1, safe: 2 }
const needs = (weight: number, text: string): Reason => ({ tier: 'needs-you', weight, text })
const look = (weight: number, text: string): Reason => ({ tier: 'worth-a-look', weight, text })
const note = (weight: number, text: string): Reason => ({ tier: 'safe', weight, text })

/** Rules of findings that show something wrong, as against a note on how the level was reached. */
const BROKEN: readonly [rule: string, weight: number, text: string][] = [
  ['breaks-test', 100, 'Breaks a test that passes without this change.'],
  ['model-violated', 95, 'A model check of it fails.'],
  ['dangling-reference', 95, 'Removes something other code still uses.'],
  ['failing-test', 80, 'A test that runs it fails with this change in place.'],
  ['test-timeout', 70, 'A test that runs it does not finish.'],
]

/** Findings that say the review judged it without looking around it. */
const UNLOOKED = new Set(['not-mapped', 'added-by-reviewer'])

const DOES: Partial<Record<Effect, string>> = {
  data: 'Changes data it writes',
  interface: 'Changes an interface other code uses',
  load: 'Takes effect when the app loads',
  behaviour: 'Changes what the code does',
}

const COVERED: Partial<Record<Proof, string>> = {
  none: 'no test covers it',
  isolated: 'only tests that call it directly cover it',
  mocked: 'only tests with mocks cover it',
  unknown: 'its tests could not run here',
}

const LEVEL_NAMES = { high: 'high risk', mid: 'mid risk', safe: 'safe' } as const

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`

/** "Changes data it writes, and no test covers it." */
function joined(lead: string, clauses: readonly string[]): string {
  if (!clauses.length) return sentence(lead)
  return sentence(`${[lead, ...clauses.slice(0, -1)].join(', ')}, and ${clauses.at(-1)}`)
}

/** No test reaches changed code that does something. */
const untested = (facts: RatedFacts) => facts.proof === 'none' && facts.effect !== 'text' && facts.level !== 'safe'

function ratedReasons(facts: RatedFacts): Reason[] {
  const reasons: Reason[] = []
  const rules = new Set((facts.findings ?? []).map((finding) => finding.rule))
  for (const [rule, weight, text] of BROKEN) if (rules.has(rule) && !(rule === 'failing-test' && rules.has('breaks-test'))) reasons.push(needs(weight, text))
  if (facts.critical) reasons.push(needs(90, 'Needs a fix, not only a look.'))
  if (facts.level === 'high') {
    const clauses = [...(facts.undo === 'none' ? ['nothing undoes it'] : []), ...(facts.proof && COVERED[facts.proof] ? [COVERED[facts.proof]!] : [])]
    reasons.push(needs(60, joined(facts.effect && DOES[facts.effect] ? DOES[facts.effect]! : 'The AI review rates it high risk', clauses)))
  } else if (untested(facts)) reasons.push(needs(40, joined(facts.effect && DOES[facts.effect] ? DOES[facts.effect]! : 'It changes', ['no test covers it'])))
  if (facts.blind && !facts.blind.agrees) reasons.push(needs(50, facts.blind.level ? `A second, blind reading would rate it ${LEVEL_NAMES[facts.blind.level]}.` : 'A second, blind reading disagrees with its rating.'))
  if (facts.questions) reasons.push(needs(45, facts.questions === 1 ? 'It leaves you a question to answer.' : `It leaves you ${facts.questions} questions to answer.`))
  if (facts.level === 'mid' && !untested(facts)) reasons.push(look(30, midWords(facts)))
  if (facts.unverified) reasons.push(look(25, 'Its place in the map could not be checked, so read it yourself.'))
  if (facts.confidence === 'low') reasons.push(look(20, 'The AI review was unsure of its rating.'))
  if ([...rules].some((rule) => UNLOOKED.has(rule))) reasons.push(look(20, 'Judged from the diff alone: what calls it and what tests it were not looked for.'))
  if (facts.sensitive?.length) reasons.push(note(8, `Its name touches ${listed(facts.sensitive)}.`))
  if ((facts.callers ?? 0) >= 5) reasons.push(note(6, `Called from ${facts.callers} places.`))
  if (facts.effect === 'text' && facts.level === 'safe') reasons.push(note(0, 'Only comments or whitespace changed.'))
  return reasons
}

/** Why a mid node is worth a look, from what its tests showed and what it does. */
function midWords(facts: RatedFacts): string {
  if (facts.proof === 'isolated' || facts.proof === 'mocked' || facts.proof === 'unknown') return sentence(COVERED[facts.proof]!)
  if (facts.effect === 'load') return 'Takes effect when the app loads.'
  if (facts.undo === 'flag-with-residue') return 'Turning its condition off leaves what it wrote behind.'
  return 'Nothing shows it safe or risky, so it gets a look.'
}

/** Why a file the change review did not rate is safe, by its kind. */
const SAFE_BUCKETS: Partial<Record<NodeBucket, string>> = {
  lockfile: 'A lockfile: the package manager writes it.',
  generated: 'Generated or vendored: nobody writes it by hand.',
  locale: 'Words for the app, in a locale file.',
  docs: 'Docs or media: nothing in it runs.',
  moved: 'Moved, with no other change.',
  format: 'Only whitespace or formatting changed.',
}

/** What is known of a node the change review did not rate: a test's run, an acceptance line's proof, a file's kind. */
function unratedReasons({ kind, bucket, change, status, warning }: AttentionInput): Reason[] {
  if (kind === 'context' || (change === 'unchanged' && kind !== 'criterion')) return []
  if (kind === 'criterion') {
    if (warning) return [needs(55, sentence(warning))]
    return status === 'proven' ? [] : [look(15, 'Nothing proves this acceptance line yet.')]
  }
  if (kind === 'test') {
    if (status === 'failed') return [needs(80, 'This test fails with the change in place.')]
    return status === 'not-run' ? [look(15, 'This test did not run.')] : []
  }
  const safe = SAFE_BUCKETS[bucket]
  if (safe) return [note(1, safe)]
  return bucket === 'test' ? [] : [look(10, 'The AI review did not rate it, so give it a look.')]
}

/** A node's tier and its reasons, the strongest first. A node over several definitions takes the worst of them. */
export function attentionOf(input: AttentionInput): Weighed {
  const found = input.rated.length ? input.rated.flatMap(ratedReasons) : unratedReasons(input)
  const byText = new Map<string, Reason>()
  for (const reason of found) if ((byText.get(reason.text)?.weight ?? -1) < reason.weight) byText.set(reason.text, reason)
  const reasons = [...byText.values()].sort((a, b) => b.weight - a.weight)
  const tier = reasons.reduce<AttentionTier>((worst, { tier }) => (TIER_ORDER[tier] < TIER_ORDER[worst] ? tier : worst), 'safe')
  return { tier, strength: reasons.reduce((sum, { weight }) => sum + weight, 0), reasons: reasons.slice(0, 3).map(({ text }) => text) }
}

/** Every node's place in the review, from 1: by tier, then by how strong its reasons are, then by how much it changes. */
export function rankAttention(nodes: readonly { id: string; tier: AttentionTier; strength: number; size: number }[]): Map<string, number> {
  const ordered = nodes.map((node, index) => ({ ...node, index })).sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.strength - a.strength || b.size - a.size || a.index - b.index)
  return new Map(ordered.map(({ id }, index) => [id, index + 1]))
}

/** A file's bucket from its path alone: what it is, before what changed in it is known. Images, fonts and media go with docs. */
export function pathBucket(path: string, binary = false): NodeBucket {
  if (isLockfile(path)) return 'lockfile'
  const { kind } = classify({ path, status: 'modified', added: 1, deleted: 0, binary })
  if (kind === 'generated') return 'generated'
  if (kind === 'translation') return 'locale'
  if (kind === 'docs' || kind === 'asset') return 'docs'
  return kind === 'test' ? 'test' : 'code'
}

/** A changed file, as its bucket is found: its path, how it changed, and both sides when they are known. */
export interface BucketFile {
  path: string
  status: FileStatus
  binary?: boolean
  additions: number
  deletions: number
  base?: string | null
  head?: string | null
}

/** Files whose indent is part of what the code does, so a change in it is a change. */
const INDENTED = /\.(py|pyi|ya?ml|haml|slim|pug|jade|sass|styl|coffee|nim)$|(^|\/)(GNUmakefile|Makefile)$|\.mk$/i

/** A line as a move matches it: its indent counts only where the indent means something. */
const lineKey = (path: string) => (INDENTED.test(path) ? (line: string) => line.trimEnd() : (line: string) => line.trim())

/** The fewest lines with words in them that make a move: one line that matches a line elsewhere is a change. */
const MOVE_LINES = 2

/** Every non-blank line a file adds and removes. */
function changedLines(file: BucketFile): { added: string[]; removed: string[] } | null {
  if (file.binary || (file.base == null && file.head == null)) return null
  const key = lineKey(file.path)
  const added: string[] = []
  const removed: string[] = []
  for (const row of alignRows(file.base ?? '', file.head ?? '')) {
    if (row.kind === 'equal') continue
    if (row.kind !== 'insert' && row.oldText.trim()) removed.push(key(row.oldText))
    if (row.kind !== 'delete' && row.newText.trim()) added.push(key(row.newText))
  }
  return { added, removed }
}

const counted = (lines: readonly string[]) => {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

/** Whether every line is among `pool`, as often as it comes. */
const within = (lines: readonly string[], pool: ReadonlyMap<string, number>) => [...counted(lines)].every(([line, times]) => (pool.get(line) ?? 0) >= times)

/** Both sides are the same once whitespace is set aside: around punctuation, in runs, at line ends, and, where it means nothing, the indent. */
function onlyFormat(file: BucketFile): boolean {
  if (file.base == null || file.head == null || file.base === file.head) return false
  const squeezed = INDENTED.test(file.path)
    ? (text: string) => text.split(/\r\n|\r|\n/).map((line) => line.trimEnd()).filter(Boolean).join('\n')
    : (text: string) => text.replace(/\s+/g, ' ').replace(/ ?([^\w\s]) ?/g, '$1').trim()
  return squeezed(file.base) === squeezed(file.head)
}

/**
 * Each changed file's bucket, by path. A lockfile, a generated or vendored file, a locale file and docs keep the kind
 * their path names. Otherwise a file renamed and nothing more, or whose every added and removed line is a line the
 * change removes or adds somewhere, is `moved`; one that changed only in whitespace is `format`.
 */
export function fileBuckets(files: readonly BucketFile[]): Map<string, NodeBucket> {
  const lines = files.map((file) => ({ file, changed: changedLines(file) }))
  const added = counted(lines.flatMap(({ changed }) => changed?.added ?? []))
  const removed = counted(lines.flatMap(({ changed }) => changed?.removed ?? []))
  return new Map(
    lines.map(({ file, changed }): [string, NodeBucket] => {
      const byPath = pathBucket(file.path, file.binary)
      if (byPath === 'lockfile' || byPath === 'generated' || byPath === 'locale' || byPath === 'docs') return [file.path, byPath]
      if (file.status === 'renamed' && file.additions === 0 && file.deletions === 0) return [file.path, 'moved']
      const wordy = changed ? [...changed.added, ...changed.removed].filter((line) => /\w.*\w/.test(line)).length : 0
      if (changed && wordy >= MOVE_LINES && within(changed.added, removed) && within(changed.removed, added)) return [file.path, 'moved']
      if (onlyFormat(file)) return [file.path, 'format']
      return [file.path, byPath]
    }),
  )
}

/** A changed file as detail is handed out: its path, how much it changes, and its text, whose first line can name a script's language. */
export interface DetailFile {
  path: string
  additions: number
  deletions: number
  head?: string | null
  base?: string | null
}

/** Code and tests first; then configuration, data and other files; then what is read at a glance. */
function detailRank(file: DetailFile): number {
  const bucket = pathBucket(file.path)
  if (bucket === 'generated' || bucket === 'lockfile' || bucket === 'locale' || bucket === 'docs') return 2
  return fileRole(file.path, (file.head ?? file.base ?? '').split('\n', 1)[0]) === 'file' ? 1 : 0
}

/**
 * The order a large change's files get their detail in, so its room goes to code a person must read: code and tests,
 * then other files, then generated files, lockfiles, locale files and docs, each the largest change first, then by path.
 */
export function detailOrder<File extends DetailFile>(files: readonly File[]): File[] {
  const ranked = files.map((file) => ({ file, rank: detailRank(file), size: file.additions + file.deletions }))
  return ranked.sort((a, b) => a.rank - b.rank || b.size - a.size || (a.file.path < b.file.path ? -1 : a.file.path > b.file.path ? 1 : 0)).map(({ file }) => file)
}
