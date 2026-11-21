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

/**
 * Each `join(<the home>, 'a', 'b/c', …)` and `join(paths(root, slug).directory, 'a')` in hobkin's `src/cli` and this
 * host's `src`, as the path inside the home of the entry it names at the root, in `runtime/` or in a project's folder.
 */
function namesTheCodeWrites(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const files = [...sources(join(HOBKIN, 'src/cli'), /\.mjs$/), ...sources(join(CLIENT, 'src'), /\.ts$/)]
  for (const file of files) {
    for (const [, root, rest] of readFileSync(file, 'utf8').matchAll(/join\(\s*([^,()]*(?:\([^()]*\))?[^,()]*?)\s*,\s*((?:'[^'\n]*'\s*,?\s*)+)/g)) {
      const parts = [...rest!.matchAll(/'([^'\n]*)'/g)].flatMap(([, part]) => part!.split('/')).filter(Boolean)
      let path: string | null = null
      if (PROJECT.test(root!.trim())) path = `work/app/${parts[0]}`
      else if (HOME.test(root!.trim()) && !THE_USERS_OWN.has(parts[0]!)) path = parts[0] === 'runtime' && parts[1] ? `runtime/${parts[1]}` : parts[0]!
      if (path) found.set(path, (found.get(path) ?? new Set()).add(relative(file.startsWith(HOBKIN) ? HOBKIN : CLIENT, file)))
    }
  }
  // Every path hobkin's work store gives a project.
  for (const path of Object.values(paths('/home', 'app'))) found.set(relative('/home', path).split('/').slice(0, 3).join('/'), new Set(['src/cli/work/store.mjs']))
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
