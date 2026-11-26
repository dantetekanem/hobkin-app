import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ClaudeCodeStatus } from '../../shared/protocol/claude-code.ts'
import type { PiSetup, SetupNeed } from '../../shared/protocol/setup.ts'
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
    programs: { 'agentic-search': null, qmd: null },
  })

  const gaps = Object.values(needs).filter((need) => !['git', 'gh'].includes(need.id))
  assert.ok(gaps.every((need) => !need.found && need.problem && need.fix))
  assert.deepEqual(needs.node!.fix, { kind: 'install', what: 'node' })
  // No npm yet: Pi's line to run once Node is here, and the package through Pi once Pi is.
  assert.deepEqual(needs.pi!.fix, { kind: 'command', command: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0' })
  assert.deepEqual(needs['package:pi-coder']!.fix, { kind: 'command', command: 'pi install npm:pi-coder' })
  assert.deepEqual(needs['sign-in']!.fix, { kind: 'sign-in' })
  assert.deepEqual(needs.tla!.fix, { kind: 'install', what: 'proof-tools' })
  assert.deepEqual(needs['agentic-search']!.fix, { kind: 'command', command: 'npm install -g pi-agentic-search' })
  assert.deepEqual(needs.claude!.fix, { kind: 'command', command: 'claude auth login' })
  assert.deepEqual(needs.qmd!.fix, { kind: 'command', command: 'npm install -g @tobilu/qmd' })

  // With npm the window installs Pi, and with Pi the package.
  const oldPi = pi({ version: '0.9.0', matches: false, packages: [{ name: 'pi-coder', adds: '', installed: false }] })
  const installs = (await review({ pi: async () => oldPi })).needs
  assert.deepEqual(installs.pi!.fix, { kind: 'install', what: 'pi' })
  assert.equal(installs.pi!.version, '0.9.0')
  assert.deepEqual(installs['package:pi-coder']!.fix, { kind: 'install-package', name: 'pi-coder' })
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
