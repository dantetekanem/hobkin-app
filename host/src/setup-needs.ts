import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { delimiter, dirname } from 'node:path'
import { askWith, ghState, gitState, type Ask, type Asked } from 'hobkin/src/cli/setup.mjs'
import type { ClaudeCodeSettings, ClaudeCodeStatus } from '#shared/protocol/claude-code.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { ProofTools } from '#shared/protocol/proofs.ts'
import { PI_MIN_MAJOR, type PiSetup, type SetupFix, type SetupNeed, type SetupNeeds, type SetupProgram, type SignInProgram } from '#shared/protocol/setup.ts'
import { PI_NODE } from '#shared/setup/agent-prompt.ts'
import { PI_PACKAGES } from '#shared/setup/pi-packages.ts'
import type { HostHandlers } from './commands.ts'
import { findProgram } from './pi/install.ts'
import { findGh } from './review/gh.ts'
import { findAgenticSearch } from './review/vicinity-scan.ts'
import { GH_VERSION } from './setup/gh.ts'
import { QMD_VERSION } from './setup/programs.ts'

/**
 * The setup's review of everything hobkin needs on this Mac (025-onboarding): one row each, with what needs it,
 * whether it was found, its version, and how to fix it. Every read runs at once and only reads: programs are asked
 * about themselves, and only `gh auth status` reaches the network. git and gh are read the way `hobkin setup` reads
 * them (its `src/cli/setup.mjs`), so the Mac's /usr/bin/git stand-in is never run.
 */

/** The longest one program may take. `gh auth status` waits on GitHub. */
const PROGRAM_MS = 10_000
/** The longest a reader handed in may take. Pi's own read runs programs of its own and may ask the login shell too. */
const READER_MS = 20_000
const VERSION = /\d+\.\d+\.\d+\S*/

/** Claude Code as it is, and whether hobkin's agents run on it. */
export interface ClaudeCodeFound {
  settings: Pick<ClaudeCodeSettings, 'enabled'>
  status: ClaudeCodeStatus
}

export interface SetupNeedsOptions {
  /** Pi, its packages and the Node npm runs on, as `setup.pi` answers. */
  pi: () => Promise<PiSetup>
  /** The providers Pi reaches, as `models.list` answers. */
  models: () => Promise<Pick<ModelsState, 'providers'>>
  /** The TLA+ tools in hobkin's home, found without running any. */
  proofTools: () => ProofTools | Promise<ProofTools>
  claude: () => Promise<ClaudeCodeFound>
  /** Finds a program by name as the code that runs it does, or null. */
  find?: (name: string) => string | null
  /** Runs a program and answers with what it printed, throwing as execFile does. */
  exec?: (file: string, args: readonly string[]) => Promise<string>
  platform?: NodeJS.Platform
  /** The longest a reader handed in may take. */
  timeoutMs?: number
  /** The `bin` folder of hobkin's own Node, whose npm Terminal does not find. */
  ownNode?: string
  /** The user's home, which a line to copy names as `~`. */
  userHome?: string
  /**
   * The programs this host installs and signs in on a press (`setup/programs.ts`). Without it every program's fix is
   * the line to copy, as on a host that installs nothing.
   */
  presses?: Presses
}

/** Whether a press can install a program, or run its sign-in, on this host. */
export interface Presses {
  install: (name: SetupProgram) => boolean
  signIn: (name: SignInProgram) => boolean
}

const NO_PRESSES: Presses = { install: () => false, signIn: () => false }

/** gh and agentic-search are looked for where Change Review looks; the rest on the PATH, where the host runs them. */
function findDefault(name: string): string | null {
  if (name === 'gh') return findGh()
  if (name === 'agentic-search') return findAgenticSearch()
  return findProgram(name, { places: [] })
}

/** A program that is a Node script finds the Node beside it, or the host's own, on a short PATH. */
function execDefault(file: string, args: readonly string[]): Promise<string> {
  const env = {
    ...process.env,
    PATH: [dirname(file), dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
  }
  const options = { timeout: PROGRAM_MS, maxBuffer: 1024 * 1024, encoding: 'utf8' as const, env }

  return new Promise((resolve, reject) => {
    execFile(file, [...args], options, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/** Asks a program by its name or its path. One that is not found is absent, as a missing file is to execFile. */
function askFor(find: (name: string) => string | null, exec: (file: string, args: readonly string[]) => Promise<string>): Ask {
  return askWith((command, args) => {
    const file = command.includes('/') ? command : find(command)
    if (file) return exec(file, args)

    const absent = Object.assign(Error(`${command} is not installed.`), { code: 'ENOENT' })
    return Promise.reject(absent)
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

/** What each press installs, and from where, in the words its row shows. */
const SAYS = {
  git: "Installs Apple's Command Line Tools, which bring git. Not the Xcode app.",
  gh: `Installs GitHub's own gh ${GH_VERSION}, from GitHub, into hobkin's folder.`,
  ghSignIn: 'Signs gh in to your GitHub account in the browser, with a one-time code.',
  claude: "Installs Claude Code with Anthropic's own installer, from claude.ai.",
  claudeSignIn: 'Signs Claude Code in to your Claude account in the browser.',
  qmd: `Installs qmd ${QMD_VERSION} from npm. It downloads its search model on first use.`,
}

const NO_ANSWER = 'Did not answer'

const found = (need: Need, version: string | null = null): SetupNeed => ({
  ...need,
  found: true,
  version,
  problem: null,
  fix: null,
})

const missing = (need: Need, problem: string, fix: SetupFix, version: string | null = null): SetupNeed => ({
  ...need,
  found: false,
  version,
  problem,
  fix,
})

const command = (line: string): SetupFix => ({ kind: 'command', command: line })

/** The setup's own install of a program where this host has one, and otherwise the line to copy. */
const installOr = (presses: Presses, name: SetupProgram, says: string, byHand: string): SetupFix =>
  presses.install(name) ? { kind: 'install-program', name, says, byHand } : command(byHand)
/** The program's own sign-in where this host runs it, and otherwise the line to copy. */
const signInOr = (presses: Presses, name: SignInProgram, says: string, byHand: string): SetupFix =>
  presses.signIn(name) ? { kind: 'sign-in-program', name, says, byHand } : command(byHand)
const versionOf = (asked: Asked) => asked.text?.match(VERSION)?.[0] ?? null
const atLeast = (version: string, least: string) => version.localeCompare(least, 'en', { numeric: true }) >= 0

/** What a line to copy can count on in Terminal: Homebrew, and the words that start npm. */
interface Lines {
  homebrew: boolean
  /** `npm`, hobkin's own npm with its folder first on the PATH, or null when this Mac has no npm. */
  npm: string | null
}

/** A path as a line names it: `~` for the home, so no line holds the user's folder name, and quoted where it must be. */
function pathForLine(path: string, home: string): string {
  const inHome = path.startsWith(`${home}/`)
  const rest = inHome ? path.slice(home.length + 1) : path
  const plain = /^[\w./-]+$/.test(rest)
  const quoted = plain ? rest : `'${rest.replaceAll("'", "'\\''")}'`
  return inHome ? `~/${quoted}` : quoted
}

/**
 * The words that start the npm found. The host's PATH is the login shell's, so Terminal finds the same npm, but for
 * hobkin's own. That npm, and the install scripts it runs, start `node` from the PATH, so its folder goes first.
 */
function npmWords(npm: string | null, ownNode: string | undefined, home: string): string | null {
  if (!npm) return null
  if (ownNode && dirname(npm) === ownNode) return `PATH=${pathForLine(ownNode, home)}:"$PATH" npm`
  return 'npm'
}

function linesOn(find: (name: string) => string | null, ownNode: string | undefined, home: string): Lines {
  return {
    homebrew: find('brew') !== null,
    npm: npmWords(find('npm'), ownNode, home),
  }
}

/** Without Homebrew, the official installers, which need nothing else. */
const nodeByHand = ({ homebrew }: Lines) => command(homebrew ? 'brew install node' : 'https://nodejs.org/en/download')
const ghByHand = ({ homebrew }: Lines) => (homebrew ? 'brew install gh' : 'https://cli.github.com')

/** The setup's own install that brings Pi: Pi itself with npm, or first a Node of hobkin's own. Null when neither can run. */
function piInstall(pi: PiSetup | null): SetupFix | null {
  if (pi?.canInstall) return { kind: 'install', what: 'pi' }
  if (pi?.canInstallNode) return { kind: 'install', what: 'node' }
  return null
}

/** qmd, which npm installs: on a press through the npm found, or with no npm, hobkin's own Node first where it has one. */
function qmdInstall(pi: PiSetup | null, lines: Lines, presses: Presses): SetupFix {
  const line = (npm: string) => `${npm} install -g --ignore-scripts @tobilu/qmd@${QMD_VERSION}`
  if (lines.npm) return installOr(presses, 'qmd', SAYS.qmd, line(lines.npm))
  if (pi?.canInstallNode) return { kind: 'install', what: 'node' }
  return command(line('npm'))
}

const GIT_BY_HAND = 'xcode-select --install'
const SIGN_IN_FIX: SetupFix = { kind: 'sign-in' }
const INSTALL_PROOF_TOOLS: SetupFix = { kind: 'install', what: 'proof-tools' }

function nodeNeed(pi: PiSetup | null, lines: Lines): SetupNeed {
  const node = pi?.node
  if (!pi || !node) return missing(NODE, NO_ANSWER, command('node --version'))

  // hobkin's own Node comes with npm, so it stands in for a Node or an npm that is missing. It does not replace an old one.
  const ownNode: SetupFix = pi.canInstallNode ? { kind: 'install', what: 'node' } : nodeByHand(lines)
  const tooOld = !node.version || !atLeast(node.version, PI_NODE)

  if (!node.found) return missing(NODE, 'Not found', ownNode)
  if (tooOld) return missing(NODE, `Needs ${PI_NODE} or newer`, nodeByHand(lines), node.version)
  if (!pi.canInstall) return missing(NODE, 'No npm beside it', ownNode, node.version)
  return found(NODE, node.version)
}

/** Under a launcher, Pi is what it starts, so only the launcher can change it. Otherwise the setup installs it, or the user does. */
function piFix(pi: PiSetup): SetupFix {
  if (pi.launcher) return command(`${pi.launcher} --version`)
  return piInstall(pi) ?? command(pi.installCommand)
}

function piNeed(pi: PiSetup | null): SetupNeed {
  if (!pi) return missing(PI, NO_ANSWER, command('pi --version'))

  const need = pi.launcher ? { ...PI, name: `Pi through ${pi.launcher}` } : PI
  const fix = piFix(pi)

  if (!pi.installed) return missing(need, 'Not installed', fix)
  if (!pi.matches) return missing(need, pi.version ? `Needs ${PI_MIN_MAJOR}.0 or newer` : 'Did not say its version', fix, pi.version)
  return found(need, pi.version)
}

/** Pi installs one of its packages once Pi is here. Until then the setup brings Pi, or the user has the package's line. */
function packageFix(pi: PiSetup | null, name: string): SetupFix {
  if (pi?.installed) return { kind: 'install-package', name }
  const bringPi = piInstall(pi)
  if (bringPi) return bringPi

  const source = PI_PACKAGES.find((known) => known.name === name)?.source ?? name
  return command(`pi install ${source}`)
}

/** Each package hobkin's agents use. */
function packageNeeds(pi: PiSetup | null): SetupNeed[] {
  return (pi?.packages ?? []).map(({ name, adds, installed }) => {
    const need: Need = { id: `package:${name}`, group: 'features', name, neededBy: adds }
    if (installed) return found(need)
    return missing(need, 'Not installed', packageFix(pi, name))
  })
}

function signInNeed(models: Pick<ModelsState, 'providers'> | null): SetupNeed {
  if (!models) return missing(SIGN_IN, NO_ANSWER, SIGN_IN_FIX)
  if (!models.providers.some((provider) => provider.connected)) return missing(SIGN_IN, 'No model is connected', SIGN_IN_FIX)
  return found(SIGN_IN)
}

async function gitNeed(ask: Ask, which: (name: string) => string | null, platform: NodeJS.Platform, presses: Presses): Promise<SetupNeed> {
  const git = await gitState(ask, { which, platform })
  // Apple's installer is the Mac's own, so only a Mac gets the press.
  const fix = platform === 'darwin' ? installOr(presses, 'git', SAYS.git, GIT_BY_HAND) : command(GIT_BY_HAND)

  if (git.found) return found(GIT, git.version)
  if (git.why === 'no-tools') return missing(GIT, 'Needs the command line tools', fix)
  return missing(GIT, git.why === 'absent' ? 'Not installed' : 'Did not run', fix)
}

async function ghNeed(ask: Ask, lines: Lines, presses: Presses): Promise<SetupNeed> {
  const [gh, versionSaid] = await Promise.all([ghState(ask), ask('gh', ['--version'])])
  const version = versionOf(versionSaid)

  if (!gh.installed) return missing(GH, 'Not installed', installOr(presses, 'gh', SAYS.gh, ghByHand(lines)))
  if (!gh.signedIn) return missing(GH, 'Not signed in, or GitHub did not answer', signInOr(presses, 'gh', SAYS.ghSignIn, 'gh auth login'), version)
  return found(GH, version)
}

function tlaNeed(tools: ProofTools | null): SetupNeed {
  if (!tools) return missing(TLA, NO_ANSWER, INSTALL_PROOF_TOOLS)
  if (!tools.java) return missing(TLA, 'No Java', INSTALL_PROOF_TOOLS)
  if (!tools.tlc) return missing(TLA, 'No TLC', INSTALL_PROOF_TOOLS)
  return found(TLA)
}

/** A program that was asked its version: found when it answered, and otherwise fixed by `fix`. */
function programNeed(need: Need, said: Asked, fix: SetupFix): SetupNeed {
  if (said.failed) return missing(need, said.absent ? 'Not installed' : 'Did not run', fix)
  return found(need, versionOf(said))
}

/** Claude Code has a row only while hobkin's agents run on it. */
function claudeNeeds(claude: ClaudeCodeFound | null, presses: Presses): SetupNeed[] {
  if (!claude?.settings.enabled) return []

  const { installed, signedIn, version } = claude.status
  if (!installed) return [missing(CLAUDE, 'Not installed', installOr(presses, 'claude', SAYS.claude, 'curl -fsSL https://claude.ai/install.sh | bash'))]
  // Null is a sign-in it could not tell, which is not a missing one.
  if (signedIn === false) return [missing(CLAUDE, 'Not signed in', signInOr(presses, 'claude', SAYS.claudeSignIn, 'claude auth login'), version)]
  return [found(CLAUDE, version)]
}

/** Everything hobkin needs, read at once, in the order the review shows it. */
export async function readSetupNeeds({
  find = findDefault,
  exec = execDefault,
  platform = process.platform,
  timeoutMs = READER_MS,
  ownNode,
  userHome = homedir(),
  presses = NO_PRESSES,
  ...read
}: SetupNeedsOptions): Promise<SetupNeeds> {
  const ask = askFor(find, exec)
  const lines = linesOn(find, ownNode, userHome)
  const [pi, models, tools, claude, git, gh, search, qmd] = await Promise.all([
    settled(read.pi, timeoutMs),
    settled(read.models, timeoutMs),
    settled(read.proofTools, timeoutMs),
    settled(read.claude, timeoutMs),
    gitNeed(ask, find, platform, presses),
    ghNeed(ask, lines, presses),
    ask(SEARCH.id, ['--version']),
    ask(QMD.id, ['--version']),
  ])

  const needs = [
    nodeNeed(pi, lines),
    piNeed(pi),
    signInNeed(models),
    git,
    gh,
    ...packageNeeds(pi),
    tlaNeed(tools),
    // Pi keeps the program in its own folder with its package, where Change Review looks for it.
    programNeed(SEARCH, search, packageFix(pi, 'pi-agentic-search')),
    ...claudeNeeds(claude, presses),
    programNeed(QMD, qmd, qmdInstall(pi, lines, presses)),
  ]
  return { needs }
}

export function setupNeedsHandlers(options: SetupNeedsOptions): Pick<HostHandlers, 'setup.needs'> {
  return { 'setup.needs': () => readSetupNeeds(options) }
}
