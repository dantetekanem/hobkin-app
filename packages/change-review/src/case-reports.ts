/**
 * Each case's own result, from the report a test runner gives for a run of one test file: a test counts as run only
 * where its runner says how it did. Node's test runner and Bun write JUnit XML and Vitest writes JSON, each to a file
 * beside the output it prints, and Minitest prints a line for each case when verbose. A case is kept only where the
 * report places it in that file, and its name nests as `suite > case`, as Bun prints it, or is Minitest's
 * `Class#test_name`. A report that cannot be read gives no case, and the test is then not shown as run.
 */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TestRun } from './types.ts'

export type Receipt = NonNullable<TestRun['cases']>[number]

/**
 * The runner that reports each case: node's and Bun's in JUnit XML and Vitest's in JSON, with each case's line when it
 * can, each in a file it writes; Minitest's in the lines it prints when verbose.
 */
export type CaseReport = { runner: 'node' | 'bun' } | { runner: 'vitest'; lines: boolean } | { runner: 'minitest' }

/** Whether the runner writes its report to a file. */
export const writesFile = (report: CaseReport) => report.runner !== 'minitest'

/**
 * The runner's arguments that also give its report, while it prints what it prints without them: Minitest's verbose
 * lines, or the report written to `file`. A runner that writes one gets none without a file to write to.
 */
export function reportArgs(report: CaseReport, file: string | null): string[] {
  if (report.runner === 'minitest') return ['-v']
  if (file === null) return []
  if (report.runner === 'vitest') {
    const lines = report.lines ? ['--includeTaskLocation'] : []
    return ['--reporter=default', '--reporter=json', `--outputFile.json=${file}`, ...lines]
  }
  if (report.runner === 'bun') return ['--reporter=junit', `--reporter-outfile=${file}`]
  return ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=junit', `--test-reporter-destination=${file}`]
}

/** The cases a report file gives for the test file at `path`, relative to `cwd`. */
export function reportCases(report: Exclude<CaseReport, { runner: 'minitest' }>, text: string, path: string, cwd: string): Receipt[] {
  return report.runner === 'vitest' ? vitestJsonCases(text, path, cwd) : junitCases(text, path, cwd)
}

const MOST_CASES = 500
const LONGEST_NAME = 500

/** As Bun's: a name given twice tells neither case, and a report past the limits tells none. */
function receipts(found: readonly Receipt[]): Receipt[] {
  if (found.length > MOST_CASES || found.some((item) => item.name.length > LONGEST_NAME)) return []
  const counts = new Map<string, number>()
  for (const item of found) counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
  return found.filter((item) => counts.get(item.name) === 1)
}

/** The case's line, when the report gives a real one. */
const lineOf = (line: unknown): { line?: number } => (typeof line === 'number' && Number.isInteger(line) && line > 0 ? { line } : {})

const realOr = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Whether the report's file, absolute or from `cwd`, is the test file: the same path, or the same file once links are followed. */
function isFile(reported: string, path: string, cwd: string): boolean {
  const named = resolve(cwd, reported)
  const file = resolve(cwd, path)
  return named === file || realOr(named) === realOr(file)
}

// ───────────────────────── JUnit: node and Bun ─────────────────────────

const TAG = /<(\/?)(testsuite|testcase|skipped|failure|error)\b((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g
const ATTRIBUTE = /([\w:.-]+)="([^"]*)"/g
const ENTITIES = new Map([
  ['quot', '"'],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['apos', "'"],
])

function decoded(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return ENTITIES.get(name) ?? entity
    const hex = name[1] === 'x' || name[1] === 'X'
    const code = hex ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

function attributes(text: string): Map<string, string> {
  return new Map([...text.matchAll(ATTRIBUTE)].map((match) => [match[1]!, decoded(match[2]!)]))
}

/** A `testcase` whose children are being read. `item` is null for a case that is not this file's. */
interface OpenCase {
  item: Omit<Receipt, 'status'> | null
  skipped: boolean
  failed: boolean
}

/** A todo test that throws has both a skip and a failure, and fails nothing. */
const statusOf = (open: OpenCase): Receipt['status'] => (open.skipped ? 'skipped' : open.failed ? 'failed' : 'passed')

/** This file's case that a `testcase` names, inside the suites around it; null for another file's, or one that names no file. */
function caseOf(said: ReadonlyMap<string, string>, suites: readonly (string | null)[], path: string, cwd: string): OpenCase['item'] {
  const name = said.get('name')
  const file = said.get('file')
  if (name === undefined || file === undefined || !isFile(file, path, cwd)) return null
  const named = [...suites.filter((suite) => suite !== null), name].join(' > ')
  return { path, name: named, ...lineOf(Number(said.get('line'))) }
}

/**
 * The cases of node's or Bun's JUnit report: each `testcase` with the `testsuite`s around it, and its line when given.
 * Both escape `<` everywhere and `"` inside attributes, so every `<` is a tag. Bun's outermost suite is the file, named
 * by its path. A case that names no file, as node 22 writes them, is no one's.
 */
export function junitCases(xml: string, path: string, cwd: string): Receipt[] {
  if (!/<testsuites\b/.test(xml) || !/<\/testsuites>\s*$/.test(xml)) return []

  const found: Receipt[] = []
  // The suites around the case; null for the suite that is the file itself.
  const suites: (string | null)[] = []
  let open: OpenCase | null = null

  for (const [, closing, tag, text, selfClosing] of xml.matchAll(TAG)) {
    const said = attributes(text ?? '')
    if (tag === 'testsuite') {
      const name = said.get('name') ?? ''
      if (closing) suites.pop()
      else if (!selfClosing) suites.push(name === said.get('file') ? null : name)
      continue
    }
    if (tag !== 'testcase') {
      // A skip, a failure or an error inside the open case.
      if (open && !closing) {
        if (tag === 'skipped') open.skipped = true
        else open.failed = true
      }
      continue
    }
    if (!closing) open = { item: caseOf(said, suites, path, cwd), skipped: false, failed: said.has('failure') }
    if (closing || selfClosing) {
      if (open?.item) found.push({ ...open.item, status: statusOf(open) })
      open = null
    }
  }
  return receipts(found)
}

// ───────────────────────── Vitest's JSON ─────────────────────────

const VITEST_STATUS = new Map<unknown, Receipt['status']>([
  ['passed', 'passed'],
  ['failed', 'failed'],
  ['skipped', 'skipped'],
  ['pending', 'skipped'],
  ['todo', 'skipped'],
  ['disabled', 'skipped'],
])

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

function parsed(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** One case of Vitest's report: none when it has no title, suites or status it knows. */
function vitestCase({ ancestorTitles: suites, title, status, location }: Record<string, unknown>, path: string): Receipt[] {
  const result = VITEST_STATUS.get(status)
  if (!result || typeof title !== 'string' || !Array.isArray(suites) || !suites.every((suite) => typeof suite === 'string')) return []
  return [{ path, name: [...suites, title].join(' > '), status: result, ...lineOf(record(location).line) }]
}

/** The cases of Vitest's JSON report for the file: each one's suites, title, status, and line when it gives one. */
export function vitestJsonCases(json: string, path: string, cwd: string): Receipt[] {
  const files = record(parsed(json)).testResults
  const own = Array.isArray(files) ? files.map(record).filter((file) => typeof file.name === 'string' && isFile(file.name, path, cwd)) : []
  const [file, ...others] = own
  if (!file || others.length > 0 || !Array.isArray(file.assertionResults)) return []
  return receipts(file.assertionResults.flatMap((result) => vitestCase(record(result), path)))
}

// ───────────────────────── Minitest's verbose lines ─────────────────────────

const ANSI = /\x1b\[[\d;]*m/g
/** A case's result as Minitest's and Rails' reporters print it, `Class#test_name = 0.01 s = .`, or minitest-reporters', `Class#test_name 0.01 = .`. */
const MINITEST_RESULT = /^([A-Za-z_][\w:]*#test_\S*)(?: = \d+\.\d+ s = | \d+\.\d+ = )([.FES])$/
/** A case started and not yet recorded: what those reporters print before its result. */
const MINITEST_STARTED = /^[A-Za-z_][\w:]*#test_\S*(?: =)? $/
const MINITEST_STATUS = new Map<string, Receipt['status']>([
  ['.', 'passed'],
  ['F', 'failed'],
  ['E', 'failed'],
  ['S', 'skipped'],
])

/**
 * The cases Minitest's verbose output gives for the one test file a run ran, by class and test name. Only the file was
 * run, so its cases are its own. Output kept from its end only (`cut`) starts inside a line, which is dropped. A case
 * started while another was not yet recorded, as threads can make these reporters print, leaves every result line in
 * doubt, so none is kept.
 */
export function minitestCases(output: string, path: string, cut: boolean): Receipt[] {
  const lines = output.replace(ANSI, '').split(/\r?\n/)
  if (cut) lines.shift()
  if (lines.some((line) => MINITEST_STARTED.test(line))) return []
  const found = lines.flatMap((line): Receipt[] => {
    const match = MINITEST_RESULT.exec(line)
    const status = match ? MINITEST_STATUS.get(match[2]!) : undefined
    return match && status ? [{ path, name: match[1]!, status }] : []
  })
  return receipts(found)
}
