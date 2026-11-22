/**
 * What a review asks of the reviewer (spec 053), from what the change review found: which nodes need them, which are
 * worth a look and which are safe, the order to read them in, and why, in plain words; what kind of change each node
 * is, so the safe ones fold into groups; and which files of a large change get their detail. Pure, so it is tested
 * without a host.
 *
 * The rule: a node needs the reviewer when the review rated it high or critical, found a test it breaks or a reference
 * it leaves dangling, left a question, found a test that fails, when the blind check disagreed with its unit's level,
 * or when an acceptance line has a warning. It is worth a look when it is mid, no test covers it, it only removes lines,
 * or something about it could not be checked. Everything else is safe.
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
  for (const [rule, weight, text] of BROKEN) {
    const saidByBreaksTest = rule === 'failing-test' && rules.has('breaks-test')
    if (rules.has(rule) && !saidByBreaksTest) reasons.push(needs(weight, text))
  }
  if (facts.critical) reasons.push(needs(90, 'Needs a fix, not only a look.'))
  // The engine's level weighs its tests already: no test is worth a look, first of that tier, and never needs the reviewer alone.
  if (facts.level === 'high') reasons.push(needs(60, highWords(facts)))
  else if (untested(facts)) reasons.push(look(60, 'No test covers it.'))
  if (facts.blind && !facts.blind.agrees) {
    const blindLevel = facts.blind.level
    const text = blindLevel ? `A second, blind reading would rate it ${LEVEL_NAMES[blindLevel]}.` : 'A second, blind reading disagrees with its rating.'
    reasons.push(needs(50, text))
  }
  if (facts.questions) {
    const text = facts.questions === 1 ? 'It leaves you a question to answer.' : `It leaves you ${facts.questions} questions to answer.`
    reasons.push(needs(45, text))
  }
  if (facts.level === 'mid' && !untested(facts)) reasons.push(look(30, midWords(facts)))
  if (facts.unverified) reasons.push(look(25, 'Its place in the map could not be checked, so read it yourself.'))
  if (facts.confidence === 'low') reasons.push(look(20, 'The AI review was unsure of its rating.'))
  if ([...rules].some((rule) => UNLOOKED.has(rule))) reasons.push(look(20, 'Judged from the diff alone: what calls it and what tests it were not looked for.'))
  if (facts.sensitive?.length) reasons.push(note(8, `Its name touches ${listed(facts.sensitive)}.`))
  if ((facts.callers ?? 0) >= 5) reasons.push(note(6, `Called from ${facts.callers} places.`))
  if (facts.effect === 'text' && facts.level === 'safe') reasons.push(note(0, 'Only comments or whitespace changed.'))
  return reasons
}

/** Why a high node needs the reviewer: what it does, then that nothing undoes it and how little its tests cover, when they say so. */
function highWords(facts: RatedFacts): string {
  const does = (facts.effect && DOES[facts.effect]) || 'The AI review rates it high risk'
  const clauses: string[] = []
  if (facts.undo === 'none') clauses.push('nothing undoes it')
  const covered = facts.proof && COVERED[facts.proof]
  if (covered) clauses.push(covered)
  return joined(does, clauses)
}

/** Why a mid node is worth a look, from what its tests showed and what it does. */
function midWords(facts: RatedFacts): string {
  if (facts.proof === 'isolated' || facts.proof === 'mocked' || facts.proof === 'unknown') return sentence(COVERED[facts.proof]!)
  if (facts.effect === 'load') return 'Takes effect when the app loads.'
  if (facts.undo === 'flag-with-residue') return 'Turning its condition off leaves what it wrote behind.'
  return 'Nothing shows it safe or risky, so it gets a look.'
}

/** Why a file the change review did not rate is safe: only what a person reads at a glance, by its kind. */
const SAFE_BUCKETS: Partial<Record<NodeBucket, string>> = {
  lockfile: 'A lockfile: the package manager writes it.',
  generated: 'Generated or vendored: nobody writes it by hand.',
  locale: 'Words for the app, in a locale file.',
}

/** Why a file the change review did not rate is still worth a look, by its kind. */
const UNRATED_BUCKETS: Record<NodeBucket, string> = {
  lockfile: '',
  generated: '',
  locale: '',
  moved: 'It looks moved, with no other change: check it arrived whole.',
  format: 'It looks like only formatting changed: check nothing else did.',
  docs: 'Docs or media the AI review did not rate.',
  test: 'A test file the AI review did not rate.',
  code: 'The AI review did not rate it, so give it a look.',
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
  return safe ? [note(1, safe)] : [look(10, UNRATED_BUCKETS[bucket])]
}

/** What a node that only removes lines asks: at least a look, since whatever used what it removed now finds nothing. */
function removalReasons({ kind, bucket, change }: AttentionInput): Reason[] {
  if (change !== 'deleted' || kind === 'criterion' || kind === 'context') return []
  if (bucket === 'lockfile' || bucket === 'generated') return []
  if (kind === 'test' || bucket === 'test') return [look(35, 'It removes part of the tests: check that what they covered still is.')]
  const removesCode = bucket === 'code' || bucket === 'moved' || bucket === 'format'
  return [look(35, removesCode ? 'It only removes code: check nothing still needs it.' : 'It only removes lines: check nothing still needs them.')]
}

/** A node's tier and its reasons, the strongest first. A node over several definitions takes the worst of them. */
export function attentionOf(input: AttentionInput): Weighed {
  const ownReasons = input.rated.length ? input.rated.flatMap(ratedReasons) : unratedReasons(input)
  const found = [...ownReasons, ...removalReasons(input)]

  // A reason given more than once is said once, at its strongest.
  const byText = new Map<string, Reason>()
  for (const reason of found) {
    const kept = byText.get(reason.text)
    if ((kept?.weight ?? -1) < reason.weight) byText.set(reason.text, reason)
  }

  // What sets the tier is said first, then the rest by weight.
  const reasons = [...byText.values()].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.weight - a.weight)
  return {
    tier: reasons[0]?.tier ?? 'safe',
    strength: reasons.reduce((sum, { weight }) => sum + weight, 0),
    reasons: reasons.slice(0, 3).map(({ text }) => text),
  }
}

/** Every node's place in the review, from 1: by tier, then by how strong its reasons are, then by how much it changes. */
export function rankAttention(nodes: readonly { id: string; tier: AttentionTier; strength: number; size: number }[]): Map<string, number> {
  const ordered = nodes
    .map((node, index) => ({ ...node, index }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.strength - a.strength || b.size - a.size || a.index - b.index)
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

/**
 * Languages where neither the indent nor the spacing between tokens can change what the code does, and whose strings and
 * comments the tokenizer below knows (line and block comments, and quotes). Only these can be `format`: in any other, as Python,
 * YAML, Haskell, a shell script, CSS or JSX, a change in spacing can be a change.
 */
const SPACING_FREE = /\.(js|mjs|cjs|ts|mts|cts|json|java|cs|rs|go)$/i
/** Of those, the ones where `/` can open a regular expression, whose spaces count. */
const REGEX_OPENS = /\.(js|mjs|cjs|ts|mts|cts)$/i

/**
 * A text's tokens as `onlyFormat` compares them: words, runs of punctuation, string and comment literals whole, and a
 * line break where lines break between tokens, since a line break can end a statement. Null when it cannot be sure, as
 * for a `/` that may open a regular expression.
 */
function tokensOf(text: string, regex: boolean): string[] | null {
  const tokens: string[] = []
  let at = 0
  const take = (end: number) => {
    tokens.push(text.slice(at, end))
    at = end
  }
  const opensComment = (index: number) => text[index] === '/' && (text[index + 1] === '/' || text[index + 1] === '*')
  while (at < text.length) {
    const char = text[at]!
    const next = text[at + 1]
    if (char === '\n') {
      if (tokens.length && tokens.at(-1) !== '\n') tokens.push('\n')
      at += 1
    } else if (/\s/.test(char)) {
      at += 1
    } else if (char === '/' && next === '/') {
      const end = text.indexOf('\n', at)
      take(end < 0 ? text.length : end)
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', at + 2)
      take(end < 0 ? text.length : end + 2)
    } else if (char === '"' || char === "'" || char === '`') {
      let end = at + 1
      while (end < text.length && text[end] !== char) end += text[end] === '\\' ? 2 : 1
      take(Math.min(end + 1, text.length))
    } else if (/\w/.test(char)) {
      let end = at
      while (end < text.length && /\w/.test(text[end]!)) end += 1
      take(end)
    } else {
      let end = at
      while (end < text.length && !/[\s\w"'`]/.test(text[end]!) && !opensComment(end)) end += 1
      if (regex && text.slice(at, end).includes('/')) return null
      take(Math.max(end, at + 1))
    }
  }
  if (tokens.at(-1) === '\n') tokens.pop()
  return tokens
}

/** Both sides have the same tokens, line by line, in a language where spacing between them means nothing. */
function onlyFormat(file: BucketFile): boolean {
  if (file.base == null || file.head == null || file.base === file.head) return false
  if (!SPACING_FREE.test(file.path)) return false
  const regex = REGEX_OPENS.test(file.path)
  const before = tokensOf(file.base, regex)
  const after = tokensOf(file.head, regex)
  if (before == null || after == null) return false
  return before.length === after.length && before.every((token, index) => token === after[index])
}

/** The fewest lines with words in them a block needs to be a move: a line or two that match lines elsewhere are a change. */
const MOVE_LINES = 3

/** The blocks of lines a file removes and adds. */
interface FileBlocks {
  removed: string[]
  added: string[]
}

/** A run of lines as one block, without blank lines at its ends. */
const blockOf = (lines: readonly string[]) => lines.join('\n').replace(/^\n+|\n+$/g, '')

/**
 * The blocks of lines a file removes and adds, each a run of consecutive lines at one place, with its indent and without
 * blank lines at its ends. Blank lines the diff kept between two runs do not part them.
 */
function blocksOf(file: BucketFile): FileBlocks | null {
  if (file.binary || (file.base == null && file.head == null)) return null
  const removed: string[] = []
  const added: string[] = []
  let gone: string[] = []
  let come: string[] = []
  const close = () => {
    const goneBlock = blockOf(gone)
    const comeBlock = blockOf(come)
    if (goneBlock) removed.push(goneBlock)
    if (comeBlock) added.push(comeBlock)
    gone = []
    come = []
  }
  for (const row of alignRows(file.base ?? '', file.head ?? '')) {
    if (row.kind === 'equal') {
      if (row.oldText.trim()) close()
      continue
    }
    if (row.kind !== 'insert') gone.push(row.oldText.trimEnd())
    if (row.kind !== 'delete') come.push(row.newText.trimEnd())
  }
  close()
  return { removed, added }
}

const counted = (blocks: readonly string[]) => {
  const counts = new Map<string, number>()
  for (const block of blocks) counts.set(block, (counts.get(block) ?? 0) + 1)
  return counts
}

/** Whether every block is among `pool`, as often as it comes. */
const within = (blocks: readonly string[], pool: ReadonlyMap<string, number>) => {
  return [...counted(blocks)].every(([block, times]) => (pool.get(block) ?? 0) >= times)
}

/** A block big enough to be a move: at least `MOVE_LINES` lines with words in them. */
const sizable = (block: string) => block.split('\n').filter((line) => /\w.*\w/.test(line)).length >= MOVE_LINES

/**
 * Whether a file's changes are all moves: it removes or adds something, every block is big enough to be a move, each
 * block it removes arrives whole among the change's added blocks, and each block it adds left from among its removed ones.
 */
function movedWhole(file: FileBlocks, addedInChange: ReadonlyMap<string, number>, removedInChange: ReadonlyMap<string, number>): boolean {
  const blocks = [...file.removed, ...file.added]
  if (!blocks.length || !blocks.every(sizable)) return false
  return within(file.removed, addedInChange) && within(file.added, removedInChange)
}

/**
 * Each changed file's bucket. A lockfile, a generated or vendored file, a locale file and docs keep the kind their path
 * names. Otherwise a file is `moved` when it was renamed and nothing more, or when each block of lines it removes or adds
 * is a block of several lines that arrives whole, at the same indent, at another place in the change, or leaves one; and
 * `format` when it has the same tokens on both sides in a language where spacing means nothing. When in doubt, it is what
 * its path says: code or a test.
 */
export function fileBuckets(files: readonly BucketFile[]): Map<string, NodeBucket> {
  const changes = files.map((file) => ({ file, blocks: blocksOf(file) }))
  const added = counted(changes.flatMap(({ blocks }) => blocks?.added ?? []))
  const removed = counted(changes.flatMap(({ blocks }) => blocks?.removed ?? []))
  return new Map(
    changes.map(({ file, blocks }): [string, NodeBucket] => {
      const byPath = pathBucket(file.path, file.binary)
      if (byPath === 'lockfile' || byPath === 'generated' || byPath === 'locale' || byPath === 'docs') return [file.path, byPath]
      if (file.status === 'renamed' && file.additions === 0 && file.deletions === 0) return [file.path, 'moved']
      if (blocks && movedWhole(blocks, added, removed)) return [file.path, 'moved']
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
  const firstLine = (file.head ?? file.base ?? '').split('\n', 1)[0]
  return fileRole(file.path, firstLine) === 'file' ? 1 : 0
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The order a large change's files get their detail in, so its room goes to code a person must read: code and tests,
 * then other files, then generated files, lockfiles, locale files and docs, each the largest change first, then by path.
 */
export function detailOrder<File extends DetailFile>(files: readonly File[]): File[] {
  const ranked = files.map((file) => ({ file, rank: detailRank(file), size: file.additions + file.deletions }))
  ranked.sort((a, b) => a.rank - b.rank || b.size - a.size || byPath(a.file.path, b.file.path))
  return ranked.map(({ file }) => file)
}
