import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { paths } from 'hobkin/src/cli/work/store.mjs'
import { homeContents, notHobkins } from '../src/backup.ts'
import { Client, hostFor, temporaryDirectory } from './support.ts'

/**
 * A backup takes only the entries hobkin and this client write by design at the home's root, in `runtime/` and in a
 * project's folder, and leaves anything else there out as not hobkin's own. These tests fail when hobkin or this client
 * writes a name there that the list in `host/src/backup.ts` does not name, so it is decided before a backup drops it.
 */

const HOBKIN = dirname(fileURLToPath(import.meta.resolve('hobkin/package.json')))
const CLIENT = fileURLToPath(new URL('..', import.meta.url))

const sources = (folder: string, ending: RegExp) =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && ending.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))

/** The expressions that stand for the home itself (or its data root, the same folder unless the home was migrated). */
const HOME = /^(?:await\s+)?(?:(?:this\.|value\.|options\.|this\.options\.|admitted\.)?(?:root|home|dataRoot|resolvedRoot)(?:\(\))?|this\.dataRoot\(\)|resolveDataRoot\([^()]*\))$/
/** What the code joins to `home` where `home` is the user's own folder (`homedir()`), not hobkin's. */
const THE_USERS_OWN = new Set(['.claude', '.hobkin-notes', '.hobkin-reports-updates.md', '.hobkin-schedules.md', '.local', '.npm-global', '.pi', 'Downloads', 'Library'])
/** A project's folder, as hobkin's work store names it. */
const PROJECT = /^paths\(root, \w+\)\.directory$/

/** `join(<first argument>, 'a', 'b/c', …)`: the first argument, and the plain strings that follow it. */
const JOIN = /join\(\s*([^,()]*(?:\([^()]*\))?[^,()]*?)\s*,\s*((?:'[^'\n]*'\s*,?\s*)+)/g

/** The entry a join names at the root, in `runtime/` or in a project's folder, by path in the home; null when it joins onto something else. */
function entryJoined(first: string, parts: string[]): string | null {
  if (PROJECT.test(first)) return `work/app/${parts[0]}`
  if (!HOME.test(first) || THE_USERS_OWN.has(parts[0]!)) return null
  if (parts[0] === 'runtime' && parts[1]) return `runtime/${parts[1]}`
  return parts[0]!
}

/** Each entry hobkin's `src/cli` and this host's `src` join at those levels, with the files that join it. */
function namesTheCodeWrites(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const note = (path: string, file: string) => found.set(path, (found.get(path) ?? new Set()).add(file))

  for (const file of [...sources(join(HOBKIN, 'src/cli'), /\.mjs$/), ...sources(join(CLIENT, 'src'), /\.ts$/)]) {
    const repository = file.startsWith(HOBKIN) ? HOBKIN : CLIENT
    for (const [, first, strings] of readFileSync(file, 'utf8').matchAll(JOIN)) {
      const parts = [...strings!.matchAll(/'([^'\n]*)'/g)].flatMap(([, part]) => part!.split('/')).filter(Boolean)
      const path = entryJoined(first!.trim(), parts)
      if (path) note(path, relative(repository, file))
    }
  }

  // Every path hobkin's work store gives a project.
  for (const path of Object.values(paths('/home', 'app'))) {
    note(relative('/home', path).split('/').slice(0, 3).join('/'), 'src/cli/work/store.mjs')
  }
  return found
}

test("every name hobkin and this host write at the home's root, in runtime/ and in a project's folder is hobkin's own to a backup", () => {
  const found = namesTheCodeWrites()
  // The scan reads what it should: names from both repositories and at all three levels.
  for (const path of ['AGENTS.md', 'client', 'runtime/brief.json', 'work/app/items.jsonl', 'work/app/yolo.json']) assert.ok(found.has(path), path)
  const unnamed = [...found].filter(([path]) => notHobkins(path)).map(([path, files]) => `${path} (${[...files].join(', ')})`)
  assert.deepEqual(unnamed, [], "Name these in host/src/backup.ts as hobkin's own, or leave them out on purpose there")
})

test("a home that hobkin and this host start holds nothing a backup would leave out as not hobkin's own", async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  const host = await hostFor(t, { root, backupsDir: join(dirname(root), 'kept') })
  const client = await Client.connect(host)
  t.after(() => client.close())
  await client.live()
  // A project's folder laid out as hobkin's work store names its parts.
  for (const [key, path] of Object.entries(paths(root, 'app'))) {
    if (['directory', 'trees', 'prs', 'clone', 'lookTree', 'oldDoTree'].includes(key)) mkdirSync(path, { recursive: true })
    else writeFileSync(path, '')
  }
  const { strays, records } = homeContents(host.root)
  assert.ok(records.includes('runtime/') && records.includes('config.json'), records.join(', '))
  assert.deepEqual(strays, [])
})
