/**
 * Proof by running the repository's own tests where the change is checked out (FOUNDATION 4.2). A test proves a
 * definition when it passes at head and fails once that definition is changed: a modified definition gets its own
 * changes put back to base, an added one is made to throw. The changed file gets its exact bytes back before anything
 * else runs, and the proof refuses a checkout that is not exactly the change. No coverage tooling, clone or sandbox.
 */
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join, resolve, sep } from 'node:path'
import { gitRepo, runProgram, type GitRepo, type ProgramRun } from './git.ts'
import type { FileDiff, Finding, Hunk, Proof, ReviewNode, Scan, TestRun } from './types.ts'

// ───────────────────────── Runbook ─────────────────────────

export const RUN_TIMEOUT_MS = 180_000

/** How this repository runs given test files. */
export interface Runbook {
  /** The program and its first arguments; the test files follow them. */
  command: string[]
  filesAt: 'end'
  /** Added to the environment of every run. */
  env: Record<string, string>
  /** Most time one run may take. */
  timeoutMs: number
  /** Endings of the test files it runs, such as `_test.rb`. Empty: any file. */
  accepts: string[]
  /** How it was found, in words. */
  source: string
}

/** A runbook the repository's configuration names, for repositories detection gets wrong. */
export interface RunbookOverride {
  command: string[]
  filesAt?: 'end'
  env?: Record<string, string>
  timeoutMs?: number
}

const SCRIPT_FILES = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']
/** The endings of a JavaScript or TypeScript test file. A fixture or helper beside the tests is not one, and running it may never end. */
const SCRIPT_TEST_FILES = SCRIPT_FILES.flatMap((ending) => [`.test${ending}`, `.spec${ending}`, `_test${ending}`, `-test${ending}`])

const isFolder = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
const readOr = (path: string) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
const object = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {})

/**
 * The runbook for the checkout at `cwd`: the override when given, else Ruby's (a Rails app is first a Ruby app, even
 * with JavaScript tests beside it), else the one package.json names. Runners are only used where they are installed;
 * nothing is fetched to run them. Null when nothing fits, and then proof is unknown.
 */
export function detectRunbook(cwd: string, override?: RunbookOverride): Runbook | null {
  if (override) return overrideRunbook(override)
  return rubyRunbook(cwd) ?? packageRunbook(cwd)
}

function overrideRunbook({ command, filesAt, env = {}, timeoutMs = RUN_TIMEOUT_MS }: RunbookOverride): Runbook {
  if (!Array.isArray(command) || command.length === 0 || !command.every((word) => typeof word === 'string' && word !== '')) {
    throw new TypeError('A runbook override needs a command: the program and its arguments, as a list of words.')
  }
  if (filesAt !== undefined && filesAt !== 'end') throw new TypeError("A runbook override can only take test files at the end ('end').")
  return { command: [...command], filesAt: 'end', env: { ...env }, timeoutMs, accepts: [], source: 'the configured runbook' }
}

const runbook = (command: string[], accepts: string[], source: string): Runbook => ({ command, filesAt: 'end', env: {}, timeoutMs: RUN_TIMEOUT_MS, accepts, source })

function rubyRunbook(cwd: string): Runbook | null {
  if (existsSync(join(cwd, 'bin/rails')) && isFolder(join(cwd, 'test'))) return runbook([join(cwd, 'bin/rails'), 'test'], ['_test.rb'], 'bin/rails with a test folder')
  if (isFolder(join(cwd, 'spec')) && /\brspec\b/.test(readOr(join(cwd, 'Gemfile')) + readOr(join(cwd, 'Gemfile.lock')))) {
    return runbook(['bundle', 'exec', 'rspec'], ['_spec.rb'], 'a spec folder with rspec in the Gemfile')
  }
  return null
}

function packageRunbook(cwd: string): Runbook | null {
  let pkg: Record<string, unknown>
  try {
    pkg = object(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')))
  } catch {
    return null
  }
  const script = typeof object(pkg.scripts).test === 'string' ? (object(pkg.scripts).test as string) : ''
  const dependencies = { ...object(pkg.dependencies), ...object(pkg.devDependencies) }
  const bin = (name: string) => join(cwd, 'node_modules', '.bin', name)
  // The node that runs this package runs node --test too: an app opened from the Finder may have no node on PATH.
  if (/\bnode\b[^&|;]*\s--test\b/.test(script)) return runbook([process.execPath, '--test'], SCRIPT_TEST_FILES, 'the test script in package.json runs node --test')
  const vitest = existsSync(bin('vitest')) ? runbook([bin('vitest'), 'run'], SCRIPT_TEST_FILES, 'vitest, from package.json') : null
  const jest = existsSync(bin('jest')) ? runbook([bin('jest'), '--runTestsByPath'], SCRIPT_TEST_FILES, 'jest, from package.json') : null
  if (/\bvitest\b/.test(script) && vitest) return vitest
  if (/\bjest\b/.test(script) && jest) return jest
  if ('vitest' in dependencies && vitest) return vitest
  if ('jest' in dependencies && jest) return jest
  return null
}

const accepts = (book: Runbook, path: string) => book.accepts.length === 0 || book.accepts.some((ending) => path.endsWith(ending))

// ───────────────────────── Candidates ─────────────────────────

/** A test file that may prove a node. */
export interface TestCandidate {
  path: string
  /** Why it was chosen. */
  why: string
  /** It moves through the request life cycle: request, controller, integration, system or job test. */
  lifecycle: boolean
  /** This diff added or changed it. */
  changed: boolean
}

/** The name a symbol is called by: `total` for `Cart#total`, `Shop.total` or `Billing::Cart.total`. */
function shortName(symbol: string): string {
  return symbol.split(/#|::|\./).filter(Boolean).at(-1) ?? symbol
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The name as a whole word: `total`, not `subtotal` or `totals`. */
const asWord = (name: string) => new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`)

/** Test files named after a source file by the usual conventions, most likely first. */
function conventionNames(path: string): string[] {
  const ending = extname(path)
  const stem = path.slice(0, path.length - ending.length)
  const segments = stem.split('/')
  const name = segments.at(-1)!
  const joined = (...parts: (string | string[])[]) => parts.flat().filter(Boolean).join('/')
  if (ending === '.rb') {
    const app = segments.lastIndexOf('app')
    const lib = segments.lastIndexOf('lib')
    if (app >= 0) {
      const [root, rest] = [segments.slice(0, app), segments.slice(app + 1)]
      return [joined(root, 'test', rest) + '_test.rb', joined(root, 'spec', rest) + '_spec.rb']
    }
    if (lib >= 0) {
      const [root, rest] = [segments.slice(0, lib), segments.slice(lib + 1)]
      return [joined(root, 'test', 'lib', rest) + '_test.rb', joined(root, 'spec', 'lib', rest) + '_spec.rb', joined(root, 'test', rest) + '_test.rb', joined(root, 'spec', rest) + '_spec.rb']
    }
    return [joined('test', segments) + '_test.rb', joined('spec', segments) + '_spec.rb']
  }
  if (!SCRIPT_FILES.includes(ending)) return []
  const folder = segments.slice(0, -1)
  const names = [joined(folder, `${name}.test${ending}`), joined(folder, `${name}.spec${ending}`), joined(folder, '__tests__', `${name}.test${ending}`)]
  const src = folder.lastIndexOf('src')
  if (src >= 0) names.push(joined(folder.slice(0, src), 'test', folder.slice(src + 1), `${name}.test${ending}`), joined(folder.slice(0, src), 'test', `${name}.test${ending}`))
  names.push(joined('test', `${name}.test${ending}`))
  return [...new Set(names)]
}

/** Whether a script's text imports a file: a module path that ends with the file's name, with or without its ending. */
function importsFile(text: string | null, path: string): boolean {
  if (text === null) return false
  const ending = extname(path)
  const parts = path.slice(0, path.length - ending.length).split('/')
  // An index file is imported by its folder's name.
  const name = parts.at(-1) === 'index' && parts.length > 1 ? parts.at(-2)! : parts.at(-1)!
  // The name must be the whole last part of the module path: `./model`, `@/home/model.ts`, never `./main-model`.
  return new RegExp(`['"](?:[^'"\\n]*/)?${escape(name)}(?:/index)?(?:\\.[cm]?[jt]sx?)?['"]`).test(text)
}

/**
 * The test files that may prove a node: the tests the scan links to it, the test files this diff changed that name
 * it, and the files named after its source file. Only files that exist are kept, the node's own file never.
 */
export async function candidateTests({
  node,
  scan,
  changedTestPaths,
  isLifecycleTest,
  exists,
  read,
}: {
  node: Pick<ReviewNode, 'id' | 'symbol' | 'path'>
  scan: Pick<Scan, 'anchors'>
  changedTestPaths: readonly string[]
  isLifecycleTest: (path: string) => boolean
  exists: (path: string) => boolean | Promise<boolean>
  /** A test file's text in the checkout, or null. */
  read: (path: string) => string | null | Promise<string | null>
}): Promise<TestCandidate[]> {
  const reasons = new Map<string, string[]>()
  const add = (path: string, why: string) => {
    if (path === node.path) return
    const said = reasons.get(path) ?? []
    if (!said.includes(why)) reasons.set(path, [...said, why])
  }
  const anchor = scan.anchors.find((item) => item.id === node.id) ?? scan.anchors.find((item) => item.path === node.path && item.symbol === node.symbol)
  // The scan links tests by name, and a common name reaches tests of other code. In JavaScript and TypeScript a test
  // that runs the definition directly imports its file; one that goes through the life cycle is kept on its name.
  const script = SCRIPT_FILES.includes(extname(node.path))
  for (const test of anchor?.tests ?? []) {
    if (script && !isLifecycleTest(test.path) && !importsFile(await read(test.path), node.path)) continue
    add(test.path, `the scan links it to ${node.symbol}`)
  }
  const name = shortName(node.symbol)
  const named = asWord(name)
  for (const path of changedTestPaths) {
    const text = await read(path)
    if (text !== null && named.test(text)) add(path, `this diff changed it and it names ${name}`)
  }
  for (const path of conventionNames(node.path)) add(path, `named after ${node.path}`)

  const changed = new Set(changedTestPaths)
  const candidates: TestCandidate[] = []
  for (const [path, why] of reasons) {
    if (await exists(path)) candidates.push({ path, why: why.join('; '), lifecycle: isLifecycleTest(path), changed: changed.has(path) })
  }
  return candidates
}

// ───────────────────────── Mutations ─────────────────────────

/** The file as a mutation leaves it, or why the mutation could not be made safely. */
export type Mutation = { text: string } | { why: string }

/**
 * Lines a diff replaced, with the place their new lines start at head, and the unchanged lines on either side of
 * them in the hunk. A block with no new lines is a deletion at that place.
 */
interface Block {
  newStart: number
  plus: string[]
  minus: string[]
  before: string[]
  after: string[]
}

/** The runs of changed lines in hunks, split at unchanged lines: one hunk can hold changes to several definitions. */
function blocksOf(hunks: readonly Hunk[]): Block[] {
  const blocks: Block[] = []
  for (const hunk of hunks) {
    let newLine = hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart
    let context: string[] = []
    let block: Block | null = null
    for (const line of hunk.lines) {
      const sign = line[0]
      if (sign === '+' || sign === '-') {
        if (!block) {
          block = { newStart: newLine, plus: [], minus: [], before: context, after: [] }
          blocks.push(block)
        }
        if (sign === '+') {
          block.plus.push(line.slice(1))
          newLine += 1
        } else block.minus.push(line.slice(1))
        continue
      }
      if (block) {
        context = []
        block.after = context
        block = null
      }
      context.push(line.slice(1))
      newLine += 1
    }
  }
  return blocks
}

/** How many lines at the end of `lines` start `beside` (`where: 'end'`), or at its start end `beside` (`'start'`). */
function shared(lines: readonly string[], beside: readonly string[], where: 'end' | 'start'): number {
  for (let size = Math.min(lines.length, beside.length); size > 0; size--) {
    const ours = where === 'end' ? lines.slice(-size) : lines.slice(0, size)
    const theirs = where === 'end' ? beside.slice(0, size) : beside.slice(-size)
    if (ours.every((line, index) => line === theirs[index])) return size
  }
  return 0
}

/**
 * The part of a block that is the definition's own change, or null when it has none. A block can run past the
 * definition, as when git matches its old closing brace with the brace of a definition added below it. The same
 * change is then aligned again: new lines at the definition's edge that repeat the unchanged lines beside the block
 * become those unchanged lines, the new lines past the edge become an insertion of their own, and every removed
 * line stays with the definition. Both alignments describe the same diff; the parse check still guards the result.
 */
function ownPart(block: Block, start: number, end: number): Block | null {
  const deletionInside = (at: number) => at > start && at <= end
  if (block.plus.length === 0) return deletionInside(block.newStart) ? block : null
  const last = block.newStart + block.plus.length - 1
  if (last < start || block.newStart > end) return null
  let { newStart, plus } = block
  if (last > end) {
    const inside = plus.slice(0, end - newStart + 1)
    plus = inside.slice(0, inside.length - shared(inside, block.after, 'end'))
  }
  if (newStart < start) {
    const inside = plus.slice(start - newStart)
    const unchanged = shared(inside, block.before, 'start')
    plus = inside.slice(unchanged)
    newStart = start + unchanged
  }
  if (plus.length === 0 && !deletionInside(newStart)) return null
  return { ...block, newStart, plus }
}

/** The file with the changes inside lines `start` to `end` put back to base, every other change kept. */
export function revertNode(text: string, [start, end]: readonly [number, number], diff: FileDiff | undefined): Mutation {
  if (!diff || diff.hunks.length === 0) return { why: 'the diff has no changes for this file.' }
  const own = blocksOf(diff.hunks).flatMap((block) => ownPart(block, start, end) ?? [])
  if (own.length === 0) return { why: `none of the changes in the diff sit inside lines ${start} to ${end}.` }
  const lines = text.split('\n')
  for (const block of own.reverse()) {
    const at = block.newStart - 1
    const there = lines.slice(at, at + block.plus.length)
    if (there.length !== block.plus.length || there.some((line, index) => line !== block.plus[index])) {
      return { why: `the file does not hold what the diff says it holds at line ${block.newStart}.` }
    }
    lines.splice(at, block.plus.length, ...block.minus)
  }
  return { text: lines.join('\n') }
}

/** Script files a probe can be checked in. JSX has no parser here. */
const PROBED_SCRIPTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'])
const TYPESCRIPT = new Set(['.ts', '.mts', '.cts'])

/**
 * The file with the definition in lines `node.lines` made to fail as soon as it runs: its body becomes one failing
 * statement that names the node. Placed only where the body is found from the code's own structure, and only in a
 * language whose result can be checked to still parse.
 */
export function probeNode(text: string, node: { id: string; path: string; lines: readonly [number, number] }): Mutation {
  const [start, end] = node.lines
  const lines = text.split('\n')
  if (start < 1 || end < start || end > lines.length) return { why: `lines ${start} to ${end} are not in the file.` }
  const marker = `change-review probe ${node.id.replace(/[^\w.-]/g, '_')}`
  const ending = extname(node.path)
  if (ending === '.rb') return probeRuby(lines, start, end, marker)
  if (PROBED_SCRIPTS.has(ending)) return probeScript(text, lines, start, end, marker)
  return { why: `no probe is placed in ${ending || 'extensionless'} files: nothing here can check that the result still parses.` }
}

function probeScript(text: string, lines: string[], start: number, end: number, marker: string): Mutation {
  const none = { why: `no function body to replace was found in lines ${start} to ${end}.` }
  const from = lines.slice(0, start - 1).reduce((sum, line) => sum + line.length + 1, 0)
  const region = lines.slice(start - 1, end).join('\n')
  const shape = codeShape(region)
  if (!shape) return none
  // A semicolon or comma after the definition ends the statement, not the body.
  let mark = shape.marks.length - 1
  while (mark >= 0 && (region[shape.marks[mark]!] === ';' || region[shape.marks[mark]!] === ',')) mark -= 1
  if (mark < 0) return none
  const last = shape.marks[mark]!
  const failing = `throw new Error('${marker}')`
  if (region[last] === '}') {
    const open = shape.pairs.get(last)
    return open === undefined ? none : { text: `${text.slice(0, from + open + 1)} ${failing} ${text.slice(from + last)}` }
  }
  // An arrow function with an expression for a body.
  const arrow = shape.arrows[0]
  return arrow === undefined ? none : { text: `${text.slice(0, from + arrow + 2)} { ${failing} }${text.slice(from + last + 1)}` }
}

interface CodeShape {
  /** Where each token ends: words, strings, punctuation. Comments and spaces are not tokens. */
  marks: number[]
  /** For each closing brace, its opening one. */
  pairs: Map<number, number>
  /** Arrows (`=>`) outside any bracket. */
  arrows: number[]
}

const REGEX_AFTER = new Set([...'(,=:[!&|?{};+-*%<>~^'])
const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await'])
const CLOSES: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/**
 * The bracket structure of JavaScript or TypeScript code, reading past strings, templates, comments and regular
 * expressions. Null when the code does not balance, which a definition always does.
 */
function codeShape(code: string): CodeShape | null {
  const marks: number[] = []
  const pairs = new Map<number, number>()
  const arrows: number[] = []
  const open: { char: string; at: number }[] = []
  let previous = ''
  let template = false
  let at = 0
  while (at < code.length) {
    const char = code[at]!
    if (template) {
      if (char === '\\') at += 2
      else if (char === '`') {
        template = false
        marks.push(at)
        previous = '`'
        at += 1
      } else if (char === '$' && code[at + 1] === '{') {
        open.push({ char: '${', at: at + 1 })
        template = false
        previous = '{'
        at += 2
      } else at += 1
      continue
    }
    if (char === '/' && code[at + 1] === '/') {
      const newline = code.indexOf('\n', at)
      at = newline < 0 ? code.length : newline
      continue
    }
    if (char === '/' && code[at + 1] === '*') {
      const close = code.indexOf('*/', at + 2)
      if (close < 0) return null
      at = close + 2
      continue
    }
    if (/\s/.test(char)) {
      at += 1
      continue
    }
    if (char === '"' || char === "'") {
      let next = at + 1
      while (next < code.length && code[next] !== char) {
        if (code[next] === '\n') return null
        next += code[next] === '\\' ? 2 : 1
      }
      if (next >= code.length) return null
      marks.push(next)
      previous = char
      at = next + 1
      continue
    }
    if (char === '`') {
      template = true
      at += 1
      continue
    }
    if (char === '/' && (previous === '' || REGEX_AFTER.has(previous) || REGEX_AFTER_WORDS.has(previous))) {
      let next = at + 1
      let inClass = false
      while (next < code.length && (inClass || code[next] !== '/')) {
        if (code[next] === '\n') return null
        if (code[next] === '\\') next += 1
        else if (code[next] === '[') inClass = true
        else if (code[next] === ']') inClass = false
        next += 1
      }
      if (next >= code.length) return null
      next += 1
      while (next < code.length && /[a-z]/i.test(code[next]!)) next += 1
      marks.push(next - 1)
      previous = 'regex'
      at = next
      continue
    }
    if (/[\w$]/.test(char)) {
      let next = at
      while (next < code.length && /[\w$]/.test(code[next]!)) next += 1
      marks.push(next - 1)
      previous = code.slice(at, next)
      at = next
      continue
    }
    if (char === '=' && code[at + 1] === '>') {
      if (open.length === 0) arrows.push(at)
      marks.push(at + 1)
      previous = '=>'
      at += 2
      continue
    }
    if (char === '(' || char === '[' || char === '{') open.push({ char, at })
    else if (char in CLOSES) {
      const opened = open.pop()
      if (!opened) return null
      if (opened.char === '${') {
        if (char !== '}') return null
        template = true
        at += 1
        continue
      }
      if (opened.char !== CLOSES[char]) return null
      if (char === '}') pairs.set(at, opened.at)
    }
    marks.push(at)
    previous = char
    at += 1
  }
  return template || open.length ? null : { marks, pairs, arrows }
}

const count = (line: string, char: string) => line.split(char).length - 1

/** A Ruby `def` with a body and an `end`: the body becomes a `raise`. */
function probeRuby(lines: string[], start: number, end: number, marker: string): Mutation {
  const none = { why: `no def with a body and an end was found in lines ${start} to ${end}.` }
  const first = lines[start - 1]!
  if (end <= start || !/^\s*def\s/.test(first) || !/^\s*end\b\s*(#.*)?$/.test(lines[end - 1]!)) return none
  // The signature ends on the line where its parentheses close.
  let signatureEnd = start - 1
  let depth = 0
  for (; signatureEnd < end - 1; signatureEnd++) {
    depth += count(lines[signatureEnd]!, '(') - count(lines[signatureEnd]!, ')')
    if (depth <= 0) break
  }
  if (depth > 0 || signatureEnd >= end - 1) return none
  const body = lines.slice(signatureEnd + 1, end - 1)
  const indent = body.find((line) => line.trim())?.match(/^\s*/)?.[0] ?? `${first.match(/^\s*/)![0]}  `
  return { text: [...lines.slice(0, signatureEnd + 1), `${indent}raise '${marker}'`, ...lines.slice(end - 1)].join('\n') }
}

// ───────────────────────── Parse check ─────────────────────────

/** Why the changed text is not safe to run, or null when it parses wherever the original does. */
export type ParseCheck = (path: string, original: string, changed: string) => Promise<string | null>

const CHECK_TIMEOUT_MS = 20_000

/**
 * Parses each text without running it: as a module, else as a CommonJS body, after stripping TypeScript's types.
 * Runs in a node of its own, since parsing a module needs a flag this process was not started with.
 */
const SCRIPT_CHECK = `
const vm = require('node:vm')
const { stripTypeScriptTypes } = require('node:module')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const { typescript, texts } = JSON.parse(input)
  const parses = (text) => {
    let code = text
    if (typescript) {
      if (typeof stripTypeScriptTypes !== 'function') return false
      try { code = stripTypeScriptTypes(text) } catch { return false }
    }
    try { new vm.SourceTextModule(code); return true } catch {}
    try { vm.compileFunction(code, ['exports', 'require', 'module', '__filename', '__dirname']); return true } catch {}
    return false
  }
  process.stdout.write(JSON.stringify(texts.map(parses)))
})
`

async function scriptsParse(typescript: boolean, texts: string[]): Promise<boolean[] | null> {
  const run = await runProgram(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', SCRIPT_CHECK], {
    cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? '' },
    timeoutMs: CHECK_TIMEOUT_MS,
    input: JSON.stringify({ typescript, texts }),
  })
  if (!run.started || run.code !== 0) return null
  try {
    const answer: unknown = JSON.parse(run.stdout.toString('utf8'))
    return Array.isArray(answer) && answer.length === texts.length && answer.every((item) => typeof item === 'boolean') ? answer : null
  } catch {
    return null
  }
}

async function rubyParses(texts: string[]): Promise<boolean[] | null> {
  const answers: boolean[] = []
  for (const text of texts) {
    const run = await runProgram('ruby', ['-c'], { cwd: tmpdir(), timeoutMs: CHECK_TIMEOUT_MS, input: text })
    if (!run.started || run.timedOut) return null
    answers.push(run.code === 0)
  }
  return answers
}

/** The parse check this package has: JavaScript and TypeScript through node, Ruby through `ruby -c`. */
export const checkParses: ParseCheck = async (path, original, changed) => {
  const ending = extname(path)
  const verdict = ending === '.rb' ? await rubyParses([original, changed]) : PROBED_SCRIPTS.has(ending) ? await scriptsParse(TYPESCRIPT.has(ending), [original, changed]) : null
  if (!verdict) return `nothing here can check that ${path} still parses.`
  if (!verdict[0]) return `${path} does not parse here as it is, so a changed copy cannot be checked.`
  if (!verdict[1]) return `the changed ${path} would not parse.`
  return null
}

// ───────────────────────── The value ─────────────────────────

export interface NodeProof {
  value: Proof
  evidence: string
  /** The test files that failed on the mutation and passed again alone at head: they observe the definition. */
  observedBy: string[]
  /** Doubles of the definition found in those files, as `path:line: text`. */
  doubles: string[]
  /** The test files that ran with the definition changed and still passed: they ran, and do not observe it. */
  stillPass: string[]
}

/**
 * How one test file did with the definition changed. `not-run`: the runner found no test in it. `unsettled`: it
 * failed with the change made, and failed again when run alone at head with nothing changed.
 */
export interface Observation {
  candidate: TestCandidate
  outcome: 'passed' | 'failed' | 'timed-out' | 'not-run' | 'unsettled'
  doubles: string[]
}

const listed = (paths: readonly string[]) => (paths.length <= 1 ? (paths[0] ?? '') : `${paths.slice(0, -1).join(', ')} and ${paths.at(-1)}`)
const fail = (paths: readonly string[]) => `${listed(paths)} ${paths.length === 1 ? 'fails' : 'fail'}`
const lifecycleTests = (size: number) => (size === 1 ? 'a life-cycle test' : 'life-cycle tests')

/**
 * The proof a mutation's runs give (FOUNDATION 4.2). Only a test that failed observes the change; one that was cut
 * short, that the runner did not run, or that fails at head too proves nothing either way. A failing test that stubs
 * the definition is coverage, not validation.
 */
export function proofOf({ symbol, mutation, observations, timeoutMs }: { symbol: string; mutation: 'revert' | 'probe'; observations: readonly Observation[]; timeoutMs?: number }): NodeProof {
  const what = mutation === 'revert' ? `${symbol} is put back to base` : `${symbol} is made to throw`
  const paths = (items: readonly Observation[]) => items.map((item) => item.candidate.path)
  const ended = (outcome: Observation['outcome']) => paths(observations.filter((item) => item.outcome === outcome))
  const failed = observations.filter((item) => item.outcome === 'failed')
  const observedBy = paths(failed)
  const doubles = failed.flatMap((item) => item.doubles)
  const stillPass = ended('passed')
  const answer = (value: Proof, evidence: string): NodeProof => ({ value, evidence, observedBy, doubles, stillPass })

  if (failed.length === 0) {
    const cut = ended('timed-out')
    if (cut.length) return answer('unknown', `${listed(cut)} did not finish within ${timeoutMs ? `${timeoutMs / 1000} seconds` : 'the time limit'} when ${what}.`)
    const unsettled = ended('unsettled')
    if (unsettled.length) return answer('unknown', `${fail(unsettled)} when ${what}, and again at head with nothing changed: that failure does not show the change.`)
    const notRun = ended('not-run')
    if (notRun.length) return answer('unknown', `the test runner found no test to run in ${listed(notRun)} when ${what}.`)
    const passed = paths(observations)
    const one = passed.length === 1
    return answer('none', `${listed(passed)} ${one ? 'still passes' : 'still pass'} when ${what}: nothing in ${one ? 'it' : 'them'} ${mutation === 'revert' ? 'checks the change' : 'reaches it'}.`)
  }
  const real = failed.filter((item) => item.doubles.length === 0)
  if (real.length === 0) return answer('mocked', `only tests that stub ${symbol} fail when ${what}: ${doubles.join('; ')}.`)
  const changedFlows = real.filter((item) => item.candidate.lifecycle && item.candidate.changed)
  if (changedFlows.length) return answer('lifecycle-observed', `${fail(paths(changedFlows))} when ${what}: ${lifecycleTests(changedFlows.length)} this diff added or changed.`)
  const flows = real.filter((item) => item.candidate.lifecycle)
  if (flows.length) return answer('lifecycle', `${fail(paths(flows))} when ${what}: ${lifecycleTests(flows.length)} this diff did not change.`)
  return answer('isolated', `${fail(paths(real))} when ${what}; no life-cycle test does.`)
}

/**
 * The lines of a test file that put a double in place of the definition. A pattern holding the word `sym` names the
 * definition there, as in `stub(:sym`; any other pattern counts on a line that names the definition or its module.
 */
export function doublesIn(text: string, path: string, symbol: string, nodePath: string, patterns: readonly string[]): string[] {
  const name = shortName(symbol)
  const named = asWord(name)
  const module = asWord(basename(nodePath, extname(nodePath)))
  const matchers = patterns.map((pattern): ((line: string) => boolean) => {
    if (/\bsym\b/.test(pattern)) {
      const exact = new RegExp(pattern.split(/\bsym\b/).map(escape).join(`${escape(name)}(?![\\w$?!])`))
      return (line) => exact.test(line)
    }
    return (line) => line.includes(pattern) && (named.test(line) || module.test(line))
  })
  return text.split('\n').flatMap((line, index) => (matchers.some((matches) => matches(line)) ? [`${path}:${index + 1}: ${line.trim().slice(0, 160)}`] : []))
}

// ───────────────────────── Running tests ─────────────────────────

type Started = Extract<ProgramRun, { started: true }>
/** How a test file did in a run. `not-run`: the runner found no test to run in it. */
type Outcome = 'passed' | 'failed' | 'timed-out' | 'not-run'
type Ran = { outcomes: Map<string, Outcome> } | { stopped: string }

interface Runner {
  cwd: string
  book: Runbook
  env: NodeJS.ProcessEnv
  timeoutMs: number
  signal?: AbortSignal
  record: (run: TestRun) => void
}

const TAIL_LINES = 40
const TAIL_CHARS = 4_000

/** A command as it would be typed, each word quoted only when it needs to be. */
function commandLine(words: readonly string[]): string {
  return words.map((word) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`)).join(' ')
}

function tailOf(run: Started, timeoutMs: number): string {
  const lines = run.tail.trimEnd().split('\n').slice(-TAIL_LINES).join('\n').slice(-TAIL_CHARS)
  if (run.timedOut) return `${lines}\n(stopped after ${timeoutMs / 1000} seconds, the time limit)`
  if (run.aborted) return `${lines}\n(stopped: the proof was stopped)`
  return lines
}

/**
 * What vitest and jest say when the files they were given hold no test their configuration runs. They then exit
 * non-zero, which is not a test failing: the file did not run.
 */
const NO_TESTS = [/^\s*No test files found\b/m, /^\s*No tests found\b/m]

const outcomeOf = (run: Started): Outcome => (run.timedOut ? 'timed-out' : NO_TESTS.some((said) => said.test(run.tail)) ? 'not-run' : run.code === 0 ? 'passed' : 'failed')

/** The files a run records as failed: none when it passed, was stopped, or ran no test. */
const failedIn = (run: Started, files: readonly string[]): string[] => (run.code === 0 || run.aborted || outcomeOf(run) === 'not-run' ? [] : [...files])

/** The tests run as the repository runs them, quietly, and not as children of whatever runner started this proof. */
function testEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: '1', NO_COLOR: '1', DISABLE_SPRING: '1', BROWSER: 'none', ...extra }
  delete env.NODE_TEST_CONTEXT
  // FORCE_COLOR wins over NO_COLOR.
  delete env.FORCE_COLOR
  return env
}

async function start(runner: Runner, files: readonly string[]): Promise<Started | { stopped: string }> {
  const [program, ...args] = runner.book.command
  const run = await runProgram(program!, [...args, ...files], { cwd: runner.cwd, env: runner.env, timeoutMs: runner.timeoutMs, group: true, signal: runner.signal, overflow: 'tail', maxBytes: 1024 * 1024 })
  return run.started ? run : { stopped: `${program} could not start: ${run.reason}` }
}

function testRunOf(runner: Runner, files: readonly string[], kind: TestRun['kind'], node: string | undefined, run: Started, failed: string[]): TestRun {
  return {
    command: commandLine([...runner.book.command, ...files]),
    tests: [...files],
    kind,
    ...(node ? { node } : {}),
    condition_state: 'default',
    exit_code: run.code,
    seconds: run.seconds,
    failed,
    ...(run.code !== 0 ? { output_tail: tailOf(run, runner.timeoutMs) } : {}),
  }
}

/**
 * Runs test files: in one command when there are several, and when that fails, each file alone to learn which ones
 * fail. The batch is recorded first, naming the files that failed alone.
 */
async function runFiles(runner: Runner, files: readonly string[], kind: TestRun['kind'], node?: string): Promise<Ran> {
  if (files.length === 0) return { outcomes: new Map() }
  const first = await start(runner, files)
  if ('stopped' in first) return first
  if (files.length === 1 || first.code === 0 || first.aborted) {
    runner.record(testRunOf(runner, files, kind, node, first, failedIn(first, files)))
    if (first.aborted) return { stopped: 'the proof was stopped.' }
    return { outcomes: new Map(files.map((file) => [file, outcomeOf(first)])) }
  }
  const alone: [string, Started][] = []
  let stopped: string | null = null
  for (const file of files) {
    const run = await start(runner, [file])
    if ('stopped' in run) {
      stopped = run.stopped
      break
    }
    alone.push([file, run])
    if (run.aborted) {
      stopped = 'the proof was stopped.'
      break
    }
  }
  runner.record(testRunOf(runner, files, kind, node, first, alone.flatMap(([file, run]) => failedIn(run, [file]))))
  for (const [file, run] of alone) runner.record(testRunOf(runner, [file], kind, node, run, failedIn(run, [file])))
  return stopped ? { stopped } : { outcomes: new Map(alone.map(([file, run]) => [file, outcomeOf(run)])) }
}

// ───────────────────────── The proof ─────────────────────────

/** What the proof needs of a node; a `ReviewNode` is one. */
export type ProofNode = Pick<ReviewNode, 'id' | 'symbol' | 'kind' | 'path' | 'lines' | 'change'>

export interface ProofRequest {
  /** The checkout's top folder, at `head`, clean. */
  cwd: string
  head: string
  nodes: readonly ProofNode[]
  /** Candidate tests per node id, from `candidateTests`. */
  candidates: Readonly<Record<string, readonly TestCandidate[]>>
  runbook: Runbook | null
  /** The change's diffs, base to head, as `gitRepo().diffs` reads them. */
  diffs: readonly FileDiff[]
  /** Double patterns, `sym` standing for the definition's name. */
  doublePatterns: readonly string[]
  /** Most time one run may take; the runbook's when not given. */
  timeoutMs?: number
  signal?: AbortSignal
  /** Hears each run as it is recorded. */
  onRun?: (run: TestRun) => void
  parses?: ParseCheck
}

export interface ProofResult {
  nodes: Record<string, NodeProof>
  /** Every run that happened, in order. */
  runs: TestRun[]
  /** Tests that fail or hang at head, before anything is changed. */
  findings: Finding[]
  /** Why no test ran at all. */
  refused?: string
  /** No tracked or untracked file is left changed in the checkout. */
  clean: boolean
}

const unknown = (evidence: string): NodeProof => ({ value: 'unknown', evidence, observedBy: [], doubles: [], stillPass: [] })
const settled = (value: Proof, evidence: string): NodeProof => ({ value, evidence, observedBy: [], doubles: [], stillPass: [] })
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Why the checkout is not the change exactly as committed, or, when it is, the full id of its head. */
async function refusalOf(repo: GitRepo, cwd: string, head: string): Promise<{ refused: string } | { head: string }> {
  try {
    const top = await repo.top()
    if (realpathSync(cwd) !== realpathSync(top)) return { refused: `the proof runs from the repository's top folder (${top}), not from ${cwd}.` }
    const [at, wanted] = await Promise.all([repo.head(), repo.resolve(head)])
    if (!wanted || at !== wanted) return { refused: `the checkout is at ${at}, not at the head of the change (${head}).` }
    if (!(await repo.clean())) return { refused: 'the checkout has uncommitted changes, so its tests would not run the change as committed.' }
    return { head: wanted }
  } catch (error) {
    return { refused: `${cwd} is not a git checkout that can be read: ${message(error)}` }
  }
}

type Plan = { answer: NodeProof } | { tests: TestCandidate[] }

/** What a node needs before any test runs: an answer already, or the tests to run for it. */
function planOf(node: ProofNode, candidates: readonly TestCandidate[], book: Runbook): Plan {
  if (node.change === 'removed') return { answer: settled('not-applicable', 'removed: there is nothing left to run.') }
  if (node.change === 'none') return { answer: settled('not-applicable', 'unchanged: there is nothing to prove.') }
  if (node.kind === 'test') return { answer: settled('not-applicable', 'a test itself, not code a test runs.') }
  const tests = candidates.filter((candidate) => candidate.path !== node.path)
  if (tests.length === 0) return { answer: settled('none', `no test file names ${node.symbol} or is named after ${node.path}.`) }
  const runnable = tests.filter((candidate) => accepts(book, candidate.path))
  if (runnable.length === 0) return { answer: unknown(`${book.source} does not run ${listed(tests.map((test) => test.path))}.`) }
  return { tests: runnable }
}

/** Puts the original bytes back, trying twice before giving up loudly. */
function restore(file: string, original: Buffer) {
  try {
    writeFileSync(file, original)
  } catch {
    try {
      writeFileSync(file, original)
    } catch (error) {
      throw new Error(`could not put ${file} back as it was (${message(error)}); restore it with git before anything else runs.`)
    }
  }
}

/**
 * Proves each node by running its candidate tests, at head and then with the node changed. A modified definition
 * gets its own changes put back to base; an added one is made to throw; a removed one is not applicable. A test file
 * that fails with the node changed is run once more alone at head, recorded as a `baseline` run of that node, and
 * observes the node only if it passes there. The file comes back byte for byte after every run, also on a timeout or
 * abort, and the checkout is checked to be the change again before the next node. Nothing is recorded for a run that
 * did not happen.
 */
export async function runProof(request: ProofRequest): Promise<ProofResult> {
  const { cwd, nodes, candidates, runbook: book, diffs, doublePatterns, signal, onRun, parses = checkParses } = request
  const repo = gitRepo(cwd)
  const runs: TestRun[] = []
  const findings: Finding[] = []
  const answers: Record<string, NodeProof> = {}
  const cleanNow = () => repo.clean().catch(() => false)
  const refuse = async (refused: string): Promise<ProofResult> => {
    for (const node of nodes) answers[node.id] = unknown(`tests were not run: ${refused}`)
    return { nodes: answers, runs, findings, refused, clean: await cleanNow() }
  }

  if (!book) return refuse("no way to run this repository's tests was found.")
  const checked = await refusalOf(repo, cwd, request.head)
  if ('refused' in checked) return refuse(checked.refused)
  const timeoutMs = request.timeoutMs ?? book.timeoutMs
  const record = (run: TestRun) => {
    runs.push(run)
    onRun?.(run)
  }
  const runner: Runner = { cwd, book, env: testEnv(book.env), timeoutMs, signal, record }

  const plans = nodes.map((node) => planOf(node, candidates[node.id] ?? [], book))
  const baselineFiles = [...new Set(plans.flatMap((plan) => ('tests' in plan ? plan.tests.map((test) => test.path) : [])))]
  const baseline = await runFiles(runner, baselineFiles, 'baseline')
  let stopped: string | null = 'stopped' in baseline ? baseline.stopped : null
  const atHead = 'outcomes' in baseline ? baseline.outcomes : new Map<string, Outcome>()
  for (const [file, outcome] of atHead) {
    if (outcome === 'failed') findings.push({ rule: 'failing-test', text: `${file} fails at head, before anything is changed.`, by: 'proof' })
    if (outcome === 'timed-out') findings.push({ rule: 'test-timeout', text: `${file} did not finish within ${timeoutMs / 1000} seconds at head.`, by: 'proof' })
  }
  if (!stopped && baselineFiles.length && !(await repo.clean({ untracked: false }))) stopped = 'the tests at head changed tracked files, so later runs would not test the change.'

  for (const [index, node] of nodes.entries()) {
    const plan = plans[index]!
    if ('answer' in plan) {
      answers[node.id] = plan.answer
      continue
    }
    if (!stopped && signal?.aborted) stopped = 'the proof was stopped.'
    if (stopped) {
      answers[node.id] = unknown(`tests were not run: ${stopped}`)
      continue
    }
    const passing = plan.tests.filter((test) => atHead.get(test.path) === 'passed')
    if (passing.length === 0) {
      const notRun = plan.tests.filter((test) => atHead.get(test.path) === 'not-run').map((test) => test.path)
      const failing = plan.tests.map((test) => test.path).filter((path) => !notRun.includes(path))
      const said = [failing.length ? `its tests fail or hang at head, before anything is changed: ${listed(failing)}` : '', notRun.length ? `the test runner found no test to run in ${listed(notRun)}` : '']
      answers[node.id] = unknown(`${said.filter(Boolean).join('; ')}.`)
      continue
    }
    const proved = await proveNode({ runner, repo, head: checked.head, node, passing, diffs, doublePatterns, parses })
    if ('stopped' in proved) {
      stopped = proved.stopped
      answers[node.id] = unknown(`tests were cut short: ${proved.stopped}`)
    } else answers[node.id] = proved.answer
  }
  return { nodes: answers, runs, findings, clean: await cleanNow() }
}

/** One node: change its file, run its passing tests, put the file back, and read what failed. */
async function proveNode({
  runner,
  repo,
  head,
  node,
  passing,
  diffs,
  doublePatterns,
  parses,
}: {
  runner: Runner
  repo: GitRepo
  head: string
  node: ProofNode
  passing: TestCandidate[]
  diffs: readonly FileDiff[]
  doublePatterns: readonly string[]
  parses: ParseCheck
}): Promise<{ answer: NodeProof } | { stopped: string }> {
  const mutation = node.change === 'added' ? 'probe' : 'revert'
  const cannot = (why: string) => ({ answer: unknown(`could not ${mutation === 'probe' ? 'make it throw' : 'put it back to base'}: ${why}`) })
  const file = resolve(runner.cwd, node.path)
  try {
    // Written only where it is: a plain file, inside the checkout even once every link on the way is followed.
    if (!lstatSync(file).isFile() || !realpathSync(file).startsWith(realpathSync(runner.cwd) + sep)) return cannot(`${node.path} is not a plain file inside the checkout.`)
  } catch {
    return cannot(`${node.path} is not in the checkout.`)
  }
  const original = readFileSync(file)
  const text = original.toString('utf8')
  // Decoding anything else would change more bytes than the mutation does.
  if (!Buffer.from(text, 'utf8').equals(original)) return cannot(`${node.path} is not plain UTF-8 text, so it is not rewritten.`)
  const changed = mutation === 'probe' ? probeNode(text, node) : revertNode(text, node.lines, diffs.find((diff) => diff.path === node.path))
  if ('why' in changed) return cannot(changed.why)
  const unsafe = await parses(node.path, text, changed.text)
  if (unsafe) return cannot(unsafe)

  let ran: Ran
  try {
    writeFileSync(file, changed.text)
    ran = await runFiles(runner, passing.map((test) => test.path), mutation, node.id)
  } finally {
    restore(file, original)
  }
  const back = readFileSync(file).equals(original) && (await repo.clean({ untracked: false })) && (await repo.head()) === head
  if (!back) return { stopped: `${node.path} or the checkout did not come back exactly as it was.` }
  if ('stopped' in ran) return ran

  // A file that failed with the change made observes it only if it passes again run alone at head: one that fails
  // there too is flaky, fails only beside other files, or never ran, and says nothing about the change.
  const again = new Map<string, Outcome>()
  for (const candidate of passing.filter((test) => ran.outcomes.get(test.path) === 'failed')) {
    const confirmed = await runFiles(runner, [candidate.path], 'baseline', node.id)
    if ('stopped' in confirmed) return confirmed
    again.set(candidate.path, confirmed.outcomes.get(candidate.path) ?? 'timed-out')
  }
  if (again.size && !(await repo.clean({ untracked: false }))) return { stopped: 'the tests at head changed tracked files, so later runs would not test the change.' }

  const observations = passing.map((candidate): Observation => {
    // Every file has an outcome; were one missing, it would prove nothing rather than count as a failure.
    const during = ran.outcomes.get(candidate.path) ?? 'timed-out'
    const outcome = during === 'failed' && again.get(candidate.path) !== 'passed' ? 'unsettled' : during
    const doubles = outcome === 'failed' ? doublesIn(readOr(join(runner.cwd, candidate.path)), candidate.path, node.symbol, node.path, doublePatterns) : []
    return { candidate, outcome, doubles }
  })
  return { answer: proofOf({ symbol: node.symbol, mutation, observations, timeoutMs: runner.timeoutMs }) }
}
