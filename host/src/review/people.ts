/**
 * Who a pull request is from, with links to their profiles (spec 048, entry 27). On GitHub an author's login links to
 * their page, and a bot's to its app's page. Elsewhere an author who is an email is looked up with the home's people
 * lookup, which the code host file names; an agent the file names goes by its name. When an agent opened it, the first
 * email of its description's "requested by" line is the person it is for, never one after "modified by".
 *
 * People found are kept in the home's client folder by lowercased email: someone found for a month, someone not found
 * for a day, and nothing when the lookup could not run, so it is asked again. The same email is asked once at a time.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { runProgram } from '../../../packages/change-review/src/git.ts'
import type { PullAgent } from './code-hosts.ts'
import { requestedBy } from './owner.ts'
import type { PullTarget } from './pull-checkout.ts'

export interface Person {
  name: string
  url?: string
}

/** The people a pull request's by-line names. */
export interface PullPeople {
  author: Person | null
  for?: Person
}

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i
/** Only an id made of these goes in a link. */
const PLAIN_ID = /^[A-Za-z0-9._-]{1,100}$/
const DAY = 24 * 60 * 60_000
const MONTH = 30 * DAY
const LOOKUP_MS = 30_000

interface Kept {
  at: number
  found: boolean
  id?: string
  name?: string
}

function readKept(file: string): Record<string, Kept> {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; people?: Record<string, Kept> }
    return saved.version === 1 && saved.people && typeof saved.people === 'object' ? saved.people : {}
  } catch {
    return {}
  }
}

function writeKept(file: string, people: Record<string, Kept>) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const next = `${file}.${process.pid}.next`
  writeFileSync(next, JSON.stringify({ version: 1, people }), { mode: 0o600 })
  renameSync(next, file)
}

/** Finds a person by email with the home's lookup, keeping what it found. Null for nobody, or when nobody can be looked up. */
export function peopleFinder({ file, lookup, run = runProgram, now = Date.now }: {
  /** Where people are kept: one JSON file in the home's client folder. */
  file: () => string
  /** The lookup the code host file names now, or undefined. */
  lookup: () => { command: string[]; profile: string } | undefined
  run?: typeof runProgram
  now?: () => number
}): (email: string) => Promise<Person | null> {
  const asking = new Map<string, Promise<Person | null>>()
  return async (email) => {
    const key = email.trim().toLowerCase()
    const how = lookup()
    if (!how || !EMAIL.test(key)) return null
    const personOf = (kept: Kept): Person | null => (kept.found && kept.name ? { name: kept.name, ...(kept.id && PLAIN_ID.test(kept.id) ? { url: how.profile.replace('{id}', encodeURIComponent(kept.id)) } : {}) } : null)
    const kept = readKept(file())[key]
    if (kept && now() - kept.at < (kept.found ? MONTH : DAY)) return personOf(kept)
    const under = asking.get(key)
    if (under) return under
    const job = (async () => {
      const [program, ...args] = how.command.map((word) => word.replace('{email}', key))
      const ran = await run(program!, args, { cwd: tmpdir(), timeoutMs: LOOKUP_MS })
      // A lookup that could not run says nothing of the person, so nothing is kept and it is asked again.
      if (!ran.started || ran.timedOut || ran.code !== 0) return null
      let answer: { id?: unknown; name?: unknown } | null = null
      try {
        answer = JSON.parse(ran.stdout.toString('utf8')) as typeof answer
      } catch {
        answer = null
      }
      const name = typeof answer?.name === 'string' && answer.name.trim() ? answer.name.trim() : null
      const id = typeof answer?.id === 'string' ? answer.id : undefined
      const record: Kept = name ? { at: now(), found: true, name, ...(id ? { id } : {}) } : { at: now(), found: false }
      writeKept(file(), { ...readKept(file()), [key]: record })
      return personOf(record)
    })()
    asking.set(key, job)
    try {
      return await job
    } finally {
      asking.delete(key)
    }
  }
}

/** A GitHub login's own page, or a bot's app page. */
function githubPerson(login: string, name = login): Person {
  const bot = /^(.+)\[bot\]$/.exec(login)?.[1]
  const plain = /^[A-Za-z0-9-]+$/
  if (bot && plain.test(bot)) return { name, url: `https://github.com/apps/${bot}` }
  return plain.test(login) ? { name, url: `https://github.com/${login}` } : { name }
}

/** Who a pull request is from, by what its review kept of it. A name that cannot be looked up shows as it is, with no link. */
export async function pullPeople({ target, author, description, agents, find }: {
  target: PullTarget
  author: string | null
  description: string
  agents: readonly PullAgent[]
  find: (email: string) => Promise<Person | null>
}): Promise<PullPeople> {
  if (!author) return { author: null }
  const host = target.host ?? 'github'
  const agent = agents.find((entry) => entry.host === host && entry.login.toLowerCase() === author.toLowerCase())
  const byEmail = async (email: string) => (await find(email).catch(() => null)) ?? { name: email }
  let person: Person
  if (agent) person = host === 'github' ? githubPerson(agent.login, agent.name ?? agent.login) : { name: agent.name ?? agent.login }
  else if (host === 'github') person = githubPerson(author)
  else person = EMAIL.test(author) ? await byEmail(author) : { name: author }
  const asked = agent ? requestedBy(description)[0] : undefined
  return { author: person, ...(asked ? { for: await byEmail(asked) } : {}) }
}
