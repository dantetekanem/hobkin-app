/**
 * The code hosts a home names besides GitHub, in the code host file of its client folder (`client/code-hosts.json`),
 * with the user's own email addresses and the agents that open pull requests for someone. The file is read each time
 * it is needed, so an edit counts at once. Company values live only there, never in this repository.
 *
 * Each host gives: its web address; the command that answers GitHub's REST paths for it, run with no shell, with
 * `{owner}` and `{repo}` filled in; the git address of a repository; the ref that holds a pull request's head, by
 * `{number}` or by `{branch}`; the user's own clones to read, by `owner/repo` (a bare clone counts); whether a review
 * may check a repository out; and whether hobkin may merge there.
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { HOST_NAME, learnCodeHosts } from '#shared/review/ids.ts'
import { scrubText } from '#shared/integrations/redact.ts'
import { runProgram } from '../../../packages/change-review/src/git.ts'
import { ghText, type GhCall } from './gh.ts'

export interface CodeHost {
  name: string
  web: string
  api: string[]
  git: string
  headRef: string
  clones: Record<string, string>
  checkout: boolean
  merge: boolean
  /** A review tree of the host's own, for a repository too large to check out whole (entry 15). */
  tree?: HostTree
  /** The comment that asks this host to merge a pull request, and in a sentence what the host does once it is posted. */
  mergeBy?: { comment: string; after?: string }
}

/**
 * A code host's own review tree: where it is, the command that makes it when it is missing and the folder that command
 * runs in, an optional command that fits it to a change, the least free disk a new one needs, and settings for those
 * commands and for git there. `{base}` in a command is the commit the change starts from.
 */
export interface HostTree {
  path: string
  make: string[]
  makeIn: string
  fit?: string[]
  leastFreeGb: number
  env?: Record<string, string>
}

/** An agent that opens pull requests for someone, by the host it works on (`github` or a named host) and its login. */
export interface PullAgent {
  host: string
  login: string
  name?: string
}

export interface CodeHosts {
  hosts: CodeHost[]
  /** The user's own email addresses, lowercased. */
  emails: string[]
  agents: PullAgent[]
}

export const codeHostsFile = (dataRoot: string) => join(dataRoot, 'client', 'code-hosts.json')

const HOST_KEYS = new Set(['name', 'web', 'api', 'git', 'headRef', 'clones', 'checkout', 'merge', 'tree', 'mergeBy'])
const TREE_KEYS = new Set(['path', 'make', 'makeIn', 'fit', 'leastFreeGb', 'env'])
/** Words of a command: 1 to 16 plain words, the first a program, never an option. */
const COMMAND = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.length <= 16 && value.every(PLAIN) && !(value[0] as string).startsWith('-')
/** A setting's name that holds a credential is no setting: the commands find their own. */
const CREDENTIAL = /(^|_)(KEY|APIKEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH|BEARER)(_|$)/

function treeOf(raw: unknown, where: string): HostTree {
  const tree = record(raw)
  const wrong = (what: string) => new Error(`The code host file's ${where} has a tree with ${what}.`)
  if (!tree) throw wrong('no object')
  for (const key of Object.keys(tree)) if (!TREE_KEYS.has(key)) throw wrong(`an unknown setting, ${key}`)
  const { path, make, makeIn, fit, leastFreeGb = 20, env } = tree
  if (typeof path !== 'string' || !isAbsolute(path)) throw wrong('a path that is not absolute')
  if (!COMMAND(make)) throw wrong('a make command that is not 1 to 16 plain words, the first a program')
  if (typeof makeIn !== 'string' || !isAbsolute(makeIn)) throw wrong('a makeIn folder that is not absolute')
  if (fit !== undefined && !COMMAND(fit)) throw wrong('a fit command that is not 1 to 16 plain words, the first a program')
  if (typeof leastFreeGb !== 'number' || !Number.isFinite(leastFreeGb) || leastFreeGb < 0) throw wrong('a leastFreeGb that is not a number of gigabytes')
  const settings = env === undefined ? undefined : record(env)
  if (env !== undefined && (!settings || !Object.entries(settings).every(([name, value]) => /^[A-Z_][A-Z0-9_]*$/.test(name) && !CREDENTIAL.test(name) && typeof value === 'string' && !/[\u0000-\u001f]/.test(value)))) {
    throw wrong('settings that are not uppercase names, none a credential, to plain strings')
  }
  return { path, make, makeIn, ...(fit ? { fit: fit as string[] } : {}), leastFreeGb, ...(settings ? { env: settings as Record<string, string> } : {}) }
}
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i
const PLAIN = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && !/[\u0000-\u001f\u007f]/.test(value)
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null)

function hostOf(raw: unknown, at: number): CodeHost {
  const entry = record(raw)
  const where = `hosts[${at}]`
  const wrong = (what: string) => new Error(`The code host file's ${where} has ${what}.`)
  if (!entry) throw wrong('no object')
  for (const key of Object.keys(entry)) if (!HOST_KEYS.has(key)) throw wrong(`an unknown setting, ${key}`)
  const { name, web, api, git, headRef = 'refs/pull/{number}/head', clones = {}, checkout = true, merge = false, tree, mergeBy } = entry
  if (typeof name !== 'string' || !HOST_NAME.test(name)) throw wrong('a name that is not a short lowercase name other than github')
  if (typeof web !== 'string' || !URL.canParse(web) || new URL(web).protocol !== 'https:') throw wrong('a web address that is not https')
  if (!Array.isArray(api) || api.length === 0 || api.length > 12 || !api.every(PLAIN) || (api[0] as string).startsWith('-')) throw wrong('an api command that is not 1 to 12 plain words, the first a program')
  if (!PLAIN(git) || !git.includes('{owner}') || !git.includes('{repo}')) throw wrong('a git address without {owner} and {repo}')
  if (!PLAIN(headRef) || !headRef.startsWith('refs/') || !(headRef.includes('{number}') || headRef.includes('{branch}'))) throw wrong('a headRef that is not a ref with {number} or {branch}')
  const cloned = record(clones)
  if (!cloned || !Object.entries(cloned).every(([repo, folder]) => REPO.test(repo) && typeof folder === 'string' && isAbsolute(folder))) throw wrong('clones that are not owner/repo to an absolute folder')
  if (typeof checkout !== 'boolean') throw wrong('a checkout that is not true or false')
  if (typeof merge !== 'boolean') throw wrong('a merge that is not true or false')
  const asks = mergeBy === undefined ? undefined : record(mergeBy)
  if (mergeBy !== undefined && (!asks || !PLAIN(asks.comment) || (asks.after !== undefined && !PLAIN(asks.after)) || Object.keys(asks).some((key) => key !== 'comment' && key !== 'after'))) {
    throw wrong('a mergeBy that is not a comment to post and, if you like, what happens after')
  }
  if (asks && !merge) throw wrong('a mergeBy, but merge is not true: hobkin may not merge there')
  return {
    name,
    web: web.replace(/\/+$/, ''),
    api: api as string[],
    git,
    headRef,
    clones: Object.fromEntries(Object.entries(cloned).map(([repo, folder]) => [repo.toLowerCase(), folder as string])),
    checkout,
    merge,
    ...(tree !== undefined ? { tree: treeOf(tree, where) } : {}),
    ...(asks ? { mergeBy: { comment: asks.comment as string, ...(asks.after ? { after: asks.after as string } : {}) } } : {}),
  }
}

/**
 * The home's code hosts, read now. A home with no file names none. A file that cannot be read, or that names anything
 * it should not, is refused with a plain reason, so no read or verdict goes somewhere the user did not mean.
 * Reading it also teaches this side the hosts' pages, so a pull request page on one reads as its review.
 */
export function readCodeHosts(dataRoot: string): CodeHosts {
  const file = codeHostsFile(dataRoot)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    learnCodeHosts([])
    return { hosts: [], emails: [], agents: [] }
  }
  let raw: Record<string, unknown> | null
  try {
    raw = record(JSON.parse(text))
  } catch {
    raw = null
  }
  if (!raw) throw new Error(`The code host file at ${file} cannot be read: it is not a JSON object.`)
  const hosts = (Array.isArray(raw.hosts) ? raw.hosts : raw.hosts === undefined ? [] : null)?.map(hostOf)
  if (!hosts) throw new Error('The code host file has hosts that are not a list.')
  const names = new Set<string>()
  for (const host of hosts) {
    if (names.has(host.name)) throw new Error(`The code host file names ${host.name} twice.`)
    names.add(host.name)
  }
  const emails = raw.emails ?? []
  if (!Array.isArray(emails) || !emails.every((email) => typeof email === 'string' && EMAIL.test(email))) throw new Error('The code host file has emails that are not a list of email addresses.')
  const agents = raw.agents ?? []
  const agentOf = (value: unknown): PullAgent | null => {
    const entry = record(value)
    if (!entry || typeof entry.host !== 'string' || (entry.host !== 'github' && !names.has(entry.host)) || !PLAIN(entry.login) || (entry.name !== undefined && !PLAIN(entry.name))) return null
    return { host: entry.host, login: entry.login, ...(entry.name ? { name: entry.name as string } : {}) }
  }
  const named = Array.isArray(agents) ? agents.map(agentOf) : [null]
  if (named.some((agent) => agent == null)) throw new Error('The code host file has agents that are not each a host it names (or github) and a login.')
  learnCodeHosts(hosts.map(({ name, web }) => ({ name, web })))
  return { hosts, emails: (emails as string[]).map((email) => email.toLowerCase()), agents: named as PullAgent[] }
}

/** A REST call as GitHub's API names it, answered by a pull request's host. */
export interface ApiCall {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}

/** One REST call on a pull request's host: what it answered, or an error that says why. */
export type HostApi = (call: ApiCall) => Promise<string>

/** The arguments every host's API takes after its own command: the method, the path, and a body on standard input. */
const restArgs = ({ method = 'GET', path, body }: ApiCall) => [...(method === 'GET' ? [] : ['--method', method]), path, ...(body === undefined ? [] : ['--input', '-'])]

/** GitHub, through gh, as the user. */
export function githubApi(gh: GhCall): HostApi {
  return (call) => ghText(gh, ['api', '--hostname', 'github.com', ...restArgs(call)], call.body === undefined ? undefined : JSON.stringify(call.body))
}

const API_TIMEOUT_MS = 120_000

/** The last line a program wrote that says something. */
const lastLine = (text: string) => text.trim().split('\n').filter((line) => line.trim()).at(-1)?.trim() ?? ''

/** A named host, through its own command for the pull request's repository. Its errors show nothing shaped like a credential. */
export function namedApi(host: CodeHost, repo: { owner: string; repo: string }, program = runProgram): HostApi {
  return async (call) => {
    const [file, ...words] = host.api.map((word) => word.replaceAll('{owner}', repo.owner).replaceAll('{repo}', repo.repo))
    const ran = await program(file!, [...words, ...restArgs(call)], { cwd: tmpdir(), timeoutMs: API_TIMEOUT_MS, ...(call.body === undefined ? {} : { input: JSON.stringify(call.body) }) })
    const said = (why: string) => new Error(scrubText(`${host.name} said: ${why}`))
    if (!ran.started) throw said(`its command could not start: ${ran.reason}`)
    if (ran.timedOut) throw said(`it gave no answer within ${API_TIMEOUT_MS / 1000} seconds.`)
    const out = ran.stdout.toString('utf8')
    if (ran.code !== 0) throw said(lastLine(ran.stderr.toString('utf8')) || lastLine(out) || `it stopped with code ${ran.code}.`)
    return out
  }
}
