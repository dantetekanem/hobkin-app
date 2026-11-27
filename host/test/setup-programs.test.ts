import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { delimiter } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import type { SignInProgram } from '../../shared/protocol/setup.ts'
import { Unavailable } from '../src/commands.ts'
import type { PiRun } from '../src/pi/install.ts'
import type { NodeFetch } from '../src/pi/node.ts'
import { CLAUDE_INSTALLER, installClaude, installCommandLineTools, installQmd, programSetup, QMD_VERSION } from '../src/setup/programs.ts'
import { ProgramSignIns, signInPage, type SignInChild, type SignInSpawn } from '../src/setup/sign-in.ts'
import { afterTest, Client, hostFor } from './support.ts'

interface Ran { file: string; args: string[]; env: NodeJS.ProcessEnv; script?: string }

/** Stands in for running a program: it writes down what ran, and fails as `fail` says. Nothing runs. */
function fakeRun(calls: Ran[], fail?: { stderr: string }): PiRun {
  return (file, args, options, done) => {
    // The installer script is read while it is there: it is gone once the install ends.
    const script = file === '/bin/bash' ? readFileSync(args[0]!, 'utf8') : undefined
    calls.push({ file, args: [...args], env: options.env, ...(script ? { script } : {}) })
    if (fail) return done(Object.assign(Error('Command failed'), { code: 1 }), '', fail.stderr)
    done(null, '', '')
  }
}

const serve = (files: Record<string, string | number>): NodeFetch => async (url) => {
  const served = files[url]
  if (typeof served === 'number' || served === undefined) return new Response('Not Found', { status: typeof served === 'number' ? served : 404 })
  return new Response(served)
}

async function failureOf(work: Promise<unknown>): Promise<Error> {
  const error = await work.then(() => null, (thrown: unknown) => thrown as Error)
  assert.ok(error instanceof Error, 'it failed')
  return error
}

test("git: the press asks the Mac for Apple's own installer of its command line tools, which finishes in its own window", async () => {
  const calls: Ran[] = []
  assert.deepEqual(await installCommandLineTools({ run: fakeRun(calls) }), { finished: false })
  assert.deepEqual(calls.map(({ file, args }) => [file, ...args]), [['/usr/bin/xcode-select', '--install']])

  const refused = await failureOf(installCommandLineTools({ run: fakeRun([], { stderr: 'xcode-select: error: command line tools are already installed\n' }) }))
  assert.match(refused.message, /^Apple's installer for the command line tools did not open\./)
  assert.match(refused.message, /already installed/)
})

test("Claude Code: Anthropic's own installer is downloaded and run by bash, and an answer that is not it runs nothing", async () => {
  const calls: Ran[] = []
  const script = '#!/bin/bash\necho installing\n'
  const env = { PATH: '/usr/bin:/bin', HOME: '/home.invalid' }

  assert.deepEqual(await installClaude({ fetch: serve({ [CLAUDE_INSTALLER]: script }), run: fakeRun(calls), env }), { finished: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.file, '/bin/bash')
  assert.equal(calls[0]!.script, script, "the script claude.ai served, whole")
  assert.equal(calls[0]!.env, env, "with the host's own HOME, so it installs into ~/.local/bin")

  const page = await failureOf(installClaude({ fetch: serve({ [CLAUDE_INSTALLER]: '<html>Sorry</html>' }), run: fakeRun(calls), env }))
  assert.match(page.message, /did not answer with Claude Code's installer/)
  const down = await failureOf(installClaude({ fetch: serve({ [CLAUDE_INSTALLER]: 503 }), run: fakeRun(calls), env }))
  assert.match(down.message, /claude\.ai answered 503/)
  assert.equal(calls.length, 1, 'nothing else ran')

  const failed = await failureOf(installClaude({ fetch: serve({ [CLAUDE_INSTALLER]: script }), run: fakeRun([], { stderr: 'Checksum verification failed\n' }), env }))
  assert.match(failed.message, /^Anthropic's installer could not install Claude Code\.\nChecksum verification failed$/)
})

test('qmd: npm installs the qmd hobkin was tried with, its scripts off, with the Node beside npm first on the PATH', async () => {
  const calls: Ran[] = []
  const npm = '/home.invalid/.hobkin/client/node/bin/npm'

  assert.deepEqual(await installQmd({ findNpm: () => npm, run: fakeRun(calls) }), { finished: true })
  assert.deepEqual(calls.map(({ file, args }) => [file, ...args]), [[npm, 'install', '-g', '--ignore-scripts', `@tobilu/qmd@${QMD_VERSION}`]])
  assert.equal(calls[0]!.env.PATH?.split(delimiter)[0], '/home.invalid/.hobkin/client/node/bin')

  const none = await failureOf(installQmd({ findNpm: () => null, run: fakeRun(calls) }))
  assert.ok(none instanceof Unavailable)
  const failed = await failureOf(installQmd({ findNpm: () => npm, run: fakeRun([], { stderr: 'npm error code ENOTFOUND\n' }) }))
  assert.match(failed.message, /^npm could not install qmd\.\nnpm error code ENOTFOUND$/)
})

test('only a live host handed an install offers it and runs it, and a scripted one changes nothing', async () => {
  const ran: string[] = []
  const installers = { gh: async () => (ran.push('gh'), { finished: true }), git: async () => (ran.push('git'), { finished: false }) }

  const live = programSetup({ live: true, installers, installable: (name) => name !== 'git' })
  assert.deepEqual(['git', 'gh', 'claude', 'qmd'].map((name) => live.offers.install(name as never)), [false, true, false, false])
  assert.deepEqual(await live.handlers['setup.install-program']!({ name: 'gh' }), { finished: true })
  assert.ok((await failureOf(Promise.resolve().then(() => live.handlers['setup.install-program']!({ name: 'git' })))) instanceof Unavailable, 'not on this Mac')
  assert.ok((await failureOf(Promise.resolve().then(() => live.handlers['setup.install-program']!({ name: 'qmd' })))) instanceof Unavailable, 'not handed one')
  assert.equal(live.offers.signIn('gh'), false, 'no sign-ins handed in')

  const scripted = programSetup({ live: false, installers })
  assert.equal(scripted.offers.install('gh'), false)
  const refused = await failureOf(Promise.resolve().then(() => scripted.handlers['setup.install-program']!({ name: 'gh' })))
  assert.match(refused.message, /scripted development host/)
  assert.deepEqual(ran, ['gh'])
})

/** A program's sign-in as a test plays it: what it prints, how it ends, and what was typed into it. */
class FakeChild extends EventEmitter implements SignInChild {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  typed: string[] = []
  killed = false
  constructor() {
    super()
    this.stdin.on('data', (chunk) => this.typed.push(String(chunk)))
  }
  kill(): boolean {
    this.killed = true
    setImmediate(() => this.emit('exit', null))
    return true
  }
  end(code: number) {
    this.emit('exit', code)
  }
}

function signIns(find: (name: SignInProgram) => string | null = (name) => `/bin.invalid/${name}`, timing: { promptMs?: number; signInMs?: number } = {}) {
  const started: { file: string; args: string[]; env: NodeJS.ProcessEnv; child: FakeChild }[] = []
  const spawn: SignInSpawn = (file, args, env) => {
    const child = new FakeChild()
    started.push({ file, args: [...args], env, child })
    return child
  }
  return { started, signIns: new ProgramSignIns({ find, spawn, env: () => ({ PATH: '/usr/bin', HOME: '/home.invalid' }), ...timing }) }
}

const settled = () => new Promise((resolve) => setImmediate(resolve))

test("gh: its web sign-in runs without a terminal, and the window gets GitHub's page and the one-time code", async () => {
  const { started, signIns: all } = signIns()
  const prompt = all.start('gh')
  await settled()

  const [{ file, args, env, child }] = started as [(typeof started)[number]]
  assert.equal(file, '/bin.invalid/gh')
  assert.deepEqual(args, ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https'])
  assert.equal(env.GH_PROMPT_DISABLED, '1')
  assert.equal(env.HOME, '/home.invalid')

  // gh's own words without a terminal (cli/cli internal/authflow/flow.go), on stderr.
  child.stderr.write('\n! First copy your one-time code: AB12-CD34\n')
  child.stderr.write('Open this URL to continue in your web browser: https://github.com/login/device\n')
  assert.deepEqual(await prompt, { name: 'gh', url: 'https://github.com/login/device', code: 'AB12-CD34', pastes: false })

  const ended = all.wait('gh')
  child.stderr.write('✓ Authentication complete.\n- gh config set -h github.com git_protocol https\n✓ Logged in as someone\n')
  child.end(0)
  assert.deepEqual(await ended, { signedIn: true, message: null })
  assert.deepEqual(await all.wait('gh'), { signedIn: false, message: null }, 'none under way any more')
})

test("Claude Code: the window gets the page it prints for a browser that did not open, and the code pasted from it goes to Claude Code", async () => {
  const { started, signIns: all } = signIns()
  const prompt = all.start('claude')
  await settled()
  const { args, child } = started[0]!
  assert.deepEqual(args, ['auth', 'login', '--claudeai'])

  // What `claude auth login` prints without a terminal (Claude Code 2.1.332), its page in a terminal link.
  const page = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=abc'
  child.stdout.write("Opening browser to sign in…\nIf the browser didn't open, visit:\n")
  child.stdout.write(`\x1b]8;;${page}\x07${page}\x1b]8;;\x07\nPaste code here if prompted > `)
  assert.deepEqual(await prompt, { name: 'claude', url: page, code: null, pastes: true })

  assert.throws(() => all.paste('claude', 'two\nlines'), Unavailable)
  all.paste('claude', '  abc123#def456  ')
  assert.deepEqual(child.typed, ['abc123#def456\n'])
  assert.throws(() => all.paste('gh', 'abc'), Unavailable, 'gh takes no code, and none is under way')

  const ended = all.wait('claude')
  child.stdout.write('Login successful.\n')
  child.end(0)
  assert.deepEqual(await ended, { signedIn: true, message: null })
})

test('a sign-in that ends, sends the user elsewhere or says nothing in time is refused with its own last words', async () => {
  // It ends before it says what to do.
  const early = signIns()
  const failed = early.signIns.start('gh')
  await settled()
  early.started[0]!.child.stderr.write('error connecting to api.github.com\n')
  early.started[0]!.child.end(1)
  const error = await failureOf(failed)
  assert.match(error.message, /^gh did not sign in\.\nerror connecting to api\.github\.com$/)
  assert.deepEqual(await early.signIns.wait('gh'), { signedIn: false, message: null })

  // A page off GitHub is not one the window opens.
  assert.equal(signInPage('Open this URL to continue in your web browser: https://github.com.evil.invalid/login', ['github.com']), null)
  assert.equal(signInPage('visit http://github.com/login/device', ['github.com']), null)
  assert.equal(signInPage('visit https://gist.github.com/x', ['github.com']), 'https://gist.github.com/x')

  // Silent for too long: stopped.
  const silent = signIns(undefined, { promptMs: 10 })
  const quiet = await failureOf(silent.signIns.start('claude'))
  assert.match(quiet.message, /did not say how to sign in/)
  assert.equal(silent.started[0]!.child.killed, true)

  // Not installed: nothing starts.
  const absent = signIns(() => null)
  assert.ok((await failureOf(absent.signIns.start('gh'))) instanceof Unavailable)
  assert.deepEqual(absent.started, [])
})

test('starting a sign-in again stops the one before, and the user who never finishes is stopped after a while', async () => {
  const { started, signIns: all } = signIns(undefined, { signInMs: 30 })
  void all.start('gh').catch(() => {})
  await settled()
  const again = all.start('gh')
  await settled()
  assert.equal(started[0]!.child.killed, true)

  started[1]!.child.stderr.write('! First copy your one-time code: WXYZ-1234\nOpen this URL to continue in your web browser: https://github.com/login/device\n')
  assert.equal((await again).code, 'WXYZ-1234')
  const end = await all.wait('gh')
  assert.equal(end.signedIn, false)
  assert.match(end.message ?? '', /waited 0 minutes for you, so it was stopped/)
  assert.doesNotMatch(end.message ?? '', /WXYZ-1234/, 'the spent code is not repeated')
})

test("through the host: a scripted host offers no press and refuses every one, and hobkin's own client tool cannot run them", async (t) => {
  const ran: string[] = []
  const host = await hostFor(t, { installPrograms: { gh: async () => (ran.push('gh'), { finished: true }) } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const commands = [
    ['setup.install-program', { name: 'gh' }],
    ['setup.sign-in-program', { name: 'gh' }],
    ['setup.sign-in-program-code', { name: 'claude', code: 'abc' }],
    ['setup.sign-in-program-wait', { name: 'gh' }],
  ] as const
  for (const [name, args] of commands) {
    const refused = await client.command(name, args)
    assert.equal(!refused.ok && refused.error.code, 'unavailable', name)
    assert.match(!refused.ok ? refused.error.message : '', /scripted development host/, `${name} is the host's own refusal`)
  }
  assert.deepEqual(ran, [], 'nothing was installed')
  // Only the four programs reach the host at all.
  const unknown = await client.command('setup.install-program', { name: 'brew' } as never)
  assert.equal(!unknown.ok && unknown.error.code, 'invalid-arguments')

  const { COMMANDS } = await import('#shared/commands/registry.ts')
  for (const [name] of commands) assert.equal(COMMANDS[name].outside, true, name)
})
