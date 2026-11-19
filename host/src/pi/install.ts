import { execFile } from 'node:child_process'
import { accessSync, constants, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scrubText } from '#shared/integrations/redact.ts'
import { piVersionPasses, type PiSetup } from '#shared/protocol/setup.ts'
import { PI_PACKAGES } from '#shared/setup/pi-packages.ts'
import { Unavailable, type HostHandlers } from '../commands.ts'
import type { Launcher } from '../launcher-models.ts'
import { nodeBuild } from './node.ts'

/**
 * Pi on this Mac, for the first-run setup (025-onboarding): found, read and installed as `hobkin setup` says to (its
 * `src/cli/setup.mjs`), without the slower checks that one makes too. Every program runs through one `run`.
 */

const PI_PACKAGE = '@earendil-works/pi-coding-agent'
const READ_MS = 5000
const INSTALL_MS = 5 * 60_000
const VERSION = /\d+\.\d+\.\d+\S*/
// The end of what a failed install printed is where it says why.
const LAST_LINES = 8
const ANSI = /\x1b\[[0-9;]*m/g

/**
 * Where pnpm, npm and Homebrew put programs, then hobkin's own Node (`ownNode`, its `bin` folder, `node.ts`), then the
 * Node the host runs on, for a host that launchd started with a short PATH.
 */
export const programPlaces = (home: string, ownNode?: string): string[] => [
  join(home, 'Library', 'pnpm'),
  join(home, '.npm-global', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  ...(ownNode ? [ownNode] : []),
  dirname(process.execPath),
]

export interface FindProgramOptions {
  path?: string
  home?: string
  /** The `bin` folder of hobkin's own Node, where its npm puts Pi. */
  ownNode?: string
  /** Replaces the places after the PATH. */
  places?: readonly string[]
}

const isProgram = (file: string) => {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** The program to run: the first one on the PATH, then the usual places. Looked up on every call. */
export function findProgram(name: 'pi' | 'npm' | 'node', { path = process.env.PATH ?? '', home = homedir(), ownNode, places }: FindProgramOptions = {}): string | null {
  for (const folder of [...path.split(delimiter), ...(places ?? programPlaces(home, ownNode))]) {
    if (folder && isProgram(join(folder, name))) return join(folder, name)
  }
  return null
}

/**
 * The Node npm runs on: the one beside it, or else the host's own, as `environment` gives it. Without npm, the first
 * Node found outside the host's own folder: in the app that folder holds the Node it carries, which has no npm.
 */
function nodeFor(npm: string | null, findNode: () => string | null): string | null {
  if (npm) return isProgram(join(dirname(npm), 'node')) ? join(dirname(npm), 'node') : process.execPath
  const node = findNode()
  return node && dirname(node) !== dirname(process.execPath) ? node : null
}

export type PiRun = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; encoding: 'utf8'; env: NodeJS.ProcessEnv },
  done: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown

const realRun: PiRun = (file, args, options, done) => execFile(file, [...args], options, done)

/** pi and npm are Node scripts. With a short PATH their `env node` finds the Node beside them, or the host's own. */
const environment = (file: string): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: [dirname(file), dirname(process.execPath), process.env.PATH ?? ''].filter(Boolean).join(delimiter),
})

interface Ran {
  error: (Error & { killed?: boolean }) | null
  stdout: string
  stderr: string
}

function ran(run: PiRun, file: string, args: string[], timeout: number, env: NodeJS.ProcessEnv = environment(file)): Promise<Ran> {
  return new Promise((resolve) => {
    try {
      run(file, args, { timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', env }, (error, stdout, stderr) =>
        resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
      )
    } catch (error) {
      resolve({ error: error instanceof Error ? error : Error(String(error)), stdout: '', stderr: '' })
    }
  })
}

/** Stdout of a read, or null when it failed or timed out. Pi prints its version on stderr, so that stands in for an empty stdout. */
async function read(run: PiRun, file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  const { error, stdout, stderr } = await ran(run, file, args, READ_MS, env)
  if (error) return null
  return stdout.trim() ? stdout : stderr
}

/** Plain words, then the last lines the program printed, with anything shaped like a secret hidden. */
function failure(words: string, { error, stdout, stderr }: Ran): Error {
  const slow = error?.killed ? ` It took longer than ${INSTALL_MS / 60_000} minutes, so it was stopped.` : ''
  const printed = stderr.trim() ? stderr : stdout
  const lines = printed
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-LAST_LINES)

  let said = ''
  if (lines.length) said = `\n${lines.join('\n')}`
  else if (!slow) said = ` ${error?.message ?? ''}`

  return Error(scrubText(`${words}${slow}${said}`.trimEnd()))
}

async function install(run: PiRun, file: string, args: string[], words: string, env?: NodeJS.ProcessEnv): Promise<void> {
  const result = await ran(run, file, args, INSTALL_MS, env)
  if (result.error) throw failure(words, result)
}

/** The Pi version hobkin runs on, as its package.json pins it. Read each time, since hobkin's checkout can change under the host. */
export function pinnedPi(): string {
  const manifest = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('hobkin/package.json')), 'utf8')) as { peerDependencies?: Record<string, unknown> }
  const pin = manifest.peerDependencies?.[PI_PACKAGE]
  if (typeof pin !== 'string' || !pin) throw Error(`hobkin's package.json does not pin ${PI_PACKAGE}.`)
  return pin
}

const installArgs = (pinned: string) => ['install', '-g', '--ignore-scripts', `${PI_PACKAGE}@${pinned}`]
const installCommand = (pinned: string) => `npm ${installArgs(pinned).join(' ')}`

/** `pi list` names a package by its source, such as `npm:pi-coder` or a path ending in it. A longer name is another package. */
function listed(list: string, name: string): boolean {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\w.-])${literal}(?![\\w-])`).test(list)
}

/** Pi's own folder, by Pi's own rule (`getAgentDir` in its config): the one its variable names, or `.pi/agent` in the home. */
export function piAgentFolder(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const named = env.PI_CODING_AGENT_DIR
  if (!named) return join(home, '.pi', 'agent')
  if (named === '~') return home
  return named.startsWith('~/') ? join(home, named.slice(2)) : named
}

/** Writes a package's setting unless one is there already, so a person's own setting is never replaced. */
function writeSettingOnce(file: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true })
  try {
    // `wx` creates the file or fails, in one step, so nothing can be replaced between a look and a write.
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    const alreadyThere = (error as NodeJS.ErrnoException).code === 'EEXIST'
    if (!alreadyThere) throw error
  }
}

export interface PiSetupOptions {
  /** The `bin` folder of hobkin's own Node, looked in by the finders below when they are not given. */
  ownNode?: string
  findPi?: () => string | null
  findNpm?: () => string | null
  /** Finds a `node`, for a Mac without npm. */
  findNode?: () => string | null
  run?: PiRun
  /**
   * Pi's own folder, where a package's setting goes. Without it no setting is written: only the app's own host
   * names it, so a host started for a check never writes into Pi's folder.
   */
  agentDir?: () => string
  /** The version to install. hobkin's pin when not given. */
  pinned?: string
  /**
   * The launcher the hobkin config names, read each time. With one, Pi is the launcher: the version, the package list
   * and package installs all run through its command and its environment (`launcher-models.ts`).
   */
  launcher?: () => Launcher | undefined | Promise<Launcher | undefined>
}

/** The launcher as a program to run: its command, the words after it, and the environment it owns. Null without one, or when the config cannot be read. */
async function launcherVia(launcher: PiSetupOptions['launcher']): Promise<{ file: string; prefix: string[]; env: NodeJS.ProcessEnv; name: string } | null> {
  try {
    const found = await launcher?.()
    const [file, ...prefix] = found?.command ?? []
    return found && file ? { file, prefix, env: { ...process.env, ...found.env }, name: found.command.join(' ') } : null
  } catch {
    return null
  }
}

/** Pi on this Mac, the Node npm runs on, and the packages hobkin's agents use. It only reads, and a program that fails says nothing. */
export async function piSetup({
  ownNode,
  findPi = () => findProgram('pi', { ownNode }),
  findNpm = () => findProgram('npm', { ownNode }),
  findNode = () => findProgram('node', { ownNode }),
  run = realRun,
  pinned = pinnedPi(),
  launcher,
}: PiSetupOptions = {}): Promise<PiSetup> {
  const via = await launcherVia(launcher)
  const pi = via ? via.file : findPi()
  const piArgs = (args: string[]) => (via ? [...via.prefix, ...args] : args)
  const npm = findNpm()
  const node = nodeFor(npm, findNode)
  // The host's own Node says its version without being asked.
  const askNode = node !== null && node !== process.execPath
  const [versionText, list, nodeText] = await Promise.all([
    pi ? read(run, pi, piArgs(['--version']), via?.env) : null,
    pi ? read(run, pi, piArgs(['list']), via?.env) : null,
    askNode ? read(run, node, ['--version']) : null,
  ])

  const version = versionText?.match(VERSION)?.[0] ?? null
  let nodeVersion: string | null = null
  if (askNode) nodeVersion = nodeText?.match(VERSION)?.[0] ?? null
  else if (node) nodeVersion = process.versions.node
  return {
    installed: pi !== null,
    version,
    pinned,
    matches: piVersionPasses(version),
    canInstall: npm !== null,
    installCommand: installCommand(pinned),
    packages: PI_PACKAGES.filter(({ optional }) => !optional).map(({ name, adds }) => ({ name, adds, installed: list !== null && listed(list, name) })),
    node: { found: node !== null, version: nodeVersion, installs: process.versions.node },
    ...(via ? { launcher: via.name } : {}),
  }
}

/** Installs the pinned Pi, globally, with the npm found. */
export async function installPi({ ownNode, findNpm = () => findProgram('npm', { ownNode }), run = realRun, pinned = pinnedPi() }: PiSetupOptions = {}): Promise<void> {
  const npm = findNpm()
  if (!npm) throw new Unavailable(`npm is not on this Mac, so Pi cannot be installed from here. Once Node is installed, run \`${installCommand(pinned)}\` in a terminal.`)
  await install(run, npm, installArgs(pinned), 'npm could not install Pi.')
}

/** Installs one of the catalog's packages through Pi, by its name, so what Pi installs never comes from the window. */
export async function installPackage(name: string, { ownNode, findPi = () => findProgram('pi', { ownNode }), run = realRun, agentDir, launcher }: PiSetupOptions = {}): Promise<void> {
  const known = PI_PACKAGES.find((item) => item.name === name)
  if (!known) throw new Unavailable(`${name} is not one of the Pi packages hobkin sets up.`)
  const via = await launcherVia(launcher)
  const pi = via ? via.file : findPi()
  if (!pi) throw new Unavailable(`Pi is not installed yet, so ${name} cannot be. Install Pi first.`)
  await install(run, pi, [...(via?.prefix ?? []), 'install', known.source], `Pi could not install ${name}.`, via?.env)

  if (!known.config || !agentDir) return
  try {
    writeSettingOnce(join(agentDir(), known.config.file), known.config.value)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    throw new Unavailable(`${name} is installed, but its setting could not be written: ${why}`)
  }
}

/** What a host does with an install when nobody handed it an installer: nothing. */
export const refuseInstall = async (): Promise<never> => {
  throw new Unavailable("This host installs nothing on this Mac. Only the app's own host does.")
}

export interface PiSetupHandlerOptions {
  /** The host runs the real model. A scripted development host installs nothing, so a check never changes the Mac. */
  live: boolean
  read: () => Promise<PiSetup>
  installPi: () => Promise<void>
  installPackage: (name: string) => Promise<void>
  /** Installs hobkin's own Node (`node.ts`). Without it the host offers none, and refuses to install one. */
  installNode?: () => Promise<void>
  /**
   * Asks the login shell for its PATH again and adds the folders the host's lacks (`login-path.ts`), true when it
   * added any. Without it the PATH stays as the host started with it, and no shell is ever asked.
   */
  refreshPath?: () => Promise<boolean>
}

export function piSetupHandlers({
  live,
  read,
  installPi: installThePi,
  installPackage: installTheirs,
  installNode: installTheNode,
  refreshPath,
}: PiSetupHandlerOptions): HostHandlers {
  const mayInstall = () => {
    if (!live) throw new Unavailable('This is the scripted development host, so nothing is installed on this Mac. Start the host with --live to install Pi or its packages.')
  }
  // Only a live host handed the installer offers a Node of hobkin's own, and only on a Mac it has a build for.
  const canInstallNode = live && installTheNode !== undefined && nodeBuild() !== null
  const readSetup = async (): Promise<PiSetup> => ({ ...(await read()), canInstallNode })
  return {
    // A program installed while the app was open can be in a folder the host's PATH lacks, so with Pi or npm missing
    // the login shell is asked again before the setup says so.
    'setup.pi': async () => {
      const found = await readSetup()
      if ((found.installed && found.canInstall) || !refreshPath) return found
      const added = await refreshPath().catch(() => false)
      return added ? readSetup() : found
    },
    'setup.install-pi': async () => {
      mayInstall()
      await installThePi()
      return readSetup()
    },
    'setup.install-package': async ({ name }) => {
      mayInstall()
      await installTheirs(name)
      return readSetup()
    },
    'setup.install-node': async () => {
      mayInstall()
      await (installTheNode ?? refuseInstall)()
      return readSetup()
    },
  }
}
