import assert from 'node:assert/strict'
import { delimiter } from 'node:path'
import { test } from 'node:test'
import { askLoginShell, markedPath, realShellRun, refreshPath, withFolders, type ShellRun } from '../src/pi/login-path.ts'

const CARRIED = '/App.invalid/Contents/Resources/node/bin'
const joined = (...folders: string[]) => folders.join(delimiter)

/** Answers as a login shell would, and writes down how it was asked. No shell is ever started. */
const fakeShell = (printed: string | Promise<string>, asked: { shell: string; args: string[]; timeout: number }[] = []): ShellRun => (shell, args, timeout) => {
  asked.push({ shell, args: [...args], timeout })
  return Promise.resolve(printed)
}

test('the PATH is read between the markers, whatever the rc files print around them', () => {
  const noisy = 'Welcome back\n\x1b[32mnvm ready\x1b[0m\n<hobkin-path>/opt/homebrew/bin:/usr/bin</hobkin-path>Last login: today\n'
  assert.equal(markedPath(noisy), '/opt/homebrew/bin:/usr/bin')
  assert.equal(markedPath('<hobkin-path>/usr/bin</hobkin-path>'), '/usr/bin')
  for (const output of ['', 'zsh: command not found: printf\n', '<hobkin-path>/usr/bin', '/usr/bin</hobkin-path>', '<hobkin-path></hobkin-path>']) {
    assert.equal(markedPath(output), null, JSON.stringify(output))
  }
})

test('folders are added after the ones there, each once, in their order, and the carried Node stays last', () => {
  const path = joined('/opt/homebrew/bin', '/usr/bin', CARRIED)
  assert.equal(
    withFolders(path, ['/Users/someone/.nvm/versions/node/v22.19.0/bin', '/usr/bin', '', CARRIED, '/Users/someone/.volta/bin', '/Users/someone/.volta/bin'], CARRIED),
    joined('/opt/homebrew/bin', '/usr/bin', '/Users/someone/.nvm/versions/node/v22.19.0/bin', '/Users/someone/.volta/bin', CARRIED),
  )
  // A host started from a terminal runs on the user's own Node, which keeps its place: nothing already there moves.
  assert.equal(withFolders(joined('/opt/homebrew/bin', '/usr/bin'), ['/Users/someone/.fnm/bin'], '/opt/homebrew/bin'), joined('/opt/homebrew/bin', '/usr/bin', '/Users/someone/.fnm/bin'))
  assert.equal(withFolders('', ['/usr/local/bin'], CARRIED), '/usr/local/bin')
})

test('the login shell is asked as a terminal asks it: interactive and login, printing the PATH between markers', async () => {
  const asked: { shell: string; args: string[]; timeout: number }[] = []
  const found = await askLoginShell({ shell: '/bin/zsh', run: fakeShell('motd\n<hobkin-path>/a:/b</hobkin-path>', asked) })

  assert.equal(found, '/a:/b')
  assert.equal(asked.length, 1)
  assert.equal(asked[0]!.shell, '/bin/zsh')
  assert.equal(asked[0]!.args[0], '-ilc')
  assert.equal(asked[0]!.args[1], `printf '%s%s%s' '<hobkin-path>' "$PATH" '</hobkin-path>'`)
  assert.ok(asked[0]!.timeout > 0 && asked[0]!.timeout <= 10_000, 'a time limit of a few seconds')
})

test('a shell that gives no PATH, fails, or never answers in time is no answer', async () => {
  assert.equal(await askLoginShell({ shell: '/bin/zsh', run: fakeShell('zsh: bad option\n') }), null)
  assert.equal(await askLoginShell({ shell: '/bin/zsh', run: () => Promise.reject(Error('spawn ENOENT')) }), null)

  const started = Date.now()
  assert.equal(await askLoginShell({ shell: '/bin/zsh', run: () => new Promise<string>(() => {}), timeoutMs: 50 }), null)
  assert.ok(Date.now() - started < 2000, 'it stops waiting at its own time limit')
})

test('the shell named by SHELL is asked, and zsh when none is named', async () => {
  const asked: { shell: string; args: string[]; timeout: number }[] = []
  await refreshPath({ env: { SHELL: '/opt/homebrew/bin/fish', PATH: '/usr/bin' }, run: fakeShell('', asked), last: CARRIED })
  await refreshPath({ env: { SHELL: '', PATH: '/usr/bin' }, run: fakeShell('', asked), last: CARRIED })
  assert.deepEqual(asked.map(({ shell }) => shell), ['/opt/homebrew/bin/fish', '/bin/zsh'])
})

test("a refresh adds the folders the host's PATH lacks, and says whether it added any", async () => {
  const env: NodeJS.ProcessEnv = { PATH: joined('/usr/bin', CARRIED) }
  const shell = fakeShell(`<hobkin-path>${joined('/Users/someone/.nvm/bin', '/usr/bin')}</hobkin-path>`)

  assert.equal(await refreshPath({ env, run: shell, last: CARRIED }), true)
  assert.equal(env.PATH, joined('/usr/bin', '/Users/someone/.nvm/bin', CARRIED))
  // Asked again, the shell has nothing new, and the PATH is left as it is.
  assert.equal(await refreshPath({ env, run: shell, last: CARRIED }), false)
  assert.equal(env.PATH, joined('/usr/bin', '/Users/someone/.nvm/bin', CARRIED))

  const quiet: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
  assert.equal(await refreshPath({ env: quiet, run: fakeShell('nothing here'), last: CARRIED }), false)
  assert.equal(quiet.PATH, '/usr/bin')
})

// The real runner, on a stand-in for a shell: this Node, printing what a shell might. No login shell is ever started.
const node = (script: string) => ['-e', script]

test('the real runner answers as soon as the PATH is printed, even while what the shell started keeps running', async () => {
  const started = Date.now()
  const printed = await realShellRun(process.execPath, node("process.stdout.write('noise\\n<hobkin-path>/a:/b</hobkin-path>'); setInterval(() => {}, 1000)"), 5000)
  assert.equal(markedPath(printed), '/a:/b')
  assert.ok(Date.now() - started < 4000, 'it did not wait for the time limit')
})

test('the real runner stops a shell that is still busy at its time limit, and answers with what it printed', async () => {
  const printed = await realShellRun(process.execPath, node("process.stdout.write('still loading'); setInterval(() => {}, 1000)"), 300)
  assert.equal(printed, 'still loading')
  assert.equal(await realShellRun('/nonexistent.invalid/shell', ['-ilc', 'true'], 300), '')
})
