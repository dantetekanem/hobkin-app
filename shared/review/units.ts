/**
 * Pass 2 of preparing a review: split the changed lines into units, pair tests with code,
 * and find references between units.
 *
 * Ported from pi-coder's diff story (`src/diff-story/units.ts`). Its rule stays: the host extracts and
 * owns every code range. Units come from line patterns, not a parser, and loose lines join the nearest unit.
 */
import { sideText, type Capture, type CapturedFile } from './capture.ts'
import { alignRows, type AlignedRow, type ChangeRange } from './diff.ts'
import { splitLines } from './lines.ts'
import { fileRole, fileStem, namesCodeShebang, type FileRole } from './paths.ts'
import type { AnchorSide, EdgeKind } from './types.ts'

/** A run of lines of one unit, before it is hashed. */
export interface UnitRange {
  fileId: string
  side: AnchorSide
  startLine: number
  endLine: number
}

export interface Unit {
  id: string
  fileId: string
  path: string
  /** The declaration's name, a test's name, or `lines 4 to 9` for changes outside any declaration. */
  symbol: string
  role: FileRole
  /** A declaration in a test file that is not a test case, such as a function the tests call. */
  helper: boolean
  /** No declaration owns these lines. */
  loose: boolean
  /** The whole file as one unit, because the change is over the size limits. */
  summarized: boolean
  ranges: UnitRange[]
  /** The text of the ranges, for finding identifiers. */
  code: string
  /** For a test helper that stands as its own unit: the changed test cases that call it, by unit id. */
  supports?: string[]
  /** Kept under the name pi-coder used, so callers read `unit.anchors` for the ranges. */
  readonly anchors: UnitRange[]
}

/** A comment line or a decorator. `#` needs a space after it, so a private field (`#count`) is not read as a comment. */
const INTRODUCES = /^\s*(?:\/\/|\/\*|\*\/|\*(?:\s|$)|#(?:\s|$)|@[\w.]+)/
const TEST_CASE = /^\s*(?:(?:test|it|specify)(?:\.(?:only|skip))?\s*(?:\(\s*)?["'`]|def\s+test_)/
const CONTROL_WORD = /^(?:if|for|while|switch|catch|with|function|return)$/
/**
 * A line at a script's top level that runs: `exit Report.run(ARGV) if __FILE__ == $0`, `Worker.new.call`, `main`,
 * `await main()`. Not a comment, a `require` or an import, a declaration, a constant, or the end of a block.
 */
const TOP_STATEMENT = /^(?!#|\/\/|\/\*|\*|(?:require|require_relative|load|import|export|module|class|def|end|function|async\s+function|const|let|var|private|protected|public|type|interface|enum)\b|[A-Z][A-Z0-9_]*\s*=[^=]|['"]use strict|[})\]])\S/

/** Whether a line of a script runs at its top level, as the script's own code: `exit Report.run(ARGV)`. */
export const isTopStatement = (line: string): boolean => TOP_STATEMENT.test(line)
const KEY_SEPARATOR = '\u001f'

/** A value a module declares at its top level, such as a constant or a schema: `const SearchParams = Type.Object({`. */
const TOP_VALUE = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=/
/** A type a module declares at its top level, with the brace or `=` of JavaScript and TypeScript (a Ruby class has neither). */
const TOP_TYPE = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:class\s+([\w$]+)[^{]*\{|interface\s+([\w$]+)[^{]*\{|enum\s+([\w$]+)\s*\{|type\s+([\w$]+)\s*(?:<[^=]*>)?\s*=)/

/**
 * The name a line declares, if it declares one: a test case, a method, a function, or a function held in a constant;
 * and at a module's top level, a constant, a schema or a type, which changes as much as a function does.
 */
function declaration(line: string): string | undefined {
  const type = TOP_TYPE.exec(line)
  return (
    // The name ends at the quote that opened it, so "it's fine" is read whole.
    /^\s*(?:test|it|specify)(?:\.(?:only|skip))?\s*(?:\(\s*)?(["'`])((?:\\.|(?!\1).)+)\1/.exec(line)?.[2] ??
    /^\s*(?:private\s+|protected\s+)?def\s+(?:self\.)?([\w!?=]+)/.exec(line)?.[1] ??
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/.exec(line)?.[1] ??
    /^\s*(?:export\s+)?(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|[^;]*=>|\(\s*$)/.exec(line)?.[1] ??
    /^\s*(?:(?:private|public|protected|static|async|override|get|set)\s+)*([\w$]+)\s*\([^;]*\)\s*(?::[^=;]+)?\s*\{/.exec(line)?.[1] ??
    TOP_VALUE.exec(line)?.[1] ??
    (type ? (type[1] ?? type[2] ?? type[3] ?? type[4]) : undefined)
  )
}

/** Whether a line's brackets close, strings set aside. */
function balanced(line: string): boolean {
  const code = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '')
  const count = (pattern: RegExp) => code.match(pattern)?.length ?? 0
  return count(/[([{]/g) === count(/[)\]}]/g)
}

/** A statement that opens and closes on one line, so the declaration is that line alone. */
function completeOnOneLine(line: string): boolean {
  // An endless Ruby method, `def total(cart) = cart.sum`; a default argument, `def run(args = ARGV)`, is not one.
  if (/\{.*\}\s*[);,]*$/.test(line) || /^\s*def\s+(?:self\.)?[\w!?]+(?:\s*\([^)]*\))?\s*=\s+/.test(line)) return true
  // A top-level value or type with nothing left open and nothing to continue it: `const PRECISION = 2`.
  if ((TOP_VALUE.test(line) || /^(?:export\s+)?type\s/.test(line)) && balanced(line) && !/[[({,=+\-*/&|?:.]\s*$/.test(line)) return true
  if (!/;\s*$/.test(line)) return false
  return balanced(line)
}

/** The last line of the declaration that starts at `start`, both 0-based. Indentation decides, as in pi-coder. */
function declarationEnd(source: readonly string[], start: number): number {
  const line = source[start]!
  if (completeOnOneLine(line)) return start
  const indent = line.search(/\S/)
  let end = start
  while (end + 1 < source.length) {
    const next = source[end + 1]!
    if (next.trim() && next.search(/\S/) <= indent) {
      // A brace that opens again or goes on (`}, async () => {`) is the middle of the statement, not its end.
      if (/^\s*(?:end\b|\})/.test(next) && !/[{([,]\s*$/.test(next)) return end + 1
      if (declaration(next) != null || /^\s*(?:class|module|export)\b/.test(next)) return end
    }
    end += 1
  }
  return end
}

/**
 * Assigns each line to the declaration that owns it, keyed by name and occurrence. `cases` holds the keys that
 * are test cases, and `spans` the 0-based first and last line of each declaration, with what is nested in it.
 * In `owners`, a declaration nested in another takes its own lines.
 */
export function functionOwners(source: readonly string[], script = false): { owners: Array<string | undefined>; cases: Set<string>; spans: Map<string, [number, number]> } {
  const owners: Array<string | undefined> = new Array(source.length)
  const cases = new Set<string>()
  const spans = new Map<string, [number, number]>()
  const occurrences = new Map<string, number>()
  for (let start = 0; start < source.length; start += 1) {
    const line = source[start]!
    // A script's top-level statement runs when the script does, so it is a declaration of its own, named by its words.
    const name = script && TOP_STATEMENT.test(line) ? line.trim().slice(0, 80) : declaration(line)
    if (!name || CONTROL_WORD.test(name)) continue
    const occurrence = (occurrences.get(name) ?? 0) + 1
    occurrences.set(name, occurrence)
    const key = `${name}${KEY_SEPARATOR}${occurrence}`
    if (TEST_CASE.test(line)) cases.add(key)
    let end = declarationEnd(source, start)
    // The comment and the decorators right above a declaration are about it, so they are its lines too.
    let first = start
    while (first > 0 && INTRODUCES.test(source[first - 1]!)) first -= 1
    spans.set(key, [first, end])
    // Blank lines after a declaration stay with it, so the space between two tests is not a unit of its own.
    while (end + 1 < source.length && source[end + 1]!.trim() === '') end += 1
    // A nested declaration takes its own lines on a later pass.
    for (let index = first; index <= end; index += 1) owners[index] = key
  }
  return { owners, cases, spans }
}

/**
 * Where a name is declared in a file, as 1-based first and last line. Functions, methods and tests are found by
 * the same patterns as units. Classes, constants and types are found by the word that introduces them.
 * `testCase` asks for a test with that name.
 */
export function findDeclaration(text: string, symbol: string, testCase = false): { startLine: number; endLine: number } | undefined {
  const source = splitLines(text)
  const { cases, spans } = functionOwners(source)
  for (const [key, [start, end]] of spans) {
    if (nameOf(key) === symbol && (!testCase || cases.has(key))) return { startLine: start + 1, endLine: end + 1 }
  }
  if (testCase || !/^[\w$]+[!?]?$/.test(symbol)) return undefined
  const introduced = new RegExp(
    `^\\s*(?:(?:export|default|declare|abstract|public|private|protected|static|readonly)\\s+)*(?:(?:const|let|var|class|module|interface|type|enum|struct|trait|fn|func)\\s+)?${symbol.replace(/[$?!]/g, '\\$&')}(?![\\w$])\\s*(?:[=:({<]|extends\\b|implements\\b|$)`,
  )
  const start = source.findIndex((line) => introduced.test(line))
  return start < 0 ? undefined : { startLine: start + 1, endLine: declarationEnd(source, start) + 1 }
}

/** The test case of a name in a file nearest a line, as 1-based first and last line. Undefined when the file has none. */
export function testCaseNear(text: string, name: string, line: number): { startLine: number; endLine: number } | undefined {
  const { cases, spans } = functionOwners(splitLines(text))
  let nearest: { startLine: number; endLine: number } | undefined
  for (const [key, [start, end]] of spans) {
    if (!cases.has(key) || nameOf(key) !== name) continue
    if (!nearest || Math.abs(start + 1 - line) < Math.abs(nearest.startLine - line)) nearest = { startLine: start + 1, endLine: end + 1 }
  }
  return nearest
}

/** Every place a name is declared in a file, as 1-based first and last line, by the same patterns as `findDeclaration`. */
export function declarationsOf(text: string, symbol: string): { startLine: number; endLine: number }[] {
  const found = [...functionOwners(splitLines(text)).spans].filter(([key]) => nameOf(key) === symbol).map(([, [start, end]]) => ({ startLine: start + 1, endLine: end + 1 }))
  if (found.length > 0) return found
  const single = findDeclaration(text, symbol)
  return single ? [single] : []
}

/** The lines of the statement or declaration that starts on `line`, 1-based, by the rule units end by. */
export function blockAt(text: string, line: number): { startLine: number; endLine: number } | undefined {
  const source = splitLines(text)
  return line >= 1 && line <= source.length ? { startLine: line, endLine: declarationEnd(source, line - 1) + 1 } : undefined
}

const nameOf = (key: string) => key.split(KEY_SEPARATOR)[0]!

interface Draft {
  key: string
  unit: Unit
}

/** A file's first line, at head or at base when it is gone: for a script with no extension, it names the language. */
const firstLineOf = (file: Pick<CapturedFile, 'base' | 'head'>) => (file.head ?? file.base ?? '').split('\n', 1)[0]

function createUnit(file: CapturedFile, symbol: string, fields: Partial<Unit> = {}): Unit {
  const ranges: UnitRange[] = []
  return { id: '', fileId: file.id, path: file.path, symbol, role: fileRole(file.path, firstLineOf(file)), helper: false, loose: false, summarized: false, ranges, code: '', anchors: ranges, ...fields }
}

/** The index of the group of changed rows each changed line belongs to, per side. Lines are 0-based here. */
function changedLines(rows: readonly AlignedRow[]): Record<AnchorSide, Map<number, number>> {
  const changed = { added: new Map<number, number>(), deleted: new Map<number, number>() }
  let group = -1
  let inGroup = false
  for (const row of rows) {
    if (row.kind === 'equal') {
      inGroup = false
      continue
    }
    if (!inGroup) group += 1
    inGroup = true
    if (row.kind !== 'delete' && row.newLine != null) changed.added.set(row.newLine - 1, group)
    if (row.kind !== 'insert' && row.oldLine != null) changed.deleted.set(row.oldLine - 1, group)
  }
  return changed
}

function unitsOfFile(file: CapturedFile): Unit[] {
  const rows = alignRows(file.base ?? '', file.head ?? '')
  const source = { added: splitLines(sideText(file, 'added')), deleted: splitLines(sideText(file, 'deleted')) }
  const changed = changedLines(rows)

  if (file.summarized) {
    const unit = createUnit(file, '', { role: 'file', loose: true, summarized: true })
    for (const side of ['added', 'deleted'] as const) {
      const touched = [...changed[side].keys()]
      if (touched.length > 0) unit.ranges.push({ fileId: file.id, side, startLine: Math.min(...touched) + 1, endLine: Math.max(...touched) + 1 })
    }
    return unit.ranges.length > 0 ? [nameLoose(unit)] : []
  }

  // Prose and data have no declarations: the whole file's changes are one unit.
  const none = { owners: [] as Array<string | undefined>, cases: new Set<string>() }
  const declares = fileRole(file.path, firstLineOf(file)) !== 'file'
  const script = namesCodeShebang(firstLineOf(file))
  const ownership = { added: declares ? functionOwners(source.added, script) : none, deleted: declares ? functionOwners(source.deleted, script) : none }

  // A renamed declaration keeps both of its sides in one unit, under its new name.
  const addedOwners = new Set(ownership.added.owners)
  const deletedOwners = new Set(ownership.deleted.owners)
  const renamed = new Map<string, string>()
  for (const row of rows) {
    if (row.kind !== 'replace' || row.oldLine == null || row.newLine == null) continue
    const oldOwner = ownership.deleted.owners[row.oldLine - 1]
    const newOwner = ownership.added.owners[row.newLine - 1]
    if (oldOwner == null || newOwner == null || addedOwners.has(oldOwner) || deletedOwners.has(newOwner)) continue
    if (declaration(row.oldText) !== nameOf(oldOwner) || declaration(row.newText) !== nameOf(newOwner)) continue
    renamed.set(oldOwner, newOwner)
  }

  const drafts = new Map<string, Draft>()
  for (const side of ['added', 'deleted'] as const) {
    const lines = source[side]
    const { owners, cases } = ownership[side]
    for (let start = 0; start < lines.length; ) {
      const originalOwner = owners[start]
      const owner = side === 'deleted' ? (renamed.get(originalOwner ?? '') ?? originalOwner) : originalOwner
      let end = start
      if (originalOwner != null) {
        while (end + 1 < lines.length && owners[end + 1] === originalOwner) end += 1
      } else if (changed[side].has(start)) {
        while (end + 1 < lines.length && owners[end + 1] == null && changed[side].has(end + 1)) end += 1
      }
      let firstTouched: number | undefined
      for (let index = start; index <= end && firstTouched == null; index += 1) if (changed[side].has(index)) firstTouched = index
      if (firstTouched != null) {
        const key = owner ?? `hunk:${changed[side].get(firstTouched)}`
        let draft = drafts.get(key)
        if (draft == null) {
          const unit = createUnit(file, owner == null ? '' : nameOf(owner), { loose: owner == null })
          unit.helper = unit.role === 'test' && originalOwner != null && !cases.has(originalOwner)
          draft = { key, unit }
          drafts.set(key, draft)
        }
        draft.unit.ranges.push({ fileId: file.id, side, startLine: start + 1, endLine: end + 1 })
        draft.unit.code += `${lines.slice(start, end + 1).join('\n')}\n`
      }
      start = end + 1
    }
  }
  return foldLooseChanges([...drafts.values()], rows, source)
}

/** Changes outside a declaration join the nearest changed declaration in their file. With none, they are one unit. */
function foldLooseChanges(drafts: readonly Draft[], rows: readonly AlignedRow[], source: Record<AnchorSide, string[]>): Unit[] {
  const rowOf = { added: new Map<number, number>(), deleted: new Map<number, number>() }
  rows.forEach((row, index) => {
    if (row.newLine != null) rowOf.added.set(row.newLine, index)
    if (row.oldLine != null) rowOf.deleted.set(row.oldLine, index)
  })
  const span = (range: UnitRange) => [rowOf[range.side].get(range.startLine) ?? 0, rowOf[range.side].get(range.endLine) ?? 0] as const
  const declared = drafts.filter((draft) => !draft.unit.loose).map((draft) => draft.unit)
  const loose = drafts.filter((draft) => draft.unit.loose).map((draft) => draft.unit)
  const ownSpans = new Map(declared.map((unit) => [unit, unit.ranges.map(span)]))
  const kept = declared.length > 0 ? declared : loose.slice(0, 1)

  for (const unit of declared.length > 0 ? loose : loose.slice(1)) {
    for (const range of unit.ranges) {
      const [start, end] = span(range)
      let target = kept[0]!
      let best = Infinity
      for (const candidate of declared) {
        // Distance is counted in lines of the same side when the declaration has lines there. Rows of the diff pair
        // a removed line with whatever replaced it, which can put a declaration's old line next to an unrelated new one.
        const sameSide = candidate.ranges.filter((own) => own.side === range.side).map((own) => [own.startLine, own.endLine] as const)
        const [from, to] = sameSide.length > 0 ? [range.startLine, range.endLine] : [start, end]
        for (const [first, last] of sameSide.length > 0 ? sameSide : ownSpans.get(candidate)!) {
          const distance = first > to ? first - to : Math.max(0, from - last)
          // On a tie the declaration below wins: a comment or a constant usually introduces what follows.
          const score = distance * 2 + (first > to ? 0 : 1)
          if (score < best) {
            best = score
            target = candidate
          }
        }
      }
      target.ranges.push(range)
      target.code += `${source[range.side].slice(range.startLine - 1, range.endLine).join('\n')}\n`
    }
  }

  for (const unit of kept) {
    unit.ranges.sort((a, b) => span(a)[0] - span(b)[0] || Number(a.side === 'deleted') - Number(b.side === 'deleted'))
    joinTouching(unit.ranges)
    if (unit.loose) nameLoose(unit)
  }
  return kept.sort((a, b) => span(a.ranges[0]!)[0] - span(b.ranges[0]!)[0])
}

/** Ranges of one side that touch become one range, so a helper and the constant above it read as one block. */
function joinTouching(ranges: UnitRange[]): void {
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index]!
    for (let other = index + 1; other < ranges.length; ) {
      const next = ranges[other]!
      if (next.fileId === range.fileId && next.side === range.side && next.startLine <= range.endLine + 1 && range.startLine <= next.endLine + 1) {
        range.startLine = Math.min(range.startLine, next.startLine)
        range.endLine = Math.max(range.endLine, next.endLine)
        ranges.splice(other, 1)
        other = index + 1
      } else other += 1
    }
  }
}

function nameLoose(unit: Unit): Unit {
  const side = unit.ranges[0]!.side
  const sameSide = unit.ranges.filter((range) => range.side === side)
  const first = Math.min(...sameSide.map((range) => range.startLine))
  const last = Math.max(...sameSide.map((range) => range.endLine))
  unit.symbol = first === last ? `line ${first}` : `lines ${first} to ${last}`
  return unit
}

/** Every changed line of the capture, as units. Code comes first, then tests and loose changes. */
export function prepareUnits(capture: Capture): Unit[] {
  const units = capture.files.filter((file) => !file.binary).flatMap(unitsOfFile)
  const supporting = (unit: Unit) => Number(unit.role !== 'code' || unit.loose)
  units.sort((a, b) => supporting(a) - supporting(b))
  units.forEach((unit, index) => (unit.id = `u${index + 1}`))
  return units
}

function filenameScore(testStem: string, path: string): number {
  const sourceStem = fileStem(path)
  if (sourceStem === testStem) return 2
  const separators = ['_', '-', '.']
  // `belongs_to_associations_test` goes with `belongs_to`, and `cli-doing.test` with `cli/doing`.
  return separators.some((separator) => testStem.startsWith(`${sourceStem}${separator}`) || testStem.endsWith(`${separator}${sourceStem}`)) ? 1 : 0
}

/** The names code mentions. Quoted strings (test names, URLs, hash keys) and `key:` labels are data, not references. */
export function codeIdentifiers(code: string): Set<string> {
  return new Set(
    code
      .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g, ' ')
      .replace(/\b[A-Za-z_]\w*[!?]?:(?!:)/g, ' ')
      .match(/[A-Za-z_$][\w$!?]*/g),
  )
}

/** The names a unit mentions. A test also reads the helpers in its file that it calls, directly or through other helpers. */
export function unitIdentifiers(unit: Unit, units: readonly Unit[]): Set<string> {
  const identifiers = codeIdentifiers(unit.code)
  let pending = unit.role === 'test' ? units.filter((other) => other.helper && other.id !== unit.id && other.path === unit.path) : []
  let reached = pending.filter((helper) => identifiers.has(helper.symbol))
  while (reached.length > 0) {
    pending = pending.filter((helper) => !reached.includes(helper))
    for (const helper of reached) for (const name of codeIdentifiers(helper.code)) identifiers.add(name)
    reached = pending.filter((helper) => identifiers.has(helper.symbol))
  }
  return identifiers
}

const isTestCase = (unit: Unit) => unit.role === 'test' && !unit.helper && !unit.loose
const isCode = (unit: Unit) => unit.role === 'code'

/**
 * Pairs each changed test case with the code it exercises, when that is plain: a changed file named like the
 * test file outranks a name match elsewhere, and a tie stays unpaired so the host never guesses.
 */
export function pairTests(units: readonly Unit[]): Map<string, string> {
  const pairs = new Map<string, string>()
  const implementation = units.filter(isCode)
  for (const test of units.filter(isTestCase)) {
    const identifiers = unitIdentifiers(test, units)
    const testStem = fileStem(test.path)
    const named = implementation.filter((unit) => filenameScore(testStem, unit.path) > 0)
    const matches = (named.length > 0 ? named : implementation)
      .map((unit) => ({ unit, score: filenameScore(testStem, unit.path) + (!unit.loose && identifiers.has(unit.symbol) ? 3 : 0) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
    if (matches[0] && matches[0].score > (matches[1]?.score ?? 0)) pairs.set(test.id, matches[0].unit.id)
  }
  return pairs
}

/**
 * Gives a test file's helpers to its tests, so a graph has one node per test and none for plumbing: a helper that one
 * changed test calls joins it. A helper several changed tests call stays a unit of its own and names them (`supports`),
 * and so does one no changed test calls, which only unchanged tests use.
 */
export function mergeTestSupport(units: readonly Unit[]): Unit[] {
  const merged = units.map((unit) => ({ ...unit, ranges: [...unit.ranges] }))
  for (const unit of merged) Object.defineProperty(unit, 'anchors', { value: unit.ranges, enumerable: true })
  const gone = new Set<Unit>()
  for (const helper of merged.filter((unit) => unit.helper)) {
    const callers = merged.filter((unit) => isTestCase(unit) && unit.path === helper.path && unitIdentifiers(unit, units).has(helper.symbol))
    if (callers.length !== 1) {
      helper.supports = callers.map((caller) => caller.id)
      continue
    }
    const [target] = callers
    target!.ranges.push(...helper.ranges)
    target!.code += helper.code
    target!.ranges.sort((a, b) => Number(a.side === 'deleted') - Number(b.side === 'deleted') || a.startLine - b.startLine)
    joinTouching(target!.ranges)
    gone.add(helper)
  }
  return merged.filter((unit) => !gone.has(unit))
}

export interface UnitReference {
  to: string
  kind: Extract<EdgeKind, 'calls' | 'uses' | 'renders'>
  /** True when the name can only mean that unit: it is declared in the same file, or imported from that file by name. */
  certain: boolean
}

/** The local names a JavaScript or TypeScript file imports, each with the module it comes from, as written: `./parser.ts`, `typebox`. */
export function importSpecifiers(text: string): Map<string, string> {
  const names = new Map<string, string>()
  const addList = (list: string, specifier: string) => {
    for (const part of list.split(',')) {
      const local = /(?:\bas\s+|:\s*)([\w$]+)\s*$/.exec(part.trim())?.[1] ?? /^(?:type\s+)?([\w$]+)$/.exec(part.trim())?.[1]
      if (local) names.set(local, specifier)
    }
  }
  for (const match of text.matchAll(/^\s*import\s+(?:type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    const [, clause = '', specifier = ''] = match
    const braces = /\{([^}]*)\}/.exec(clause)
    if (braces) addList(braces[1]!, specifier)
    const bare = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+/, '')
    for (const name of bare.split(',').map((part) => part.trim()).filter(Boolean)) names.set(name, specifier)
  }
  for (const match of text.matchAll(/^\s*(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
    const [, target = '', specifier = ''] = match
    if (target.startsWith('{')) addList(target.slice(1, -1), specifier)
    else names.set(target, specifier)
  }
  return names
}

/** The local names a file imports, each with the stem of the module it comes from. */
function importedNames(text: string): Map<string, string> {
  const names = new Map<string, string>()
  const stemOf = (specifier: string) => fileStem(specifier.replace(/\/index(?:\.\w+)?$/, ''))
  const addList = (list: string, specifier: string) => {
    for (const part of list.split(',')) {
      const local = /(?:\bas\s+|:\s*)([\w$]+)\s*$/.exec(part.trim())?.[1] ?? /^(?:type\s+)?([\w$]+)$/.exec(part.trim())?.[1]
      if (local) names.set(local, stemOf(specifier))
    }
  }
  for (const match of text.matchAll(/^\s*import\s+(?:type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    const [, clause = '', specifier = ''] = match
    const braces = /\{([^}]*)\}/.exec(clause)
    if (braces) addList(braces[1]!, specifier)
    const bare = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+/, '')
    for (const name of bare.split(',').map((part) => part.trim()).filter(Boolean)) names.set(name, stemOf(specifier))
  }
  for (const match of text.matchAll(/^\s*(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
    const [, target = '', specifier = ''] = match
    if (target.startsWith('{')) addList(target.slice(1, -1), specifier)
    else names.set(target, stemOf(specifier))
  }
  for (const match of text.matchAll(/^\s*from\s+([\w.]+)\s+import\s+([^\n#]+)/gm)) addList(match[2]!.replace(/[()]/g, ''), match[1]!.split('.').at(-1)!)
  return names
}

/** Every module a file loads by a path of its own: imports, re-exports, `require` and `require_relative`, as written. */
export function relativeImports(text: string): string[] {
  const found = [
    ...text.matchAll(/^\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/gm),
    ...text.matchAll(/^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm),
    ...text.matchAll(/\b(?:require|import)\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g),
    ...text.matchAll(/^\s*require_relative\s*\(?\s*['"]([^'"]+)['"]/gm),
  ].map((match) => match[1]!)
  return [...new Set(found)]
}

const IMPORT_EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.rb', '.py']

/** The repository path a module path leads to from the file that loads it, as written. Null when it leaves the repository. */
export function importPath(from: string, specifier: string): string | null {
  const parts = from.split('/').slice(0, -1)
  const relative = specifier.startsWith('.') ? specifier : `./${specifier}`
  for (const part of relative.split('/')) {
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.length ? parts.join('/') : null
}

/**
 * The files a module path may name, most likely first: as written, with an extension it may leave out, as the
 * TypeScript file a `.js` path stands for, or as its folder's index.
 */
export function importCandidates(from: string, specifier: string): string[] {
  const path = importPath(from, specifier)
  if (!path) return []
  const stripped = path.replace(/\.(?:js|jsx|mjs|cjs)$/, '')
  return [...new Set([...IMPORT_EXTENSIONS.map((extension) => `${path}${extension}`), ...IMPORT_EXTENSIONS.slice(1).map((extension) => `${stripped}${extension}`), ...IMPORT_EXTENSIONS.slice(1).map((extension) => `${path}/index${extension}`)])]
}

/** The repository path a module path names, among the files `known` says are there. Null when it names none of them. */
export function resolveImport(from: string, specifier: string, known: (path: string) => boolean): string | null {
  return importCandidates(from, specifier).find((candidate) => known(candidate)) ?? null
}

/** The test cases of a file at head that call a name, as their names say them. */
export function testsThatUse(text: string, name: string): string[] {
  const source = splitLines(text)
  const { cases, spans } = functionOwners(source)
  const uses = new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`)
  return [...spans]
    .filter(([key, [start, end]]) => cases.has(key) && source.slice(start, end + 1).some((line) => uses.test(line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' '))))
    .map(([key]) => nameOf(key))
}

/**
 * The changed code a unit mentions by name. Ported from the references pi-coder sends its model, with one
 * addition for a graph: whether the name is certain to mean that unit, which decides if the host draws the wire itself.
 */
export function unitReferences(unit: Unit, units: readonly Unit[], capture: Capture): UnitReference[] {
  const identifiers = unitIdentifiers(unit, units)
  const file = capture.files.find((entry) => entry.id === unit.fileId)
  const imports = file ? importedNames(sideText(file, file.head == null ? 'deleted' : 'added')) : undefined
  const escaped = (symbol: string) => symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return units
    .filter((candidate) => candidate.id !== unit.id && isCode(candidate) && !candidate.loose && identifiers.has(candidate.symbol))
    .map((candidate) => {
      const name = escaped(candidate.symbol)
      const kind = new RegExp(`<${name}[\\s/>]`).test(unit.code) ? 'renders' : new RegExp(`(?<![\\w$])${name}\\s*\\(`).test(unit.code) ? 'calls' : 'uses'
      const certain = candidate.fileId === unit.fileId || imports?.get(candidate.symbol) === fileStem(candidate.path)
      return { to: candidate.id, kind, certain }
    })
}

/** The changed lines no range covers. Ported from pi-coder's `uncoveredStoryChanges`. Empty means full coverage. */
export function uncoveredChanges(changes: readonly ChangeRange[], ranges: readonly UnitRange[]): ChangeRange[] {
  const uncovered: ChangeRange[] = []
  for (const change of changes) {
    const covering = ranges.filter((range) => range.fileId === change.fileId && range.side === change.side && range.startLine <= change.endLine && change.startLine <= range.endLine)
    let startLine: number | undefined
    for (let line = change.startLine; line <= change.endLine; line += 1) {
      if (!covering.some((range) => range.startLine <= line && line <= range.endLine)) {
        startLine ??= line
        continue
      }
      if (startLine != null) {
        uncovered.push({ ...change, startLine, endLine: line - 1 })
        startLine = undefined
      }
    }
    if (startLine != null) uncovered.push({ ...change, startLine, endLine: change.endLine })
  }
  return uncovered
}
