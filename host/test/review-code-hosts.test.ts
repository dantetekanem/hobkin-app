import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { githubApi, namedApi, readCodeHosts } from '../src/review/code-hosts.ts'
import { temporaryDirectory } from './support.ts'

const HOST = { name: 'corp', web: 'https://git.example.invalid/', api: ['corp-api', '--repo', '{owner}/{repo}'], git: 'https://git.example.invalid/{owner}/{repo}.git' }

/** A home whose client folder holds this code host file. */
function home(t: Parameters<typeof temporaryDirectory>[0], file: unknown) {
  const root = temporaryDirectory(t)
  mkdirSync(join(root, 'client'), { recursive: true })
  writeFileSync(join(root, 'client', 'code-hosts.json'), typeof file === 'string' ? file : JSON.stringify(file))
  return root
}

test('the code host file names each host with its defaults, and the user’s addresses and the agents that open pull requests for someone', (t) => {
  assert.deepEqual(readCodeHosts(temporaryDirectory(t)), { hosts: [], emails: [], agents: [] }, 'a home with no file names none')
  const read = readCodeHosts(home(t, { emails: ['Me@Example.invalid'], agents: [{ host: 'corp', login: 'helper-bot', name: 'Helper' }], hosts: [{ ...HOST, clones: { 'acme/shop': '/clones/shop.git' }, checkout: false }] }))
  assert.deepEqual(read, {
    emails: ['me@example.invalid'],
    agents: [{ host: 'corp', login: 'helper-bot', name: 'Helper' }],
    hosts: [{ ...HOST, web: 'https://git.example.invalid', headRef: 'refs/pull/{number}/head', clones: { 'acme/shop': '/clones/shop.git' }, checkout: false, merge: false }],
  })
})

test("a code host can name a review tree of its own: where it is, how it is made and fitted, the disk a new one needs, and settings for its commands", (t) => {
  const tree = { path: '/trees/shop', make: ['corp-tree', 'new', '--from', '{base}'], makeIn: '/trees', fit: ['corp-fit', '{base}'], env: { GIT_LFS_SKIP_SMUDGE: '1' } }
  const [host] = readCodeHosts(home(t, { hosts: [{ ...HOST, tree }] })).hosts
  assert.deepEqual(host!.tree, { ...tree, leastFreeGb: 20 }, '20 GB free unless the file names its own')
  const refused = (bad: Record<string, unknown>, why: RegExp) => assert.throws(() => readCodeHosts(home(t, { hosts: [{ ...HOST, tree: { ...tree, ...bad } }] })), why)
  refused({ path: 'trees/shop' }, /tree/)
  refused({ make: [] }, /tree/)
  refused({ makeIn: 'relative' }, /tree/)
  refused({ fit: ['-x'] }, /tree/)
  refused({ leastFreeGb: -1 }, /tree/)
  refused({ env: { GITHUB_TOKEN: 'x' } }, /tree/)
  refused({ other: true }, /tree/)
})

test('a host where hobkin may merge can say which comment asks for a merge there and what the host does next; one that may not merge cannot', (t) => {
  const mergeBy = { comment: '/merge', after: 'The merge queue lands it once its checks pass.' }
  assert.deepEqual(readCodeHosts(home(t, { hosts: [{ ...HOST, merge: true, mergeBy }] })).hosts[0]!.mergeBy, mergeBy)
  assert.throws(() => readCodeHosts(home(t, { hosts: [{ ...HOST, mergeBy }] })), /mergeBy.*merge/)
  assert.throws(() => readCodeHosts(home(t, { hosts: [{ ...HOST, merge: true, mergeBy: { comment: '' } }] })), /mergeBy/)
})

test('a code host file that cannot be trusted is refused with a plain reason', (t) => {
  const refused = (file: unknown, why: RegExp) => assert.throws(() => readCodeHosts(home(t, file)), why)
  refused('{ not json', /code host file .* cannot be read/)
  refused({ hosts: [{ ...HOST, name: 'github' }] }, /name/)
  refused({ hosts: [HOST, HOST] }, /twice/)
  refused({ hosts: [{ ...HOST, web: 'http://git.example.invalid' }] }, /web/)
  refused({ hosts: [{ ...HOST, api: ['-x'] }] }, /api/)
  refused({ hosts: [{ ...HOST, git: 'https://git.example.invalid/shop.git' }] }, /git/)
  refused({ hosts: [{ ...HOST, headRef: 'pull/{number}' }] }, /headRef/)
  refused({ hosts: [{ ...HOST, clones: { 'acme/shop': 'relative/path' } }] }, /clones/)
  refused({ hosts: [{ ...HOST, checkout: 'yes' }] }, /checkout/)
  refused({ hosts: [HOST], emails: ['not an address'] }, /emails/)
  refused({ hosts: [HOST], agents: [{ host: 'elsewhere', login: 'bot' }] }, /agents/)
  refused({ hosts: [{ ...HOST, unknown: true }] }, /unknown/)
})

test('GitHub is asked through gh as before, and a named host through its own command, with a body on standard input and errors that show no credential', async (t) => {
  const calls: { args: readonly string[]; input?: string }[] = []
  const github = githubApi(async (args, input) => {
    calls.push({ args, input })
    return { kind: 'done', stdout: '{"ok":true}' }
  })
  await github({ path: 'repos/acme/shop/pulls/1' })
  await github({ method: 'POST', path: 'repos/acme/shop/pulls/1/reviews', body: { event: 'COMMENT' } })
  assert.deepEqual(calls, [
    { args: ['api', '--hostname', 'github.com', 'repos/acme/shop/pulls/1'], input: undefined },
    { args: ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/shop/pulls/1/reviews', '--input', '-'], input: '{"event":"COMMENT"}' },
  ])

  // A stand-in for the host's command: it writes down its arguments and what came on standard input.
  const folder = temporaryDirectory(t)
  const program = join(folder, 'corp-api')
  writeFileSync(program, `#!${process.execPath}\nconst fs = require('node:fs')\nconst input = fs.readFileSync(0, 'utf8')\nfs.writeFileSync(${JSON.stringify(join(folder, 'seen.json'))}, JSON.stringify({ args: process.argv.slice(2), input }))\nif (process.argv.includes('repos/acme/shop/pulls/9')) { process.stderr.write('HTTP 401: bad token ghp_abcdef1234567890abcdef1234567890abcd\\n'); process.exit(1) }\nprocess.stdout.write('{"number":1}')\n`)
  chmodSync(program, 0o755)
  const corp = namedApi({ ...HOST, api: [program, '--repo', '{owner}/{repo}'], headRef: 'refs/pull/{number}/head', clones: {}, checkout: true, merge: false }, { owner: 'acme', repo: 'shop' })
  assert.equal(await corp({ method: 'POST', path: 'repos/acme/shop/pulls/1/reviews', body: { event: 'COMMENT' } }), '{"number":1}')
  assert.deepEqual(JSON.parse(readFileSync(join(folder, 'seen.json'), 'utf8')), { args: ['--repo', 'acme/shop', '--method', 'POST', 'repos/acme/shop/pulls/1/reviews', '--input', '-'], input: '{"event":"COMMENT"}' })
  await assert.rejects(corp({ path: 'repos/acme/shop/pulls/9' }), (error: Error) => /^corp said: HTTP 401: bad token \[hidden\]$/.test(error.message))
})
