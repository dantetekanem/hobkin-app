import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { GITHUB_UNKNOWN, sampleGitHub, type GitHubState } from '#shared/protocol/github.ts'
import { APP_ORIGIN } from '../src/access.ts'
import { sampleGitHubSource } from '../src/github-sample.ts'
import { StateSync } from '../src/state-sync.ts'
import { afterTest, Client, hostFor, runHostProcess, temporaryDirectory } from './support.ts'

/** The GitHub slice a UI holds after the messages received so far. */
function gitHubOf(client: Client): GitHubState | null {
  let github: GitHubState | null = null
  for (const message of client.received) if (message.type === 'state' && message.github) github = message.github
  return github
}

test('the GitHub slice travels whole, only when some of it changed', () => {
  const owner = { state: 'opening' } as const
  const signIn = { status: 'signed-in' } as const
  const sync = new StateSync({ owner, signIn, models: null, github: GITHUB_UNKNOWN })
  assert.deepEqual(sync.full().github, GITHUB_UNKNOWN, 'a UI that connects gets it at once')

  const github = sampleGitHub(Date.parse('2026-11-10T09:00:00Z'))
  assert.deepEqual(sync.update({ owner, signIn, models: null, github, snapshot: null })?.github, github)
  assert.equal(sync.update({ owner, signIn, models: null, github: structuredClone(github), snapshot: null }), null, 'nothing changed, nothing sent')

  // A new owner starts the UI over, so the slice comes again with it.
  const live = { state: 'live', limits: { images: 4, imageBytes: 1024 } } as const
  const reset = sync.update({ owner: live, signIn, models: null, github, snapshot: null })
  assert.equal(reset?.reset, true)
  assert.deepEqual(reset?.github, github)

  // A host that does not read GitHub sends no slice at all.
  assert.equal('github' in new StateSync({ owner, signIn, models: null }).full(), false)
})

test('a refresh answers with the slice, and only pages on github.com open', { timeout: 30000 }, async (t) => {
  const opened: string[] = []
  const host = await hostFor(t, { github: sampleGitHubSource({ delayMs: 0 }), openGitHub: (url) => opened.push(url) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const github = await client.until(() => gitHubOf(client)?.connection === 'connected', 'the sample GitHub data')
  assert.ok(github)
  const refreshed = await client.run<GitHubState>('github.refresh')
  assert.equal(refreshed.sample, true)
  assert.equal(refreshed.login, 'sample-user')
  assert.ok(refreshed.reviews.length > 0)

  const page = refreshed.pulls[0]!.url
  assert.deepEqual(await client.run('github.open', { url: page }), { ok: true })
  assert.deepEqual(opened, [page])
  for (const url of ['https://github.com.example.net/x', 'http://github.com/octo/app', 'https://example.com/https://github.com/', 'file:///etc/hosts']) {
    const refused = await client.command('github.open', { url })
    assert.equal(!refused.ok && refused.error.code, 'invalid-arguments', url)
  }
  assert.deepEqual(opened, [page], 'nothing else was opened')
})

test('the scripted host shows sample GitHub data, and gh runs only with --github', { timeout: 30000 }, async (t) => {
  const base = temporaryDirectory(t)
  const userHome = join(base, 'user')
  const bin = join(base, 'bin')
  mkdirSync(userHome)
  mkdirSync(bin)
  // A stand-in for gh that writes down what it was asked and answers for an account called octocat.
  const ran = join(base, 'gh-ran.txt')
  const answer = join(base, 'answer.json')
  const empty = { issueCount: 0, nodes: [] }
  writeFileSync(answer, JSON.stringify({ data: { viewer: { login: 'octocat' }, reviews: empty, pulls: empty, assigned: empty, authored: empty } }))
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${ran}'\ncat '${answer}'\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  const env = { HOME: userHome, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` }

  const start = async (name: string, args: string[]) => {
    const home = join(base, name)
    const host = await runHostProcess(t, ['--home', home, ...args], env)
    const client = await Client.connect(host.address(home), { origin: APP_ORIGIN })
    afterTest(t, () => client.close())
    return client
  }

  const scripted = await start('scripted', [])
  await scripted.until(() => gitHubOf(scripted)?.connection === 'connected', 'sample GitHub data')
  assert.equal(gitHubOf(scripted)?.sample, true)
  assert.equal((await scripted.run<GitHubState>('github.refresh')).login, 'sample-user')
  assert.equal(existsSync(ran), false, 'gh never ran')

  const real = await start('real', ['--github'])
  await real.until(() => gitHubOf(real)?.login === 'octocat', 'GitHub read through gh')
  assert.equal(gitHubOf(real)?.sample, false)
  const asked = readFileSync(ran, 'utf8')
  assert.match(asked, /^api\ngraphql\n--hostname\ngithub\.com\n-f\nquery=query HobkinGitHub \{/)
  assert.doesNotMatch(asked, /^(auth|token)$/m)
})
