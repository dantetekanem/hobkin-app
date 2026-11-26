import { execFile } from 'node:child_process'
import { delimiter, dirname } from 'node:path'
import { askWith, ghState, gitState, type Ask, type Asked } from 'hobkin/src/cli/setup.mjs'
import type { ClaudeCodeSettings, ClaudeCodeStatus } from '#shared/protocol/claude-code.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { ProofTools } from '#shared/protocol/proofs.ts'
import { PI_MIN_MAJOR, type PiSetup, type SetupFix, type SetupNeed, type SetupNeeds } from '#shared/protocol/setup.ts'
import { PI_NODE } from '#shared/setup/agent-prompt.ts'
import { PI_PACKAGES } from '#shared/setup/pi-packages.ts'
import type { HostHandlers } from './commands.ts'
import { findProgram } from './pi/install.ts'
import { findGh } from './review/gh.ts'
import { findAgenticSearch } from './review/vicinity-scan.ts'

/**
 * The setup's review of everything hobkin needs on this Mac (025-onboarding): one row each, with what needs it,
 * whether it was found, its version, and how to fix it. Every read runs at once and only reads: programs are asked
 * about themselves, and only `gh auth status` reaches the network. git and gh are read the way `hobkin setup` reads
 * them (its `src/cli/setup.mjs`), so the Mac's /usr/bin/git stand-in is never run.
 */

/** The longest one program, or one of the readers below, may take. `gh auth status` waits on GitHub. */
const READ_MS = 10_000
const VERSION = /\d+\.\d+\.\d+\S*/

export interface SetupNeedsOptions {
  /** Pi, its packages and the Node npm runs on, as `setup.pi` answers. */
  pi: () => Promise<PiSetup>
  /** The providers Pi reaches, as `models.list` answers. */
  models: () => Promise<Pick<ModelsState, 'providers'>>
  /** The TLA+ tools in hobkin's home, found without running any. */
  proofTools: () => ProofTools | Promise<ProofTools>
  /** Claude Code as it is, and whether hobkin's agents run on it. */
  claude: () => Promise<{ settings: Pick<ClaudeCodeSettings, 'enabled'>; status: ClaudeCodeStatus }>
  /** Finds a program by name as the code that runs it does, or null. */
  find?: (name: string) => string | null
  /** Runs a program and answers with what it printed, throwing as execFile does. */
  exec?: (file: string, args: readonly string[]) => Promise<string>
  platform?: NodeJS.Platform
  timeoutMs?: number
}

/** gh and agentic-search are looked for where Change Review looks; the rest on the PATH, where the host runs them. */
function findDefault(name: string): string | null {
  if (name === 'gh') return findGh()
  if (name === 'agentic-search') return findAgenticSearch()
  return findProgram(name, { places: [] })
}

/** A program that is a Node script finds the Node beside it, or the host's own, on a short PATH. */
const execDefault = (file: string, args: readonly string[]) =>
  new Promise<string>((resolve, reject) => {
    const env = { ...process.env, PATH: [dirname(file), dirname(process.execPath), process.env.PATH ?? ''].join(delimiter) }
    execFile(file, [...args], { timeout: READ_MS, maxBuffer: 1024 * 1024, encoding: 'utf8', env }, (error, stdout) => (error ? reject(error) : resolve(stdout)))
  })

/** Asks a program by its name or its path. One that is not found is absent, as a missing file is to execFile. */
function askFor(find: (name: string) => string | null, exec: (file: string, args: readonly string[]) => Promise<string>): Ask {
  return askWith((command, args) => {
    const file = command.includes('/') ? command : find(command)
    if (!file) return Promise.reject(Object.assign(Error(`${command} is not installed.`), { code: 'ENOENT' }))
    return exec(file, args)
  })
}

/** What a reader answered, or null when it threw or took longer than `ms`, so no one read holds the review up. */
function settled<T>(read: () => T | Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    Promise.resolve()
      .then(read)
      .then(resolve, () => resolve(null))
      .finally(() => clearTimeout(timer))
  })
}

type Need = Pick<SetupNeed, 'id' | 'group' | 'name' | 'neededBy'>

const NODE: Need = { id: 'node', group: 'run', name: 'Node', neededBy: 'Pi runs on it' }
const PI: Need = { id: 'pi', group: 'run', name: 'Pi', neededBy: 'The chat, agents and checks' }
const SIGN_IN: Need = { id: 'sign-in', group: 'run', name: 'Model sign-in', neededBy: 'Every model hobkin runs' }
const GIT: Need = { id: 'git', group: 'code', name: 'git', neededBy: 'Work and Change Review' }
const GH: Need = { id: 'gh', group: 'code', name: 'GitHub CLI', neededBy: 'Pull requests in Work and Review' }
const TLA: Need = { id: 'tla', group: 'features', name: 'TLA+ tools', neededBy: 'Checks of state machine models' }
const SEARCH: Need = { id: 'agentic-search', group: 'features', name: 'agentic-search', neededBy: "Change Review's search facts" }
const CLAUDE: Need = { id: 'claude', group: 'features', name: 'Claude Code', neededBy: 'Agents set to run on it' }
const QMD: Need = { id: 'qmd', group: 'optional', name: 'qmd', neededBy: 'Memory search for agents' }

const NO_ANSWER = 'Did not answer'
const found = (need: Need, version: string | null = null): SetupNeed => ({ ...need, found: true, version, problem: null, fix: null })
const missing = (need: Need, problem: string, fix: SetupFix, version: string | null = null): SetupNeed => ({ ...need, found: false, version, problem, fix })
const command = (line: string): SetupFix => ({ kind: 'command', command: line })
const versionOf = (asked: Asked) => asked.text?.match(VERSION)?.[0] ?? null
const atLeast = (version: string, least: string) => version.localeCompare(least, 'en', { numeric: true }) >= 0

const INSTALL_NODE = command('brew install node')
const INSTALL_GIT = command('xcode-select --install')

function nodeNeed(pi: PiSetup | null): SetupNeed {
  const node = pi?.node
  if (!pi || !node) return missing(NODE, NO_ANSWER, command('node --version'))
  // hobkin's own Node comes with npm, so it stands in for a Node or an npm that is missing. It does not replace an old one.
  const ownNode: SetupFix = pi.canInstallNode ? { kind: 'install', what: 'node' } : INSTALL_NODE
  if (!node.found) return missing(NODE, 'Not found', ownNode)
  if (!node.version || !atLeast(node.version, PI_NODE)) return missing(NODE, `Needs ${PI_NODE} or newer`, INSTALL_NODE, node.version)
  if (!pi.canInstall) return missing(NODE, 'No npm beside it', ownNode, node.version)
  return found(NODE, node.version)
}

function piNeed(pi: PiSetup | null): SetupNeed {
  if (!pi) return missing(PI, NO_ANSWER, command('pi --version'))
  // Under a launcher, Pi is what it starts, so only the launcher can change it.
  const need = pi.launcher ? { ...PI, name: `Pi through ${pi.launcher}` } : PI
  const fix: SetupFix = pi.launcher ? command(`${pi.launcher} --version`) : pi.canInstall ? { kind: 'install', what: 'pi' } : command(pi.installCommand)
  if (!pi.installed) return missing(need, 'Not installed', fix)
  if (!pi.matches) return missing(need, pi.version ? `Needs ${PI_MIN_MAJOR}.0 or newer` : 'Did not say its version', fix, pi.version)
  return found(need, pi.version)
}

function packageNeeds(pi: PiSetup | null): SetupNeed[] {
  return (pi?.packages ?? []).map(({ name, adds, installed }) => {
    const need: Need = { id: `package:${name}`, group: 'features', name, neededBy: adds }
    if (installed) return found(need)
    const source = PI_PACKAGES.find((known) => known.name === name)?.source ?? name
    return missing(need, 'Not installed', pi?.installed ? { kind: 'install-package', name } : command(`pi install ${source}`))
  })
}

function signInNeed(models: Pick<ModelsState, 'providers'> | null): SetupNeed {
  if (!models) return missing(SIGN_IN, NO_ANSWER, { kind: 'sign-in' })
  return models.providers.some((provider) => provider.connected) ? found(SIGN_IN) : missing(SIGN_IN, 'No model is connected', { kind: 'sign-in' })
}

async function gitNeed(ask: Ask, which: (name: string) => string | null, platform: NodeJS.Platform): Promise<SetupNeed> {
  const git = await gitState(ask, { which, platform })
  if (git.found) return found(GIT, git.version)
  if (git.why === 'no-tools') return missing(GIT, 'Needs the command line tools', INSTALL_GIT)
  return missing(GIT, git.why === 'absent' ? 'Not installed' : 'Did not run', INSTALL_GIT)
}

async function ghNeed(ask: Ask): Promise<SetupNeed> {
  const [{ installed, signedIn }, said] = await Promise.all([ghState(ask), ask('gh', ['--version'])])
  if (!installed) return missing(GH, 'Not installed', command('brew install gh'))
  if (!signedIn) return missing(GH, 'Not signed in, or GitHub did not answer', command('gh auth login'), versionOf(said))
  return found(GH, versionOf(said))
}

function tlaNeed(tools: ProofTools | null): SetupNeed {
  const install: SetupFix = { kind: 'install', what: 'proof-tools' }
  if (!tools) return missing(TLA, NO_ANSWER, install)
  if (!tools.java) return missing(TLA, 'No Java', install)
  return tools.tlc ? found(TLA) : missing(TLA, 'No TLC', install)
}

/** A program asked its version: found when it answers, and fixed by the one line to install it. */
async function programNeed(ask: Ask, need: Need, install: string): Promise<SetupNeed> {
  const said = await ask(need.id, ['--version'])
  if (said.failed) return missing(need, said.absent ? 'Not installed' : 'Did not run', command(install))
  return found(need, versionOf(said))
}

function claudeNeeds(claude: Awaited<ReturnType<SetupNeedsOptions['claude']>> | null): SetupNeed[] {
  if (!claude?.settings.enabled) return []
  const { installed, signedIn, version } = claude.status
  if (!installed) return [missing(CLAUDE, 'Not installed', command('curl -fsSL https://claude.ai/install.sh | bash'))]
  // Null is a sign-in it could not tell, which is not a missing one.
  if (signedIn === false) return [missing(CLAUDE, 'Not signed in', command('claude auth login'), version)]
  return [found(CLAUDE, version)]
}

/** Everything hobkin needs, read at once, in the order the review shows it. */
export async function readSetupNeeds({ find = findDefault, exec = execDefault, platform = process.platform, timeoutMs = READ_MS * 2, ...read }: SetupNeedsOptions): Promise<SetupNeeds> {
  const ask = askFor(find, exec)
  const [pi, models, tools, claude, git, gh, search, qmd] = await Promise.all([
    settled(read.pi, timeoutMs),
    settled(read.models, timeoutMs),
    settled(read.proofTools, timeoutMs),
    settled(read.claude, timeoutMs),
    gitNeed(ask, find, platform),
    ghNeed(ask),
    // Pi installs its packages in its own folder, so the package alone does not put the program on the PATH.
    programNeed(ask, SEARCH, 'npm install -g pi-agentic-search'),
    programNeed(ask, QMD, 'npm install -g @tobilu/qmd'),
  ])
  return {
    needs: [nodeNeed(pi), piNeed(pi), signInNeed(models), git, gh, ...packageNeeds(pi), tlaNeed(tools), search, ...claudeNeeds(claude), qmd],
  }
}

export function setupNeedsHandlers(options: SetupNeedsOptions): Pick<HostHandlers, 'setup.needs'> {
  return { 'setup.needs': () => readSetupNeeds(options) }
}
