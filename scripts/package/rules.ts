/**
 * The rules that decide what goes into the packaged host, kept apart from the file system so a test can pin them.
 * `stage.ts` and `check.ts` do the reading, copying and running.
 */

/** What one source file asks for at run time. */
export interface References {
  /** Modules it imports, statically or with a literal `import()`. */
  modules: string[]
  /** Files it names next to itself with `new URL('…', import.meta.url)`. */
  urls: string[]
  /** What it resolves by package name with `import.meta.resolve('…')`. */
  resolved: string[]
  /** `new URL(…, import.meta.url)` or `import.meta.resolve(…)` calls whose path is computed, so no rule can know the file. */
  computed: string[]
}

// An import clause holds only names, braces, commas, `*` and `as`, so the clause before `from` is limited to those
// characters. That keeps a match from running across ordinary code into a later string.
const STATIC = /^[ \t]*(?:import|export)\s+(?!type\s)(?:[\w\s{},*$]*?\bfrom\s*)?(['"])([^'"\n]+)\1/gm
// `typeof import('x')` is a type, which Node's type stripping erases, so it loads nothing.
const DYNAMIC = /(?<!typeof\s*)\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g
const URL_CALL = /new URL\(\s*([^()]*?)\s*,\s*import\.meta\.url\s*\)/g
const RESOLVE_CALL = /import\.meta\.resolve\(\s*([^()]*?)\s*\)/g
const LITERAL = /^(['"])([^'"\n]+)\1$/

/** What a source file loads and reads, found by its text. Type-only imports are left out, since nothing loads them. */
export function referencesIn(source: string): References {
  const modules = [...source.matchAll(STATIC), ...source.matchAll(DYNAMIC)]
    .sort((left, right) => left.index - right.index)
    .map((match) => match[2]!)
  const urls: string[] = []
  const resolved: string[] = []
  const computed: string[] = []
  for (const [found, list] of [
    [source.matchAll(URL_CALL), urls],
    [source.matchAll(RESOLVE_CALL), resolved],
  ] as const) {
    for (const match of found) {
      const literal = LITERAL.exec(match[1]!)
      if (literal) list.push(literal[2]!)
      else computed.push(match[1]!)
    }
  }
  return { modules, urls, resolved, computed }
}

/** The package a bare specifier names: `@scope/name` or `name`, without the path inside it. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

/** Where a `#` specifier points by a package.json `imports` field, or null when no plain string entry matches. */
export function mapImport(specifier: string, imports: Readonly<Record<string, unknown>> | undefined): string | null {
  for (const [key, target] of Object.entries(imports ?? {})) {
    if (typeof target !== 'string') continue
    const star = key.indexOf('*')
    if (star === -1) {
      if (key === specifier) return target
      continue
    }
    const before = key.slice(0, star)
    const after = key.slice(star + 1)
    if (specifier.length >= before.length + after.length && specifier.startsWith(before) && specifier.endsWith(after)) {
      return target.replace('*', specifier.slice(before.length, specifier.length - after.length))
    }
  }
  return null
}

/**
 * Folders the host names with `new URL`, and the files in them it reads. A folder is never staged whole: the review
 * sample folder also holds the window's own sample code and a stress set the host never opens.
 */
export const FOLDER_READS: Readonly<Record<string, readonly string[]>> = {
  // host/src/review/sample-source.ts reads review.json and files.json from it.
  'ui/src/features/review/sample/': ['review.json', 'files.json'],
}

const CODE = /\.(ts|mts|mjs|js)$/

export type Target =
  | { kind: 'code' | 'data'; path: string }
  /** The root package.json, which the stage writes itself. */
  | { kind: 'generated'; path: 'package.json' }
  /** The app folder itself, as `home.ts` names it for its development home. */
  | { kind: 'self'; path: '' }
  | { kind: 'folder'; path: string; files: string[] }
  | { kind: 'problem'; path: string; why: string }

/** What to stage for a file a source names next to itself, given as a path from the repository root. */
export function classifyTarget(path: string): Target {
  if (path === '') return { kind: 'self', path }
  if (path === 'package.json') return { kind: 'generated', path }
  if (path === '..' || path.startsWith('../') || path.startsWith('/')) return { kind: 'problem', path, why: 'it is outside the repository' }
  if (path.split('/').includes('node_modules')) return { kind: 'problem', path, why: 'it is inside node_modules, which the stage installs on its own' }
  if (path.endsWith('/')) {
    const reads = FOLDER_READS[path]
    if (!reads) return { kind: 'problem', path, why: 'it is a folder with no entry in FOLDER_READS, so nobody has said which of its files the host reads' }
    return { kind: 'folder', path, files: reads.map((name) => `${path}${name}`) }
  }
  return { kind: CODE.test(path) ? 'code' : 'data', path }
}

export interface RootPackage {
  name: string
  version: string
  type?: string
  engines?: Record<string, string>
  imports?: Record<string, unknown>
  dependencies?: Record<string, string>
  [field: string]: unknown
}

export interface AppPackage {
  name: string
  version: string
  private: true
  type?: string
  engines?: Record<string, string>
  imports?: Record<string, unknown>
  dependencies: Record<string, string>
}

/** Packages the host imports that the repository's package.json does not list, so nothing pins their version. */
export function undeclaredPackages(packages: Iterable<string>, root: Pick<RootPackage, 'dependencies'>): string[] {
  return [...packages].filter((name) => !(name in (root.dependencies ?? {})))
}

/** The staged app's package.json: the fields Node reads at run time, and the host's own imports pinned to what is installed. */
export function appPackage(root: RootPackage, versions: Readonly<Record<string, string>>): AppPackage {
  const dependencies = Object.fromEntries(Object.entries(versions).sort(([left], [right]) => left.localeCompare(right)))
  return {
    name: root.name,
    version: root.version,
    private: true,
    ...(root.type ? { type: root.type } : {}),
    ...(root.engines ? { engines: root.engines } : {}),
    ...(root.imports ? { imports: root.imports } : {}),
    dependencies,
  }
}

/** A folder to stage a checkout's tracked files from, and the commit the caller says it holds. */
export interface StagedFrom {
  dir: string
  commit: string
}

export interface StageArguments {
  /** The manifest's time, or null for the time the stage runs. */
  time: string | null
  /** Where the client's files come from, or null for this repository's working tree. */
  client: StagedFrom | null
  /** Where hobkin's files come from, or null for the checkout `node_modules/hobkin` links to. */
  runtime: StagedFrom | null
}

export const STAGE_USAGE = 'Usage: node scripts/package/stage.ts [--time <ISO time>] [--client <dir> --client-commit <sha>] [--runtime <dir> --runtime-commit <sha>]'

/**
 * The stage's arguments. A folder and its commit come together: a folder made by `git archive` has no history to
 * read the commit from, and the working tree is not the commit somebody names.
 */
export function stageArguments(args: readonly string[]): StageArguments {
  const values = new Map<string, string>()
  const rest = [...args]
  while (rest.length) {
    const flag = rest.shift()!
    if (!['--time', '--client', '--client-commit', '--runtime', '--runtime-commit'].includes(flag)) throw Error(`Unknown option: ${flag}\n${STAGE_USAGE}`)
    const value = rest.shift()
    if (!value || value.startsWith('--')) throw Error(`${flag} needs a value.\n${STAGE_USAGE}`)
    values.set(flag, value)
  }
  const time = values.get('--time') ?? null
  if (time !== null && Number.isNaN(Date.parse(time))) throw Error(`--time needs an ISO time, such as 2026-11-13T22:00:00.000Z, not ${time}.`)
  const source = (name: 'client' | 'runtime'): StagedFrom | null => {
    const dir = values.get(`--${name}`)
    const commit = values.get(`--${name}-commit`)
    if (dir === undefined && commit === undefined) return null
    if (dir === undefined || commit === undefined) throw Error(`--${name} and --${name}-commit go together: the folder, and the commit it holds.\n${STAGE_USAGE}`)
    return { dir, commit }
  }
  return { time: time === null ? null : new Date(time).toISOString(), client: source('client'), runtime: source('runtime') }
}

/** Which commit a part was staged from. */
export interface StagedCommit {
  commit: string
  /** `checkout`: a working tree, at this commit plus its uncommitted files. `archive`: a folder the caller made of this commit. */
  source: 'checkout' | 'archive'
  /** Files that differ from the commit, counted in a checkout. Null for an archive, which has no history to count against. */
  uncommittedFiles: number | null
}

export interface PackageManifest {
  format: 1
  createdAt: string
  app: { name: string; version: string } & StagedCommit
  runtime: { name: string; version: string } & StagedCommit
  node: { version: string }
  /** Bytes in each top-level folder of the package. */
  sizes: Record<string, number>
}

const stagedCommit = ({ commit, source, uncommittedFiles }: StagedCommit): StagedCommit => ({ commit, source, uncommittedFiles })

/** The manifest written beside the staged parts. The time is the caller's, so the same input always makes the same manifest. */
export function packageManifest(input: Omit<PackageManifest, 'format'>): PackageManifest {
  if (Number.isNaN(Date.parse(input.createdAt))) throw Error(`createdAt must be an ISO time, not ${input.createdAt}.`)
  const sizes = Object.fromEntries(Object.entries(input.sizes).sort(([left], [right]) => left.localeCompare(right)))
  return {
    format: 1,
    createdAt: input.createdAt,
    app: { name: input.app.name, version: input.app.version, ...stagedCommit(input.app) },
    runtime: { name: input.runtime.name, version: input.runtime.version, ...stagedCommit(input.runtime) },
    node: { version: input.node.version },
    sizes,
  }
}

/** What `file`, `otool -L` and `codesign -dv --verbose=2` printed for a Node binary. */
export interface NodeBinaryFacts {
  file: string
  libraries: string
  signature: string
}

// The Node.js project's Apple Developer ID team, as its release binaries are signed.
const NODE_TEAM = 'HX7739G8FX'
const SYSTEM_LIBRARY = /^(\/usr\/lib\/|\/System\/)/

/** Why a Node binary cannot be carried in the app, or nothing when it is a standalone official arm64 build. */
export function nodeBinaryProblems({ file, libraries, signature }: NodeBinaryFacts): string[] {
  const problems: string[] = []
  if (!/Mach-O 64-bit executable arm64/.test(file)) problems.push(`it is not an arm64 executable: ${file.trim()}`)
  // The first line of `otool -L` is the binary's own path. Every other line is a library it loads.
  const outside = libraries
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' (')[0]!)
    .filter((library) => library && !SYSTEM_LIBRARY.test(library))
  if (outside.length) problems.push(`it loads libraries outside macOS: ${outside.join(', ')}`)
  const official = signature.includes('Authority=Developer ID Application: Node.js Foundation') && signature.includes(`TeamIdentifier=${NODE_TEAM}`)
  if (!official) problems.push("it is not signed with the Node.js project's Developer ID")
  return problems
}

// Names used in examples and fixtures, which say nothing about the machine that built the package.
const PLACEHOLDER_USERS = new Set(['someone', 'example', 'Shared', 'you', 'user', 'username', 'name'])
const USER_FOLDER = /\/Users\/([A-Za-z0-9._-]+)/g

/** The user folders a staged file names, other than placeholders: a sign that a path from the building Mac leaked in. */
export function leakedUserPaths(text: string): string[] {
  const found = new Set<string>()
  for (const [path, name] of text.matchAll(USER_FOLDER)) {
    if (!PLACEHOLDER_USERS.has(name!)) found.add(path)
  }
  return [...found]
}
