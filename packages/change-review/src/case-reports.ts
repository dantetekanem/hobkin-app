/**
 * Each case's own result, from the report a test runner writes for a run of one test file: a test counts as run only
 * where its runner says how it did. Node's test runner and Bun write JUnit XML and Vitest writes JSON, each to a file
 * beside the output it prints. A case is kept only where the report places it in that file, and its name nests as
 * `suite > case`, as Bun prints it. A report that cannot be read gives no case, and the test is then not shown as run.
 */
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type { TestRun } from './types.ts'

export type Receipt = NonNullable<TestRun['cases']>[number]

/** The runner that reports each case: node's and Bun's in JUnit XML, Vitest's in JSON, with each case's line when it can. */
export type CaseReport = { runner: 'node' | 'bun' } | { runner: 'vitest'; lines: boolean }

/** The runner's arguments that also write its report to `file`, while it prints what it prints without them. */
export function reportArgs(report: CaseReport, file: string): string[] {
  if (report.runner === 'vitest') return ['--reporter=default', '--reporter=json', `--outputFile.json=${file}`, ...(report.lines ? ['--includeTaskLocation'] : [])]
  if (report.runner === 'bun') return ['--reporter=junit', `--reporter-outfile=${file}`]
  return ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=junit', `--test-reporter-destination=${file}`]
}

/** The cases a report gives for the test file at `path`, relative to `cwd`. */
export function reportCases(report: CaseReport, text: string, path: string, cwd: string): Receipt[] {
  return report.runner === 'vitest' ? vitestJsonCases(text, path, cwd) : junitCases(text, path, cwd)
}

const MOST_CASES = 500
const LONGEST_NAME = 500

/** As Bun's: a name given twice tells neither case, and a report past the limits tells none. */
function receipts(found: readonly Receipt[]): Receipt[] {
  if (found.length > MOST_CASES || found.some((item) => item.name.length > LONGEST_NAME)) return []
  const twice = new Set(found.filter((item, index) => found.findIndex((other) => other.name === item.name) !== index).map((item) => item.name))
  return found.filter((item) => !twice.has(item.name))
}

const realOr = (path: string) => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
/** Whether the report's file, absolute or from `cwd`, is the test file: the same path, or the same file once links are followed. */
const isFile = (reported: string, path: string, cwd: string) => {
  const [named, file] = [resolve(cwd, reported), resolve(cwd, path)]
  return named === file || realOr(named) === realOr(file)
}

const TAG = /<(\/?)(testsuite|testcase|skipped|failure|error)\b((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g
const ATTRIBUTE = /([\w:.-]+)="([^"]*)"/g
const ENTITIES: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" }

const decoded = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name: string) => {
    if (name[0] !== '#') return ENTITIES[name] ?? entity
    const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })

function attributes(text: string): Map<string, string> {
  return new Map([...text.matchAll(ATTRIBUTE)].map((match) => [match[1]!, decoded(match[2]!)]))
}

/**
 * The cases of node's or Bun's JUnit report: each `testcase` with the `testsuite`s around it, and its line when given.
 * Both escape `<` everywhere and `"` inside attributes, so every `<` is a tag. Bun's outermost suite is the file, named
 * by its path. A case that names no file, as node 22 writes them, is no one's.
 */
export function junitCases(xml: string, path: string, cwd: string): Receipt[] {
  if (!/<testsuites\b/.test(xml) || !/<\/testsuites>\s*$/.test(xml)) return []
  const found: Receipt[] = []
  // The suites around the case; null for one that is the file itself.
  const suites: (string | null)[] = []
  // The case whose children are being read; null for one that is not this file's.
  let open: { item: Receipt | null; skipped: boolean; failed: boolean } | null = null
  const close = () => {
    // A todo test that throws has both a skip and a failure, and fails nothing.
    if (open?.item) found.push({ ...open.item, status: open.skipped ? 'skipped' : open.failed ? 'failed' : 'passed' })
    open = null
  }
  for (const [, closing, tag, text, selfClosing] of xml.matchAll(TAG)) {
    const said = attributes(text!)
    if (tag === 'testsuite') {
      const name = said.get('name') ?? ''
      if (closing) suites.pop()
      else if (!selfClosing) suites.push(name === said.get('file') ? null : name)
    } else if (tag === 'testcase') {
      if (closing) {
        close()
        continue
      }
      const name = said.get('name')
      const file = said.get('file')
      const line = Number(said.get('line'))
      const named = [...suites.filter((suite) => suite !== null), name].join(' > ')
      const item = name !== undefined && file !== undefined && isFile(file, path, cwd) ? { path, name: named, status: 'passed' as const, ...(Number.isInteger(line) && line > 0 ? { line } : {}) } : null
      open = { item, skipped: false, failed: said.has('failure') }
      if (selfClosing) close()
    } else if (open && !closing) {
      if (tag === 'skipped') open.skipped = true
      else open.failed = true
    }
  }
  return receipts(found)
}

const VITEST_STATUS: Record<string, Receipt['status']> = { passed: 'passed', failed: 'failed', skipped: 'skipped', pending: 'skipped', todo: 'skipped', disabled: 'skipped' }

const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/** The cases of Vitest's JSON report for the file: each one's suites, title, status, and line when it gives one. */
export function vitestJsonCases(json: string, path: string, cwd: string): Receipt[] {
  let report: unknown
  try {
    report = JSON.parse(json)
  } catch {
    return []
  }
  const files = record(report).testResults
  const own = Array.isArray(files) ? files.map(record).filter((file) => typeof file.name === 'string' && isFile(file.name, path, cwd)) : []
  if (own.length !== 1 || !Array.isArray(own[0]!.assertionResults)) return []
  const found = own[0]!.assertionResults.flatMap((value): Receipt[] => {
    const { ancestorTitles: suites, title, status, location } = record(value)
    const result = typeof status === 'string' ? VITEST_STATUS[status] : undefined
    if (typeof title !== 'string' || !result || !Array.isArray(suites) || !suites.every((suite) => typeof suite === 'string')) return []
    const line = record(location).line
    return [{ path, name: [...suites, title].join(' > '), status: result, ...(Number.isInteger(line) && (line as number) > 0 ? { line: line as number } : {}) }]
  })
  return receipts(found)
}
