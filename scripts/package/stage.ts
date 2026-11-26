/**
 * Stages what the host needs to run inside the Mac app into dist/package/, from scratch each time:
 *
 *   node scripts/package/stage.ts [--time <ISO time>] [--client <dir> --client-commit <sha>] [--runtime <dir> --runtime-commit <sha>]
 *
 *   app/             the host's files, found by following its imports from host/src/main.ts, a package.json for
 *                    them, and node_modules: the host's own packages, and hobkin with its own node_modules (Pi)
 *   node/bin/node    the official Node binary the hobkin checkout already downloaded
 *   manifest.json    what went in, from which commits, and how big each part is
 *
 * By default the client's files come from this repository's working tree and hobkin's from the checkout
 * `node_modules/hobkin` links to. `--client` and `--runtime` name folders made with `git archive`, so a release is
 * staged from committed states while others edit the working trees. What is not a tracked source file still comes
 * from the real checkouts: see `realSources` in the report this prints.
 *
 * The Tauri build copies dist/package into the app as resources. `check.ts` proves that a copy of it runs alone.
 * Packages come from the pnpm store with --offline, so staging never reaches the network.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path'
import {
  appPackage,
  classifyTarget,
  integrationEntries,
  mapImport,
  nodeBinaryProblems,
  packageManifest,
  packageNameOf,
  referencesIn,
  stageArguments,
  undeclaredPackages,
  type RootPackage,
  type StagedCommit,
  type StagedFrom,
} from './rules.ts'
import { bytesUnder, entriesUnder, isInside, linksUnder, megabytes } from './tree.ts'

const REPO = resolve(import.meta.dirname, '..', '..')
const OUT = join(REPO, 'dist', 'package')
const APP = join(OUT, 'app')
const MODULES = join(APP, 'node_modules')
const RUNTIME_OUT = join(MODULES, 'hobkin')
const NODE_OUT = join(OUT, 'node', 'bin', 'node')
/** The host's entry. Every other file it loads is found from here. */
const ENTRY = 'host/src/main.ts'
/** What hobkin's code needs from its checkout: its code, and the package.json it reads its version and pins from. */
const RUNTIME_PARTS = ['src', 'package.json']
/** What pnpm needs to install hobkin's packages. hobkin's repository ignores its lockfile, so an archive of it has none. */
const RUNTIME_INSTALL_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml']
/** What pnpm leaves in node_modules for itself. Nothing reads it at run time, and `.bin` holds links. */
const PNPM_BOOKKEEPING = ['.bin', '.pnpm', '.modules.yaml', '.package-map.json', '.pnpm-workspace-state-v1.json']

const readJson = <Value>(path: string): Value => JSON.parse(readFileSync(path, 'utf8')) as Value
const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false

function run(command: string, args: readonly string[], options: SpawnSyncOptions = {}): { stdout: string; stderr: string } {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  const stdout = String(result.stdout ?? '')
  const stderr = String(result.stderr ?? '')
  if (result.status !== 0) throw Error(`${command} ${args.join(' ')} failed with ${result.status}:\n${(stderr || stdout).trim()}`)
  return { stdout, stderr }
}

/** A path a source names, from the client's root. The root itself is ''. */
function fromFile(file: string, specifier: string): string {
  const joined = posix.normalize(posix.join(posix.dirname(file), specifier))
  return joined === '.' || joined === './' ? '' : joined
}

/** The package.json Node reads for a file's module type and `#` imports: the nearest one above it in the client. */
function nearestManifest(client: string, file: string): string {
  for (let folder = posix.dirname(file); folder !== '.'; folder = posix.dirname(folder)) {
    if (isFile(join(client, folder, 'package.json'))) return `${folder}/package.json`
  }
  return 'package.json'
}

interface HostFiles {
  /** Paths, from the client's root, of the modules the host loads and the files they read. */
  files: string[]
  /** The packages the host imports by name, other than hobkin. */
  packages: string[]
}

/**
 * Follows the host's imports from its entry, and every file its modules name next to themselves, so only what it
 * loads or reads is staged. Anything it cannot account for stops the stage.
 */
function hostFiles(client: string, runtime: string): HostFiles {
  const files = new Set<string>()
  const packages = new Set<string>()
  const problems: string[] = []
  const queue: string[] = []
  const load = (path: string, from: string) => {
    if (path.startsWith('../') || path.split('/').includes('node_modules')) problems.push(`${from} imports ${path}, outside the host's own files`)
    else if (!files.has(path)) {
      files.add(path)
      queue.push(path)
    }
  }
  const bare = (specifier: string, from: string) => {
    const name = packageNameOf(specifier)
    if (name !== 'hobkin') return void packages.add(name)
    const inner = specifier.slice('hobkin/'.length)
    if (!RUNTIME_PARTS.includes(inner.split('/')[0]!)) problems.push(`${from} uses ${specifier}, outside the parts of hobkin that are staged (${RUNTIME_PARTS.join(', ')})`)
    else if (!existsSync(join(runtime, inner))) problems.push(`${from} uses ${specifier}, which hobkin's files do not have`)
  }

  load(ENTRY, 'the entry')
  // The host finds each integration's manifest and host part by listing the folder, so no import leads to them.
  const integrations = join(client, 'integrations')
  const listed = existsSync(integrations) ? readdirSync(integrations, { recursive: true }).map((path) => String(path).split(sep).join('/')) : []
  for (const path of integrationEntries(listed)) load(path, 'the integrations folder')
  while (queue.length) {
    const file = queue.shift()!
    if (!isFile(join(client, file))) {
      problems.push(`${file} is loaded or read by the host, but it is not a file in the client`)
      continue
    }
    const manifest = nearestManifest(client, file)
    // The root package.json is written by the stage. A nested one is staged as it is, since Node reads it for this file.
    if (manifest !== 'package.json') files.add(manifest)
    if (!/\.(ts|mts|mjs|js)$/.test(file)) continue

    const references = referencesIn(readFileSync(join(client, file), 'utf8'))
    for (const specifier of references.modules) {
      if (isBuiltin(specifier)) continue
      if (specifier.startsWith('.')) load(fromFile(file, specifier), file)
      else if (specifier.startsWith('#')) {
        const mapped = mapImport(specifier, readJson<RootPackage>(join(client, manifest)).imports)
        if (mapped) load(fromFile(manifest, mapped), file)
        else problems.push(`${file} imports ${specifier}, which ${manifest} does not map`)
      } else bare(specifier, file)
    }
    for (const url of references.urls) {
      const target = classifyTarget(fromFile(file, url))
      if (target.kind === 'code' || target.kind === 'data') load(target.path, file)
      else if (target.kind === 'folder') target.files.forEach((path) => load(path, file))
      else if (target.kind === 'problem') problems.push(`${file} reads ${url}, but ${target.why}`)
    }
    for (const specifier of references.resolved) bare(specifier, file)
    for (const call of references.computed) problems.push(`${file} computes a path the stage cannot follow: ${call}`)
  }
  if (problems.length) throw Error(`The host's files could not all be accounted for:\n- ${problems.join('\n- ')}`)
  return { files: [...files].sort(), packages: [...packages].sort() }
}

/** Moves a folder into place, copying when the temporary folder is on another volume. */
function moveFolder(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  try {
    renameSync(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    cpSync(from, to, { recursive: true, verbatimSymlinks: true })
  }
}

/**
 * Installs a node_modules tree in a temporary folder outside the repository, so pnpm never sees the repository's own
 * workspace, then moves it into place. The hoisted linker makes a plain tree of folders, not links into the store.
 */
function installTree(target: string, files: Readonly<Record<string, string>>, lockfile: '--frozen-lockfile' | '--no-frozen-lockfile', what: string): void {
  const temporary = mkdtempSync(join(tmpdir(), 'hobkin-stage-'))
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(temporary, name), text)
    try {
      run('pnpm', ['install', '--prod', lockfile, '--offline', '--ignore-scripts', '--config.node-linker=hoisted'], { cwd: temporary })
    } catch (error) {
      throw Error(`pnpm could not install ${what} from the store offline. Nothing was fetched from the network.\n${(error as Error).message}`)
    }
    moveFolder(join(temporary, 'node_modules'), target)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

/** Removes what pnpm keeps for itself: the bookkeeping at the top, and every `.bin` folder of links below. */
function dropBookkeeping(modules: string): void {
  for (const name of PNPM_BOOKKEEPING) rmSync(join(modules, name), { recursive: true, force: true })
  const bins = [...entriesUnder(modules)].filter(({ path, stat }) => stat.isDirectory() && basename(path) === '.bin').map(({ path }) => path)
  for (const bin of bins) rmSync(bin, { recursive: true, force: true })
}

const versionIn = (folder: string): string => readJson<{ version: string }>(join(folder, 'package.json')).version

/**
 * The host's own packages, as the client's lockfile resolves them, as a plain tree. Staged from this working tree,
 * they must be the versions installed in the repository now. Staged from an archive, its lockfile rules, and a
 * difference from what this repository has installed is only reported.
 */
function stageHostPackages(client: string, root: RootPackage, packages: readonly string[]): Record<string, string> {
  const undeclared = undeclaredPackages(packages, root)
  if (undeclared.length) throw Error(`The host imports ${undeclared.join(', ')}, which package.json does not list, so nothing pins a version.`)
  // The client's own specifiers and lockfile, so pnpm keeps the versions it resolved for the client.
  const manifest = { name: root.name, version: root.version, private: true, type: root.type, dependencies: Object.fromEntries(packages.map((name) => [name, root.dependencies![name]])) }
  installTree(MODULES, { 'package.json': JSON.stringify(manifest, null, 2), 'pnpm-lock.yaml': readFileSync(join(client, 'pnpm-lock.yaml'), 'utf8') }, '--no-frozen-lockfile', "the host's packages")
  const staged = Object.fromEntries(packages.map((name) => [name, versionIn(join(MODULES, name))]))
  for (const [name, version] of Object.entries(staged)) {
    const installed = join(REPO, 'node_modules', name)
    const here = isFile(join(installed, 'package.json')) ? versionIn(realpathSync(installed)) : null
    if (here === version) continue
    const words = `${name} was staged at ${version}, but this repository has ${here ?? 'nothing'} installed.`
    if (client === REPO) throw Error(words)
    console.warn(`warning: ${words}`)
  }
  return staged
}

/** Where each file pnpm needs for hobkin's packages comes from: the given folder when it has it, the real checkout otherwise. */
function runtimeInstallSources(runtime: string, realRuntime: string): Record<string, string> {
  const sources: Record<string, string> = { 'package.json': join(runtime, 'package.json') }
  for (const name of RUNTIME_INSTALL_FILES) {
    const own = join(runtime, name)
    const real = join(realRuntime, name)
    if (isFile(own)) sources[name] = own
    else if (isFile(real)) sources[name] = real
  }
  if (!sources['pnpm-lock.yaml']) throw Error(`Neither ${runtime} nor ${realRuntime} has a pnpm-lock.yaml, so hobkin's packages cannot be installed as resolved.`)
  return sources
}

/** hobkin's files, and its packages at the versions its lockfile resolves, Pi among them. */
function stageRuntime(runtime: string, installSources: Readonly<Record<string, string>>, realRuntime: string): { version: string; packages: Record<string, string> } {
  for (const part of RUNTIME_PARTS) {
    cpSync(join(runtime, part), join(RUNTIME_OUT, part), { recursive: true, filter: (source) => basename(source) !== '.DS_Store' })
  }
  const files = Object.fromEntries(Object.entries(installSources).map(([name, path]) => [name, readFileSync(path, 'utf8')]))
  installTree(join(RUNTIME_OUT, 'node_modules'), files, '--frozen-lockfile', "hobkin's packages")

  const manifest = readJson<{ version: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }>(join(runtime, 'package.json'))
  const wanted = { ...manifest.dependencies, ...manifest.peerDependencies }
  const packages: Record<string, string> = {}
  for (const [name, range] of Object.entries(wanted)) {
    const folder = join(RUNTIME_OUT, 'node_modules', name)
    if (!isFile(join(folder, 'package.json'))) throw Error(`hobkin needs ${name}, but its staged node_modules does not have it.`)
    packages[name] = versionIn(folder)
    if (/^\d+\.\d+\.\d+$/.test(range) && packages[name] !== range) throw Error(`hobkin pins ${name} at ${range}, but ${packages[name]} was staged.`)
    // The checkout's own node_modules can drift from its lockfile. The stage follows the lockfile and says when they differ.
    const live = join(realRuntime, 'node_modules', name)
    if (isFile(join(live, 'package.json')) && versionIn(live) !== packages[name]) {
      console.warn(`warning: hobkin's checkout has ${name} ${versionIn(live)} installed, but the lockfile resolves ${packages[name]}, which was staged.`)
    }
  }
  return { version: manifest.version, packages }
}

/** Every native module under the staged packages has a darwin-arm64 build, the only Mac the package is for. */
function checkNativeModules(): string[] {
  const natives = [...entriesUnder(MODULES)].filter(({ path, stat }) => stat.isFile() && path.endsWith('.node')).map(({ path }) => relative(MODULES, path))
  const owners = new Set(natives.map((path) => path.split('/native/')[0]!.split('/prebuilds/')[0]!))
  const arm = natives.filter((path) => path.includes('darwin-arm64'))
  for (const owner of owners) {
    if (!arm.some((path) => path.startsWith(`${owner}/`))) throw Error(`${owner} has native modules, but none built for darwin-arm64.`)
  }
  for (const path of arm) {
    const { stdout } = run('file', ['-b', join(MODULES, path)])
    if (!/arm64/.test(stdout)) throw Error(`${path} is not an arm64 library: ${stdout.trim()}`)
  }
  return arm
}

/** The Node binary the real hobkin checkout downloaded, copied alone, once it proves to be a standalone official build. */
function stageNode(source: string): string {
  const signature = spawnSync('codesign', ['-dv', '--verbose=2', source], { encoding: 'utf8' })
  const problems = nodeBinaryProblems({
    file: run('file', [source]).stdout,
    libraries: run('otool', ['-L', source]).stdout,
    // codesign describes a signature on stderr.
    signature: `${signature.stdout}${signature.stderr}`,
  })
  if (problems.length) throw Error(`The Node binary in hobkin's checkout cannot be carried in the app:\n- ${problems.join('\n- ')}`)
  mkdirSync(dirname(NODE_OUT), { recursive: true })
  copyFileSync(source, NODE_OUT)
  chmodSync(NODE_OUT, 0o755)
  run('codesign', ['--verify', '--strict', NODE_OUT])
  return run(NODE_OUT, ['--version']).stdout.trim().replace(/^v/, '')
}

/** The commit a part was staged from: the one the caller named for an archive, or the checkout's own and how far it has moved. */
function stagedCommit(checkout: string, given: StagedFrom | null): StagedCommit {
  if (given) return { commit: given.commit, source: 'archive', uncommittedFiles: null }
  // Without optional locks, git status never rewrites the checkout's index while another session works in it.
  const git = (args: string[]) => run('git', ['-C', checkout, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).stdout
  return {
    commit: git(['rev-parse', 'HEAD']).trim(),
    source: 'checkout',
    uncommittedFiles: git(['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).length,
  }
}

/** A folder to stage from, which must hold what the stage copies and must not be inside what the stage deletes. */
function sourceFolder(given: StagedFrom | null, fallback: string, needs: readonly string[], flag: string): string {
  const folder = given ? realpathSync(resolve(given.dir)) : fallback
  if (isInside(OUT, folder)) throw Error(`${flag} ${folder} is inside ${relative(REPO, OUT)}, which the stage deletes first.`)
  const missing = needs.filter((part) => !existsSync(join(folder, part)))
  if (missing.length) throw Error(`${given ? `${flag} ${folder}` : folder} has no ${missing.join(', ')}.`)
  return folder
}

const shortCommit = ({ commit, source, uncommittedFiles }: StagedCommit) =>
  source === 'archive' ? `${commit} (archive)` : `${commit.slice(0, 7)} (checkout, ${uncommittedFiles} uncommitted files)`

function stage(args: readonly string[]): void {
  const options = stageArguments(args)
  const createdAt = options.time ?? new Date().toISOString()
  const realRuntime = realpathSync(join(REPO, 'node_modules', 'hobkin'))
  const client = sourceFolder(options.client, REPO, ['package.json', 'pnpm-lock.yaml', ENTRY], '--client')
  const runtime = sourceFolder(options.runtime, realRuntime, RUNTIME_PARTS, '--runtime')
  const installSources = runtimeInstallSources(runtime, realRuntime)
  const nodeSource = realpathSync(join(realRuntime, 'node_modules', 'node', 'bin', 'node'))
  const appCommit = stagedCommit(REPO, options.client)
  const runtimeCommit = stagedCommit(realRuntime, options.runtime)

  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(APP, { recursive: true })

  const root = readJson<RootPackage>(join(client, 'package.json'))
  const { files, packages } = hostFiles(client, runtime)
  for (const file of files) {
    mkdirSync(dirname(join(APP, file)), { recursive: true })
    copyFileSync(join(client, file), join(APP, file))
  }
  const hostVersions = stageHostPackages(client, root, packages)
  const hobkin = stageRuntime(runtime, installSources, realRuntime)
  writeFileSync(join(APP, 'package.json'), `${JSON.stringify(appPackage(root, { ...hostVersions, hobkin: hobkin.version }), null, 2)}\n`)

  dropBookkeeping(MODULES)
  dropBookkeeping(join(RUNTIME_OUT, 'node_modules'))
  const links = linksUnder(OUT)
  if (links.length) throw Error(`The staged tree still holds links:\n- ${links.join('\n- ')}`)
  const natives = checkNativeModules()

  const nodeVersion = stageNode(nodeSource)
  const sizes = { app: bytesUnder(APP), node: bytesUnder(join(OUT, 'node')) }
  const manifest = packageManifest({
    createdAt,
    app: { name: root.name, version: root.version, ...appCommit },
    runtime: { name: 'hobkin', version: hobkin.version, ...runtimeCommit },
    node: { version: nodeVersion },
    sizes,
  })
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const modules = bytesUnder(MODULES)
  const runtimeAll = bytesUnder(RUNTIME_OUT)
  const runtimeModules = bytesUnder(join(RUNTIME_OUT, 'node_modules'))
  const parts: [string, number, string][] = [
    [`host files (${files.length})`, sizes.app - modules, ''],
    ['host packages', modules - runtimeAll, Object.entries(hostVersions).map(([name, version]) => `${name}@${version}`).join(' ')],
    ['hobkin code', runtimeAll - runtimeModules, ''],
    ['hobkin packages', runtimeModules, Object.entries(hobkin.packages).map(([name, version]) => `${name}@${version}`).join(' ')],
    ['node', sizes.node, ''],
    ['total', sizes.app + sizes.node, ''],
  ]
  console.log(`Staged ${relative(REPO, OUT)} for ${root.name} ${root.version} at ${shortCommit(manifest.app)}, hobkin ${hobkin.version} at ${shortCommit(manifest.runtime)}, Node ${nodeVersion}.`)
  for (const [name, bytes, detail] of parts) console.log(`  ${name.padEnd(24)} ${megabytes(bytes).padStart(9)}  ${detail}`.trimEnd())
  console.log(`  darwin-arm64 native modules: ${natives.join(', ') || 'none'}`)
  console.log(`  client files from ${client}`)
  console.log(`  hobkin files from ${runtime}`)
  console.log(`  hobkin install files: ${Object.entries(installSources).map(([name, path]) => `${name} from ${dirname(path)}`).join(', ')}`)
  console.log(`  node from ${nodeSource}`)
}

if (import.meta.main) {
  try {
    stage(process.argv.slice(2))
  } catch (error) {
    // Neither a half-staged tree nor an older one may reach the app build after a stage that failed.
    rmSync(OUT, { recursive: true, force: true })
    console.error(`stage: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
