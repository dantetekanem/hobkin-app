import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import type { GitHubState } from '../protocol.ts'
import { APP_ORIGIN } from '#host/access.ts'
import { afterTest, Client, hostFor, runHostProcess, temporaryDirectory } from '../../../host/test/support.ts'
import { sampleGitHubSource } from '../host/sample.ts'

/** The GitHub slice a window holds after the messages received so far. */
function gitHubOf(client: Client): GitHubState | null {
  let github: GitHubState | null = null
  for (const message of client.received) if (message.type === 'state' && message.slices?.github) github = message.slices.github as GitHubState
  return github
}

test('a host finds the GitHub folder, sends its state as slices.github, and answers github.refresh with it', { timeout: 30000 }, async (t) => {
  const host = await hostFor(t, { integrationOptions: { github: { source: sampleGitHubSource({ delayMs: 0 }) } } })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  await client.until(() => gitHubOf(client)?.connection === 'connected', 'the sample GitHub data')
  assert.equal(client.received.some((message) => message.type === 'state' && message.reset && message.slices?.github), true, 'with the reset')
  assert.equal(client.received.some((message) => message.type === 'state' && 'github' in message), false, 'the core has no github key')
  const refreshed = await client.run<GitHubState>('github.refresh')
  assert.equal(refreshed.sample, true)
  assert.equal(refreshed.login, 'sample-user')
  assert.ok(refreshed.reviews.length > 0)
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
