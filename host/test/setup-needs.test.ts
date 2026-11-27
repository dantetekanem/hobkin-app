import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ClaudeCodeStatus } from '../../shared/protocol/claude-code.ts'
import type { PiSetup, SetupNeed } from '../../shared/protocol/setup.ts'
import { PI_PACKAGES } from '../../shared/setup/pi-packages.ts'
import { readSetupNeeds, setupNeedsHandlers, type SetupNeedsOptions } from '../src/setup-needs.ts'

const pi = (over: Partial<PiSetup> = {}): PiSetup => ({
  installed: true,
  version: '1.5.0',
  pinned: '1.5.0',
  matches: true,
  canInstall: true,
  installCommand: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0',
  packages: [{ name: 'pi-coder', adds: 'A diff viewer.', installed: true }],
  node: { found: true, version: '22.19.0', installs: '22.19.0' },
  canInstallNode: true,
  ...over,
})

const claudeStatus = (over: Partial<ClaudeCodeStatus> = {}): ClaudeCodeStatus => ({ installed: true, version: '2.1.323', signedIn: true, authMethod: 'claude.ai', plan: 'max', ...over })

/** Where each program is on a ready Mac. */
const PROGRAMS: Record<string, string> = {
  git: '/opt/homebrew/bin/git',
  gh: '/opt/homebrew/bin/gh',
  'agentic-search': '/Users/someone/Library/pnpm/bin/agentic-search',
  qmd: '/opt/homebrew/bin/qmd',
  'xcode-select': '/usr/bin/xcode-select',
  // Only looked for, never run.
  brew: '/opt/homebrew/bin/brew',
  npm: '/opt/homebrew/bin/npm',
}

/** What each program prints on a ready Mac, by the line that runs it. */
const PRINTS: Record<string, string> = {
  '/opt/homebrew/bin/git --version': 'git version 2.50.1\n',
  '/opt/homebrew/bin/gh --version': 'gh version 2.92.0 (2026-04-28)\n',
  '/opt/homebrew/bin/gh auth status': 'github.com\n  Logged in to github.com account someone\n',
  '/Users/someone/Library/pnpm/bin/agentic-search --version': '0.8.0\n',
  '/opt/homebrew/bin/qmd --version': 'qmd 2.1.0\n',
}

const failed = (code: number | string) => Object.assign(Error('Command failed'), { code })

interface MacChanges extends Partial<SetupNeedsOptions> {
  /** Where a program is, or null where it is not, over a ready Mac's. */
  programs?: Record<string, string | null>
  /** What a line prints, or the error it fails with, over a ready Mac's. */
  prints?: Record<string, string | Error>
}

/** A Mac as the review reads it: what Pi, the models, the tools and Claude Code say, and the programs that answer. */
function mac({ programs = {}, prints = {}, ...readers }: MacChanges = {}) {
  const calls: string[] = []
  const where = { ...PROGRAMS, ...programs }
  const answers = { ...PRINTS, ...prints }

  const options: SetupNeedsOptions = {
    pi: async () => pi(),
    models: async () => ({ providers: [{ id: 'openai-codex', name: 'OpenAI Codex', connected: true }] }),
    proofTools: () => ({ java: '/jdk/bin/java', tlc: '/home.invalid/tools/tla/tla2tools.jar', tlaps: null }),
    claude: async () => ({ settings: { enabled: true }, status: claudeStatus() }),
    find: (name) => where[name] ?? null,
    exec: async (file, args) => {
      const line = [file, ...args].join(' ')
      calls.push(line)

      const answer = answers[line]
      if (answer instanceof Error) throw answer
      if (answer === undefined) throw Error(`Unexpected command: ${line}`)
      return answer
    },
    platform: 'darwin',
    ...readers,
  }
  return { options, calls }
}

/** The review of that Mac, each need by its id, and every program line it ran. */
async function review(changes: MacChanges = {}) {
  const { options, calls } = mac(changes)
  const { needs } = await readSetupNeeds(options)
  return { list: needs, needs: Object.fromEntries(needs.map((need): [string, SetupNeed] => [need.id, need])), calls }
}

test('a ready Mac: every need is found, in the review order, with its version, and only programs that say what they are run', async () => {
  const { list, needs, calls } = await review()

  assert.deepEqual(
    list.map(({ id, group }) => `${group} ${id}`),
    ['run node', 'run pi', 'run sign-in', 'code git', 'code gh', 'features package:pi-coder', 'features tla', 'features agentic-search', 'features claude', 'optional qmd'],
  )
  assert.deepEqual(list.filter((need) => !need.found || need.problem || need.fix), [])
  assert.deepEqual(
    ['node', 'pi', 'git', 'gh', 'agentic-search', 'claude', 'qmd'].map((id) => needs[id]!.version),
    ['22.19.0', '1.5.0', '2.50.1', '2.92.0', '0.8.0', '2.1.323', '2.1.0'],
  )
  assert.ok(list.every((need) => need.name && need.neededBy))
  assert.deepEqual(calls.toSorted(), Object.keys(PRINTS).toSorted())
})

test('git missing, or the Mac stand-in without the command line tools, which is never run', async () => {
  const installTools = { kind: 'command', command: 'xcode-select --install' }

  const absent = (await review({ programs: { git: null } })).needs.git!
  assert.equal(absent.found, false)
  assert.deepEqual(absent.fix, installTools)

  const noTools = await review({ programs: { git: '/usr/bin/git' }, prints: { '/usr/bin/xcode-select -p': failed(2) } })
  const standIn = noTools.needs.git!
  assert.equal(standIn.found, false)
  assert.match(standIn.problem ?? '', /command line tools/)
  assert.deepEqual(standIn.fix, installTools)
  assert.deepEqual(noTools.calls.filter((line) => line.includes('git')), [], 'no git ran')

  // With the tools, their own git answers.
  const withTools = await review({
    programs: { git: '/usr/bin/git' },
    prints: {
      '/usr/bin/xcode-select -p': '/Library/Developer/CommandLineTools\n',
      '/Library/Developer/CommandLineTools/usr/bin/git --version': 'git version 2.39.5 (Apple Git-154)\n',
    },
  })
  assert.equal(withTools.needs.git!.found, true)
  assert.equal(withTools.needs.git!.version, '2.39.5')
  assert.ok(!withTools.calls.some((line) => line.startsWith('/usr/bin/git')))
})

test('gh missing, or not signed in', async () => {
  const absent = (await review({ programs: { gh: null } })).needs.gh!
  assert.equal(absent.found, false)
  assert.deepEqual(absent.fix, { kind: 'command', command: 'brew install gh' })

  const signedOut = (await review({ prints: { '/opt/homebrew/bin/gh auth status': failed(1) } })).needs.gh!
  assert.equal(signedOut.found, false)
  assert.match(signedOut.problem ?? '', /signed in/)
  assert.equal(signedOut.version, '2.92.0')
  assert.deepEqual(signedOut.fix, { kind: 'command', command: 'gh auth login' })
})

test("what is missing offers the setup's own install where it has one, and otherwise a command to copy", async () => {
  // A Mac with no Node, so no npm and no Pi, nothing signed in, no TLA+ tools, and the programs missing.
  const bareMac = pi({
    installed: false,
    version: null,
    matches: false,
    canInstall: false,
    node: { found: false, version: null, installs: '22.19.0' },
    packages: [{ name: 'pi-coder', adds: 'A diff viewer.', installed: false }],
  })
  const { needs } = await review({
    pi: async () => bareMac,
    models: async () => ({ providers: [{ id: 'openai-codex', name: 'OpenAI Codex', connected: false }] }),
    proofTools: () => ({ java: null, tlc: null, tlaps: null }),
    claude: async () => ({ settings: { enabled: true }, status: claudeStatus({ signedIn: false }) }),
    programs: { 'agentic-search': null, qmd: null, npm: null },
  })

  const gaps = Object.values(needs).filter((need) => !['git', 'gh'].includes(need.id))
  assert.ok(gaps.every((need) => !need.found && need.problem && need.fix))
  assert.deepEqual(needs.node!.fix, { kind: 'install', what: 'node' })
  // No npm yet: whatever needs npm or Pi starts with the Node hobkin installs for itself, since no line could run.
  for (const id of ['pi', 'package:pi-coder', 'agentic-search', 'qmd']) assert.deepEqual(needs[id]!.fix, { kind: 'install', what: 'node' }, id)
  assert.deepEqual(needs['sign-in']!.fix, { kind: 'sign-in' })
  assert.deepEqual(needs.tla!.fix, { kind: 'install', what: 'proof-tools' })
  assert.deepEqual(needs.claude!.fix, { kind: 'command', command: 'claude auth login' })

  // Where hobkin can install no Node, the lines to run once Node is installed by hand.
  const byHand = (await review({ pi: async () => ({ ...bareMac, canInstallNode: false }), programs: { 'agentic-search': null, qmd: null, npm: null } })).needs
  assert.deepEqual(byHand.pi!.fix, { kind: 'command', command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0' })
  const sourceOf = (name: string) => PI_PACKAGES.find((item) => item.name === name)!.source
  assert.deepEqual(byHand['package:pi-coder']!.fix, { kind: 'command', command: `pi install ${sourceOf('pi-coder')}` })
  assert.deepEqual(byHand['agentic-search']!.fix, { kind: 'command', command: `pi install ${sourceOf('pi-agentic-search')}` })
  assert.deepEqual(byHand.qmd!.fix, { kind: 'command', command: 'npm install -g --ignore-scripts @tobilu/qmd@2.9.0' })

  // With npm the window installs Pi, and with Pi the package.
  const oldPi = pi({ version: '0.9.0', matches: false, packages: [{ name: 'pi-coder', adds: '', installed: false }] })
  const installs = (await review({ pi: async () => oldPi, programs: { 'agentic-search': null } })).needs
  assert.deepEqual(installs.pi!.fix, { kind: 'install', what: 'pi' })
  assert.equal(installs.pi!.version, '0.9.0')
  assert.deepEqual(installs['package:pi-coder']!.fix, { kind: 'install-package', name: 'pi-coder' })
  // The program comes with Pi's package, in Pi's own folder, where Change Review looks for it.
  assert.deepEqual(installs['agentic-search']!.fix, { kind: 'install-package', name: 'pi-agentic-search' })
})

test("the lines to copy need no Homebrew the Mac lacks, and name hobkin's own npm by its path", async () => {
  const ownNode = '/Users/someone/.hobkin/client/node/bin'
  const oldNode = pi({ node: { found: true, version: '22.9.0', installs: '22.19.0' } })

  // A Mac without Homebrew, whose only npm is the one in hobkin's own Node.
  const bare = (await review({ pi: async () => oldNode, ownNode, userHome: '/Users/someone', programs: { brew: null, gh: null, qmd: null, npm: `${ownNode}/npm` } })).needs
  assert.deepEqual(bare.gh!.fix, { kind: 'command', command: 'https://cli.github.com' })
  assert.deepEqual(bare.node!.fix, { kind: 'command', command: 'https://nodejs.org/en/download' })
  // npm and the install scripts it runs start `node` from the PATH, and Terminal's has none, so hobkin's comes first.
  assert.deepEqual(bare.qmd!.fix, { kind: 'command', command: 'PATH=~/.hobkin/client/node/bin:"$PATH" npm install -g --ignore-scripts @tobilu/qmd@2.9.0' })
  assert.doesNotMatch(JSON.stringify(Object.values(bare)), /someone/, "never the user's home folder by name")
  const spaced = '/Users/someone/My Homes/hobkin/client/node/bin'
  const quoted = (await review({ ownNode: spaced, userHome: '/Users/someone', programs: { qmd: null, npm: `${spaced}/npm` } })).needs
  assert.deepEqual(quoted.qmd!.fix, { kind: 'command', command: `PATH=~/'My Homes/hobkin/client/node/bin':"$PATH" npm install -g --ignore-scripts @tobilu/qmd@2.9.0` })

  // With Homebrew, and an npm Terminal finds.
  const brewed = (await review({ pi: async () => oldNode, ownNode, programs: { gh: null, qmd: null } })).needs
  assert.deepEqual(brewed.gh!.fix, { kind: 'command', command: 'brew install gh' })
  assert.deepEqual(brewed.node!.fix, { kind: 'command', command: 'brew install node' })
  assert.deepEqual(brewed.qmd!.fix, { kind: 'command', command: 'npm install -g --ignore-scripts @tobilu/qmd@2.9.0' })
})

test("on a host that installs, git, gh, Claude Code and qmd are each a press that names what it installs and from where, with the line to copy kept for a failure", async () => {
  const presses = { install: () => true, signIn: () => true }
  const notInstalled = (await review({
    presses,
    programs: { git: null, gh: null, qmd: null, brew: null },
    claude: async () => ({ settings: { enabled: true }, status: claudeStatus({ installed: false }) }),
  })).needs

  const press = (need: SetupNeed) => {
    assert.ok(need.fix?.kind === 'install-program' || need.fix?.kind === 'sign-in-program', `${need.id} is a press`)
    return need.fix
  }
  const git = press(notInstalled.git!)
  assert.deepEqual([git.name, git.byHand], ['git', 'xcode-select --install'])
  assert.match(git.says, /Apple's Command Line Tools/)
  assert.match(git.says, /not the Xcode app/i)

  const gh = press(notInstalled.gh!)
  assert.deepEqual([gh.name, gh.byHand], ['gh', 'https://cli.github.com'])
  assert.match(gh.says, /GitHub/)
  assert.match(gh.says, /2\.105\.0/)

  const claude = press(notInstalled.claude!)
  assert.deepEqual([claude.name, claude.byHand], ['claude', 'curl -fsSL https://claude.ai/install.sh | bash'])
  assert.match(claude.says, /Anthropic/)

  const qmd = press(notInstalled.qmd!)
  assert.deepEqual([qmd.name, qmd.byHand], ['qmd', 'npm install -g --ignore-scripts @tobilu/qmd@2.9.0'])
  assert.match(qmd.says, /npm/)
  assert.match(qmd.says, /2\.9\.0/)

  // Installed and signed out: gh and Claude Code sign in on a press.
  const signedOut = (await review({
    presses,
    prints: { '/opt/homebrew/bin/gh auth status': failed(1) },
    claude: async () => ({ settings: { enabled: true }, status: claudeStatus({ signedIn: false }) }),
  })).needs
  const ghIn = press(signedOut.gh!)
  assert.deepEqual([ghIn.kind, ghIn.name, ghIn.byHand], ['sign-in-program', 'gh', 'gh auth login'])
  assert.match(ghIn.says, /one-time code/)
  assert.match(ghIn.says, /sets git to use that sign-in/)
  const claudeIn = press(signedOut.claude!)
  assert.deepEqual([claudeIn.kind, claudeIn.name, claudeIn.byHand], ['sign-in-program', 'claude', 'claude auth login'])

  // With no npm yet, qmd waits on hobkin's own Node, as Pi does.
  const noNpm = (await review({ presses, pi: async () => pi({ canInstall: false }), programs: { qmd: null, npm: null } })).needs
  assert.deepEqual(noNpm.qmd!.fix, { kind: 'install', what: 'node' })

  // A host that cannot run the press keeps the line to copy.
  const scripted = (await review({ presses: { install: () => false, signIn: () => false }, programs: { git: null, gh: null, brew: null } })).needs
  assert.deepEqual(scripted.git!.fix, { kind: 'command', command: 'xcode-select --install' })
  assert.deepEqual(scripted.gh!.fix, { kind: 'command', command: 'https://cli.github.com' })
})

test('Node older than Pi needs, and Claude Code only while its agents are on', async () => {
  const oldNode = pi({ node: { found: true, version: '22.9.0', installs: '22.19.0' } })
  const node = (await review({ pi: async () => oldNode })).needs.node!
  assert.equal(node.found, false)
  assert.equal(node.version, '22.9.0')
  assert.match(node.problem ?? '', /22\.19/)

  const claudeOff = await review({ claude: async () => ({ settings: { enabled: false }, status: claudeStatus({ installed: false }) }) })
  assert.equal(claudeOff.needs.claude, undefined)
})

test('a read that fails or takes too long is said on its row, and the rest still answer', async () => {
  const { options } = mac({
    pi: () => new Promise<PiSetup>(() => {}),
    models: async () => {
      throw Error('Pi is not there')
    },
    timeoutMs: 20,
  })

  const { needs } = await setupNeedsHandlers(options)['setup.needs']!({})

  const byId = Object.fromEntries(needs.map((need) => [need.id, need]))
  for (const id of ['pi', 'node', 'sign-in']) assert.equal(byId[id]!.found, false, id)
  assert.equal(byId.git!.found, true)
  assert.equal(byId.qmd!.found, true)
})
