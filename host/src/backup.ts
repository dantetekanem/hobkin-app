import { execFile } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BACKUP_CADENCES, BACKUP_LIMIT_MAX, BACKUP_NAME, BACKUP_SAFETY_KEPT, DEFAULT_BACKUP_CONFIG, type BackupCadence, type BackupConfig, type BackupEntry, type BackupState, type BackupStray } from '#shared/backup/types.ts'

/**
 * Local backup of hobkin's own records in the home: its conversations, routines, reports, notes, decisions, the work
 * queue and its settings, in one timestamped .zip, kept outside the home so a backup never contains the backups
 * before it.
 *
 * A backup taken while hobkin writes is best-effort: the files are read one after another, so it can mix a moment's
 * old and new state, and a file that goes away or cannot be read is skipped and told. Nothing freezes the home. Each
 * SQLite store is the exception: SQLite copies it whole first, so a checkpoint while zip reads cannot tear it.
 *
 * Left out of an archive, because they describe the process running now and would break the next start if restored:
 * `runtime.lock` (hobkin's lock) and `client/host.json` (this host's pid, port and token).
 *
 * Left out too, because they are not hobkin's records (the user, 2026-11-13: "i said only hobkin data"; a first backup
 * of the whole home was 5.4 GB, most of it installed dependencies): the working copies of projects and what agents
 * built in them, the clones hobkin makes and every other git checkout, the checkouts a change review is made from, the artifacts and evidence a run leaves (its brief and its
 * report are records), the transcripts of agent runs, and the index that is built again from the notes.
 *
 * Left out as well is whatever hobkin did not write (the user, 2026-11-21, of a 2.3 GB backup that held an agent's Linux
 * VM: "this should never be in the backup path"): at the home's root, in `runtime/` and in each project's folder in
 * `work/`, a backup takes only the names hobkin and this client write there by design, and anything else at those
 * levels is left out with everything under it, whatever it is called, and told with its size (see `OWN_AT_HOME`).
 *
 * `leftOut` is the one rule for all of it. A restore never moves, deletes or rolls back any of it, and never takes it
 * from an archive.
 */
const PROCESS_FILES = ['runtime.lock', 'client/host.json']
const NOT_RECORDS: readonly RegExp[] = [
  // Each project's working trees, the clone hobkin makes of it when it has no folder on this Mac (their git data is in
  // it), its review checkouts and its release builds.
  /^work\/[^/]+\/(?:trees|repo|reviews|releases)$/,
  // What a project's runs left in `runs/`: the run's brief and its report, named by its id, are records; the rest is not.
  /^work\/[^/]+\/runs\/(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.report)?\.md$)[^/]+$/,
  // The checkouts Change Review reads a change from, and the clones it makes of repositories with none on this Mac.
  /^client\/review-(?:trees|clones)$/,
  // The transcripts of agent runs. A durable hobkin's own conversation is in `hobkins/`, which is a record.
  /^jobs$/,
  // The search index over the notes, built again when it is missing.
  /^runtime\/\.qmd$/,
  // A Ludicrous run's agent transcripts and logs, the unfinished project code Stop saved as patches, its tools and its check logs.
  // The run's record, its counts and its report stay records.
  /^ludicrous\/[^/]+\/(?:sessions|logs|unfinished|bin|tools|shells|locks|checks|leaders)$/,
  // What a run leaves beside its report, in the places hobkin's runs leave it (handoffs, a project's folder and its pull
  // requests): `<name>-evidence`, `<name>.evidence`, `<name>-artifacts`, `<name>.artifacts`. A folder of the user's
  // named like that elsewhere, such as `memory/tax-evidence`, is a record.
  /^(?:runtime\/handoffs|work\/[^/]+|work\/[^/]+\/prs)\/[^/]+[-.](?:evidence|artifacts)$/,
]

/**
 * What hobkin and this client write by design at the home's root, in `runtime/` and in each project's folder: there a
 * backup takes these and nothing else, and `PROCESS_FILES` and `NOT_RECORDS` still leave out what they name. Each name
 * comes with the code that writes it, in hobkin's `src/cli/` or this client's `host/src/`. A name the code joins at
 * those levels that is not here fails `host/test/backup-guard.test.ts`, so it is decided before a backup drops it.
 */
type Names = readonly (string | RegExp)[]

const OWN_AT_HOME: Names = [
  'AGENTS.md', // directions.mjs; host/src/directions.ts
  'answers.jsonl', // questions.mjs
  'canvas', // canvas.mjs; host/src/canvases.ts
  'checks', // checks.mjs, holds.mjs, memory.mjs
  'client', // this client: host-file.ts, slash.ts, reminders.ts, review/, pi/node.ts and the rest
  'config.json', // config.mjs, settings.mjs
  'decisions.jsonl', // decisions.mjs
  'feedback', // feedback/outbox.mjs
  'hobkins', // hobkins.mjs
  'imported', // history.mjs, delivery.mjs, pi-session.mjs: what `hobkin import` brought
  'ludicrous', // ludicrous/run.mjs, ludicrous/compile.mjs: each Ludicrous run's record, counts and report, and which run is the page's
  'memory.md', // memory.mjs
  'memories', // memories.mjs: one memory a file, with its `private/` and `forgotten/` folders and `changes.jsonl`
  'migration', // migration/journal.mjs: a migration's journal and its data
  'active.json', // migration/admission.mjs: which migrated data is the home's
  'notes', // pi-session.mjs, memory-index.mjs
  'profile.json', // profile.mjs
  'proofs', // proof/record.mjs; host/src/proofs.ts
  'reports', // reports.mjs
  'resources', // resource-use.mjs
  'reviews', // patterns.mjs
  'routines', // schedules.mjs
  'schedules', // schedules.mjs: the routines' old folder, a link to `routines` once they move
  'runtime', // runtime.mjs
  'sessions', // pi-session.mjs, main-session-child.mjs
  'setup.json', // setup-facts.mjs
  'telemetry', // telemetry/sender.mjs
  'tools', // proof/setup.mjs, proof/tools.mjs: the Java, TLA+ and TLAPS that proofs run
  'work', // work/store.mjs
  // No code writes it: a dated copy of `AGENTS.md`, taken as a file at the root until someone decides.
  /^AGENTS\.before-\d{4}-\d\d-\d\d\.md$/,
]
const OWN_IN_RUNTIME: Names = [
  'answers.md', // decided.mjs
  'autonomy.json', // autonomy.mjs: each task class's autonomy level and its clean runs
  'brief.json', // brief.mjs
  'catch-up.json', // catch-up.mjs: when the last catch-up was written and the day the daily one last came
  'catch-up-asked.json', // catch-up.mjs: a catch-up `hobkin reports catch-up` asked for, until the running hobkin takes it
  'client-notices.jsonl', // client-notices.mjs
  'day.json', // day.mjs: the day the morning brief planned and the evening close
  'deleted-reports.json', // reports.mjs
  'desk.json', // desk-queue.mjs: what the desk holds for a digest and what it has let go
  'events', // events.mjs
  'handoffs', // session.mjs, session-jobs.mjs, session-log.mjs
  'hobkin.sqlite', // runtime.mjs, and beside it SQLite's own files, which `backupNow` leaves out
  /^hobkin\.sqlite-(?:wal|shm|journal)$/,
  'imported-reports.json', // history.mjs
  'inbox.jsonl', // inbox.mjs
  'learning.json', // learning/store.mjs
  'learning-actions.jsonl', // learning/store.mjs
  'lessons.md', // learning/store.mjs
  'lock-holder.json', // home-lock.mjs
  'memory-index.json', // memory-index.mjs
  'memory-use.jsonl', // memory-use.mjs: recalls and index builds
  'pasted', // paste-image.mjs
  'pi-directions.json', // learning/pi-directions.mjs: the version of Pi's AGENTS.md last looked at and its proposal
  'presentation.json', // view.mjs
  'remote.json', // remote/credentials.mjs
  'report-attention.json', // telemetry.mjs
  'session-requests', // session.mjs, session-jobs.mjs
  'standing-rules.json', // standing-rules.mjs, outward-guard-extension.mjs: the user's standing decision rules
  'telemetry.jsonl', // telemetry.mjs
  'tell-requests', // hobkin-tell.mjs
  'templates-seen.json', // routine-templates.mjs
  'unread.json', // unread.mjs: what the user sent that the main agent never read
  'upkeep.json', // work/upkeep.mjs
  'usage.json', // usage.mjs
  'view.json', // view.mjs, patterns.mjs, application.mjs
  'wins-told.json', // work/wins.mjs
  'workflows.json', // workflows.mjs: which workflows are on
  'workflows-seen.json', // workflows.mjs: when each workflow was first seen in its folder
  /^work-reset-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/, // work/commands.mjs: what a reset of work mode set aside
  // No code writes it: credentials beside `remote.json`, for a hobkin-api on this Mac it seems. Taken until someone decides.
  'remote.local-dev.json',
]
const OWN_IN_PROJECT: Names = [
  // work/store.mjs, `paths`
  'project.md',
  'directions.md',
  'items.jsonl',
  'launches.jsonl',
  'signals.json',
  'state.json',
  'prs',
  'run-guide.md', // the user's run guide (work/run-guide.mjs), kept here and never in the project
  'run-guide.jsonl', // when the run guide was written and run
  'yolo.json', // work/yolo.mjs
  'machines.json', // work/machines.mjs
  'runs', // work/director.mjs, until hobkin's cd6f3cc of 2026-11-10: the briefs and reports of runs
]

/** hobkin's names in a folder inside the home, when the folder is one of the three levels, and null for any other folder. */
function ownNamesIn(folder: string): Names | null {
  if (folder === '') return OWN_AT_HOME
  if (folder === 'runtime') return OWN_IN_RUNTIME
  if (/^work\/[^/]+$/.test(folder)) return OWN_IN_PROJECT
  return null
}

/** For a path at one of the three levels: hobkin's names there, the path's own name, and whether it is at the root. */
function level(path: string): { own: Names; name: string; home: boolean } | null {
  const slash = path.lastIndexOf('/')
  const folder = slash < 0 ? '' : path.slice(0, slash)
  const own = ownNamesIn(folder)
  if (own === null) return null
  return { own, name: path.slice(slash + 1), home: folder === '' }
}

const named = (own: Names, name: string) => own.some((each) => (typeof each === 'string' ? each === name : each.test(name)))

/**
 * Whether a path at one of the three levels is a file of hobkin's that is being written at that moment, under a passing
 * name, before it takes its own name's place: `<name>.<random>.tmp` or `<name>.tmp` beside one of hobkin's names
 * (config.mjs, settings.mjs, reports.mjs and others), or `.AGENTS.md-<random>` (host/src/directions.ts). It is half of
 * a record, and the whole one is taken, so it is left out without a word.
 */
function beingWritten(path: string): boolean {
  const at = level(path)
  if (!at) return false
  if (at.home && /^\.AGENTS\.md-[\w-]+$/.test(at.name)) return true
  return at.name.endsWith('.tmp') && [at.name.slice(0, -4), at.name.replace(/\.[\w-]+\.tmp$/, '')].some((name) => named(at.own, name))
}

const onPurpose = (path: string) => PROCESS_FILES.includes(path) || NOT_RECORDS.some((rule) => rule.test(path)) || beingWritten(path)

/**
 * Whether a path inside the home, written with `/`, is at the home's root, in `runtime/` or in a project's folder and is
 * not hobkin's own: no code of hobkin's or this client's writes that name there, and no rule leaves it out on purpose.
 */
export function notHobkins(path: string): boolean {
  const at = level(path)
  return at !== null && !named(at.own, at.name) && !onPurpose(path)
}

/** Names zip cannot be handed one to a line: it splits its list at line breaks and at carriage returns. */
const UNNAMEABLE = /[\x00-\x1f\x7f]/
const BEFORE_RESTORE = '-before-restore'

/** Whether a path inside the home, written with `/`, is left out of a backup, with everything under it. */
export const leftOut = (path: string): boolean => onPurpose(path) || notHobkins(path)

/**
 * What a home holds, by `leftOut`: `records` are the paths a backup takes, files and links as they are and folders
 * with a `/` after them, and `kept` the paths it leaves out, each the topmost of what it leaves. `strays` are those of
 * `kept` that are not hobkin's own (`notHobkins`). A folder that holds `.git` is kept too, wherever it is: a checkout is
 * code, and rolled back it would lose the commits made since. So is a socket, a named pipe or a device: it holds nothing
 * to copy, so leaving it is no failure. `skipped` are records whose names zip cannot be given (a line break or another
 * control character in them): no backup holds them, so a restore leaves them where they are. Nothing under a kept
 * folder is read, so a working copy with a hundred thousand files costs one look. A link is never followed.
 */
export function homeContents(source: string): { records: string[]; kept: string[]; skipped: string[]; strays: string[] } {
  const records: string[] = []
  const kept: string[] = []
  const skipped: string[] = []
  const strays: string[] = []
  const walk = (folder: string) => {
    for (const entry of readdirSync(join(source, folder), { withFileTypes: true })) {
      const path = folder ? `${folder}/${entry.name}` : entry.name
      if (notHobkins(path)) {
        kept.push(path)
        strays.push(path)
      } else if (onPurpose(path)) {
        kept.push(path)
      } else if (!entry.isFile() && !entry.isSymbolicLink() && !entry.isDirectory()) {
        kept.push(path)
      } else if (UNNAMEABLE.test(entry.name)) {
        skipped.push(path)
      } else if (!entry.isDirectory()) {
        records.push(path)
      } else if (lstatSync(join(source, path, '.git'), { throwIfNoEntry: false })) {
        kept.push(path)
      } else {
        records.push(`${path}/`)
        walk(path)
      }
    }
  }
  walk('')
  return { records, kept, skipped, strays }
}

/**
 * How much `path` inside `source` takes on disk, by `du` at low priority, or null when it could not be measured. A link
 * is measured as itself, not followed.
 */
const diskBytes = (source: string, path: string) =>
  new Promise<number | null>((done) => {
    // A folder with something du may not read still gets its total, with a failing exit.
    execFile('nice', ['-n', '10', 'du', '-sk', '--', path], { cwd: source, timeout: 120_000 }, (_error, out) => {
      const kilobytes = /^(\d+)\s/.exec(String(out))?.[1]
      done(kilobytes === undefined ? null : Number(kilobytes) * 1024)
    })
  })

/** Each path with its size on disk, largest first. Never fails: the backup is made, and at worst a size is missing. */
async function measured(source: string, paths: readonly string[]): Promise<BackupStray[]> {
  const sizes: BackupStray[] = []
  for (const path of paths) sizes.push({ path, bytes: await diskBytes(source, path) })
  return sizes.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1))
}

/**
 * The boundary to the zip tool, so tests can swap it. `create` zips `records`, paths inside `source`, under the
 * folder's own name, adding to the archive when it is already there, and returns those it could not take; `extract`
 * unpacks to a folder.
 */
export interface Archiver {
  create(source: string, archive: string, records: readonly string[]): Promise<readonly string[] | void>
  extract(archive: string, into: string): Promise<void>
}

const listArchive = (archive: string) =>
  new Promise<string[]>((done, fail) =>
    execFile('unzip', ['-Z1', archive], { maxBuffer: 256 * 1024 * 1024 }, (error, out) => (error ? fail(error) : done(String(out).split('\n').filter(Boolean)))),
  )

const run = (file: string, args: string[], cwd: string | undefined, accepted: readonly number[], input?: string, tool = file) =>
  new Promise<void>((done, fail) => {
    const child = execFile(file, args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, _out, stderr) => {
      const code = (error as { code?: unknown } | null)?.code
      if (!error || (typeof code === 'number' && accepted.includes(code))) return done()
      fail(Error(`${tool} failed${typeof code === 'number' ? ` (${code})` : ''}: ${String(stderr).trim().slice(0, 500) || error.message}`))
    })
    // A tool that ends before it has read everything closes its input: its own failure is the one told.
    child.stdin?.on('error', () => {})
    child.stdin?.end(input ?? '')
  })

/**
 * Info-ZIP `zip` and `unzip`, which macOS ships and Linux has: no new dependency, symlinks kept, files over 4 GB handled.
 * Runs at low priority so a big home does not slow the app. Exit 18 from zip means some files could not be read (they
 * changed, went away or may not be read): the archive is still written, and what it lacks is told as not taken.
 */
export const zipArchiver: Archiver = {
  create: async (source, archive, records) => {
    const folder = basename(source)
    // The names are given one to a line (`-@`), and nothing is walked by zip itself: only what the rule took goes in. The
    // home's own folder comes first, so a home with no records still makes an archive, which restores to none.
    const names = [`${folder}/\n`, ...records.map((path) => `${folder}/${path}\n`)].join('')
    await run('nice', ['-n', '10', 'zip', '-y', '-q', '-1', archive, '-@'], dirname(source), [18], names, 'zip')
    // zip says little about what it passed over, so what the archive lacks is what it missed.
    const taken = new Set(await listArchive(archive))
    return records.filter((path) => !taken.has(`${folder}/${path}`))
  },
  extract: (archive, into) => run('unzip', ['-q', '-o', archive, '-d', into], undefined, []),
}

/** Where `path` really is, through any link on the way, also when its last parts do not exist yet. */
function realPlace(path: string): string {
  const full = resolve(path)
  try {
    return realpathSync(full)
  } catch {
    const parent = dirname(full)
    return parent === full ? full : join(realPlace(parent), basename(full))
  }
}

/** Whether `path` is `folder` or inside it, by where both really are: a link cannot hide one inside the other. */
const inside = (folder: string, path: string) => {
  const from = relative(realPlace(folder), realPlace(path))
  return from === '' || (!from.startsWith('..') && !isAbsolute(from))
}

/** `hobkin-backup-2026-11-12T22-30-00.zip`: UTC, so names sort in time order through clock changes. */
export function backupName(at: number, suffix = ''): string {
  return `hobkin-backup-${new Date(at).toISOString().slice(0, 19).replaceAll(':', '-')}${suffix}.zip`
}

/** When a backup of this name was taken, or null when the name is not one of ours. */
export function backupTime(name: string): number | null {
  const found = BACKUP_NAME.exec(name)
  if (!found) return null
  const time = Date.parse(`${found[1]}T${found[2]}:${found[3]}:${found[4]}Z`)
  return Number.isNaN(time) ? null : time
}

export const intervalMs = (cadence: BackupCadence): number => (cadence === 'hourly' ? 3_600_000 : 86_400_000)

/** When the next automatic backup is due: one cadence after the last, and now when there is none or it is overdue. */
export function nextRunAt(lastAt: number | null, cadence: BackupCadence, now: number): number {
  return lastAt === null ? now : Math.max(now, lastAt + intervalMs(cadence))
}

/** Backups in the folder, newest first. Half-written files (`.partial`) and strangers are not listed. */
export function listBackups(directory: string): BackupEntry[] {
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return []
  }
  const found: BackupEntry[] = []
  for (const name of names) {
    const at = backupTime(name)
    const stat = at === null ? undefined : statSync(join(directory, name), { throwIfNoEntry: false })
    if (at !== null && stat?.isFile()) found.push({ name, at, bytes: stat.size })
  }
  return found.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1))
}

const isSafety = ({ name }: BackupEntry) => name.endsWith(`${BEFORE_RESTORE}.zip`)

/**
 * Deletes all but the newest `limit` backups (at least one is always kept). The copies a restore takes first are not
 * counted: the newest `BACKUP_SAFETY_KEPT` of them are kept whatever the limit, so a restore can be undone. Returns
 * the names removed.
 */
export function pruneBackups(directory: string, limit: number): string[] {
  const keep = Math.max(1, Math.floor(limit))
  const all = listBackups(directory)
  const old = [...all.filter((entry) => !isSafety(entry)).slice(keep), ...all.filter(isSafety).slice(BACKUP_SAFETY_KEPT)]
  for (const { name } of old) rmSync(join(directory, name), { force: true })
  return old.map(({ name }) => name)
}

/**
 * A backup just made, the paths in the home it could not take (files it could not read, and names zip cannot be given),
 * and what it left out as not hobkin's own, with sizes, largest first.
 */
export type BackupMade = BackupEntry & { skipped: string[]; strays: BackupStray[] }

const STORE_NAME = /\.(?:sqlite3?|db)$/

/** Whether a record is a SQLite database: a file, not a link, that starts as SQLite's own files start. */
function isStore(file: string): boolean {
  try {
    if (!lstatSync(file).isFile()) return false
    const handle = openSync(file, 'r')
    try {
      const head = Buffer.alloc(16)
      return readSync(handle, head, 0, 16, 0) === 16 && head.toString('latin1') === 'SQLite format 3\0'
    } finally {
      closeSync(handle)
    }
  } catch {
    return false
  }
}

/**
 * A whole copy of a SQLite store that hobkin may have open and be writing, made by SQLite itself from a read-only
 * connection in one read: one file, with its write-ahead log folded in, so no checkpoint can tear it.
 */
function copyStore(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  const store = new DatabaseSync(from, { readOnly: true, timeout: 10_000 })
  try {
    store.prepare('VACUUM INTO ?').run(to)
  } finally {
    store.close()
  }
}

/**
 * Zips hobkin's records in `source` into `directory` under the time's name. It is written under another name first, so
 * a failure leaves no archive that looks whole. Each SQLite store goes in as SQLite's own copy of it, under its name,
 * and its `-wal`, `-shm` and `-journal` files stay out, so a restored store never meets a log that is not its own.
 */
export async function backupNow(source: string, directory: string, now: number, archiver: Archiver = zipArchiver, suffix = ''): Promise<BackupMade> {
  if (!statSync(source, { throwIfNoEntry: false })?.isDirectory()) throw Error(`There is nothing to back up at ${source}.`)
  if (inside(source, directory)) throw Error('The backups folder must be outside the folder it backs up.')
  mkdirSync(directory, { recursive: true })
  // Two in the same second get the next free second.
  let at = Math.floor(now / 1000) * 1000
  while (existsSync(join(directory, backupName(at, suffix)))) at += 1000
  const name = backupName(at, suffix)
  const partial = join(directory, `${name}.partial`)
  const copies = join(directory, `${name}.stores`)
  const { records, skipped, strays } = homeContents(source)
  const stores = records.filter((path) => STORE_NAME.test(path) && isStore(join(source, path)))
  const theirs = new Set(stores.flatMap((path) => [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]))
  try {
    for (const path of stores) {
      try {
        copyStore(join(source, path), join(copies, basename(source), path))
      } catch (error) {
        throw Error(`SQLite could not copy ${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const missed = [...((await archiver.create(source, partial, records.filter((path) => !theirs.has(path)))) ?? [])]
    if (stores.length) missed.push(...((await archiver.create(join(copies, basename(source)), partial, stores)) ?? []))
    renameSync(partial, join(directory, name))
    return { name, at, bytes: statSync(join(directory, name)).size, skipped: [...skipped, ...missed], strays: await measured(source, strays) }
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  } finally {
    rmSync(copies, { recursive: true, force: true })
  }
}

export interface RestoreOptions {
  archiver?: Archiver
  /**
   * Runs once the archive is unpacked and checked, just before the data is replaced: the place to take a copy of what is
   * there. It returns the paths that copy could not take, and the restore leaves those where they are.
   */
  beforeReplace?: () => Promise<readonly string[] | void>
}

/**
 * Puts hobkin's records in `dest` back as the archive has them. Destructive, so it is reached only through the confirmed
 * command. The archive is unpacked and checked beside `dest` first (`<home>.restoring`); a bad archive changes nothing.
 *
 * What a backup leaves out never moves: the working copies stay at their paths the whole time, so an agent working in
 * one keeps its folder, and whatever the archive holds of them (an older backup of the whole home did) is not taken.
 * Only records move, each by one rename: the home's own are set aside in `<home>.replaced`, then the archive's go in.
 * When a rename fails everything is moved back, and the home is as it was. When moving back fails too, what could not
 * go back stays in `<home>.replaced` and the error says so: a failed restore deletes nothing but the archive's
 * unpacked copy. A `<home>.replaced` left by a restore cut short is never cleared: the next restore stops and names it.
 * A record no backup could take (see `homeContents`, and what `beforeReplace` says its copy missed) stays where it is.
 *
 * Needs a restart of hobkin to be seen: a running hobkin still holds the old files open.
 */
export async function restoreBackup(archive: string, dest: string, { archiver = zipArchiver, beforeReplace }: RestoreOptions = {}): Promise<void> {
  if (!statSync(archive, { throwIfNoEntry: false })?.isFile()) throw Error('That backup is not there.')
  if (inside(dest, archive)) throw Error(`That backup is inside ${dest}, so restoring it would take the backups away with the records it replaces. Keep the backups outside the hobkin folder.`)
  const staging = `${dest}.restoring`
  const aside = `${dest}.replaced`
  if (lstatSync(aside, { throwIfNoEntry: false })) {
    throw Error(`A restore that did not finish left ${aside}, which may hold the only copy of some of hobkin's records from before it. Move what you need from it back into ${dest}, remove it, then restore again.`)
  }
  // Only ever an unpacked copy of an archive, so one left behind is cleared.
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    await archiver.extract(archive, staging)
    const folders = readdirSync(staging, { withFileTypes: true })
    if (folders.length !== 1 || !folders[0]!.isDirectory()) throw Error('That file is not a hobkin backup.')
    const content = join(staging, folders[0]!.name)
    // Nothing a backup leaves out is taken from an archive, wherever it sits in it: an older backup of the whole home held working copies.
    for (const path of homeContents(content).kept) rmSync(join(content, path), { recursive: true, force: true })
    const notTaken = (await beforeReplace?.()) ?? []
    mkdirSync(dest, { recursive: true, mode: 0o700 })
    swapRecords(dest, content, aside, restorePlan(dest, content, notTaken))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** The folders a restore leaves where they are: the home itself (`''`) and every folder above something a backup leaves out. */
function holders(kept: readonly string[]): Set<string> {
  const found = new Set([''])
  for (const path of kept) for (let end = path.indexOf('/'); end > 0; end = path.indexOf('/', end + 1)) found.add(path.slice(0, end))
  return found
}

/**
 * What a restore moves, as paths inside the home, each a whole entry of a folder that stays: `out` the home's records,
 * `into` the archive's. What a backup leaves out is in neither list, in the home or in the archive, and neither is a
 * record no backup holds: one whose name zip cannot be given, or one in `notTaken`, so a restore never deletes a record
 * it cannot give back.
 */
function restorePlan(dest: string, content: string, notTaken: readonly string[] = []): { out: string[]; into: string[] } {
  const { kept, skipped } = homeContents(dest)
  const keep = new Set([...kept, ...skipped, ...notTaken.map((path) => path.replace(/\/$/, ''))])
  const stay = holders([...keep])
  const entries = (root: string, folder: string) =>
    readdirSync(join(root, folder))
      .map((name) => (folder ? `${folder}/${name}` : name))
      .filter((path) => !keep.has(path) && !stay.has(path) && !leftOut(path))
  const out: string[] = []
  const into: string[] = []
  for (const folder of stay) {
    out.push(...entries(dest, folder))
    const there = lstatSync(join(content, folder), { throwIfNoEntry: false })
    if (!there) continue
    if (!there.isDirectory()) throw Error(`That backup has a file at ${folder}, where the home has a folder of what backups leave out. Nothing was changed.`)
    into.push(...entries(content, folder))
  }
  return { out, into }
}

const moved = (from: string, to: string): boolean => {
  try {
    mkdirSync(dirname(to), { recursive: true })
    renameSync(from, to)
    return true
  } catch {
    return false
  }
}

/** Removes `folder` when it holds nothing but empty folders, and says whether it is gone. */
function removeEmpty(folder: string): boolean {
  try {
    if (!lstatSync(folder, { throwIfNoEntry: false })) return true
    for (const entry of readdirSync(folder, { withFileTypes: true })) if (!entry.isDirectory() || !removeEmpty(join(folder, entry.name))) return false
    rmdirSync(folder)
    return true
  } catch {
    return false
  }
}

function swapRecords(dest: string, content: string, aside: string, { out, into }: { out: string[]; into: string[] }): void {
  const setAside: string[] = []
  const movedIn: string[] = []
  try {
    for (const path of out) {
      mkdirSync(dirname(join(aside, path)), { recursive: true })
      renameSync(join(dest, path), join(aside, path))
      setAside.push(path)
    }
    for (const path of into) {
      renameSync(join(content, path), join(dest, path))
      movedIn.push(path)
    }
  } catch (error) {
    // The archive's records go back to its unpacked copy, then the home's own back into the home.
    for (const path of movedIn.reverse()) moved(join(dest, path), join(content, path))
    const stuck = setAside.reverse().filter((path) => !moved(join(aside, path), join(dest, path)))
    if (stuck.length === 0 && removeEmpty(aside)) throw error
    const named = stuck.slice(0, 3).join(', ') + (stuck.length > 3 ? ` and ${stuck.length - 3} more` : '')
    throw Error(
      `The restore stopped part way (${error instanceof Error ? error.message : String(error)}) and could not put everything back. Nothing was deleted and no working copy was moved: ` +
        `what could not go back is in ${aside}, at the paths it had in the home${named ? ` (${named})` : ''}, and the home holds the rest. Move it back into ${dest}, then remove ${aside}.`,
    )
  }
  // Something a backup leaves out that was made in a record's folder while it was set aside (a new tree) goes back.
  const made = () => (lstatSync(aside, { throwIfNoEntry: false }) ? homeContents(aside).kept : [])
  for (const path of made()) if (!lstatSync(join(dest, path), { throwIfNoEntry: false })) moved(join(aside, path), join(dest, path))
  const strays = made()
  if (strays.length) throw Error(`Restored, but ${aside} holds what was made during the restore and backups leave out (${strays.slice(0, 3).join(', ')}). Move it back into ${dest}, then remove ${aside}.`)
  try {
    rmSync(aside, { recursive: true, force: true })
  } catch {
    // What is left there is only what the restore replaced; the next restore names the folder.
  }
}

const configFile = (directory: string) => join(directory, 'config.json')

/** The saved settings, with the defaults for anything missing or not valid. */
export function readBackupConfig(directory: string): BackupConfig {
  let saved: Partial<BackupConfig> = {}
  try {
    saved = JSON.parse(readFileSync(configFile(directory), 'utf8')) as Partial<BackupConfig>
  } catch {
    // Nothing saved yet, or not readable: the defaults.
  }
  const { enabled, cadence, limit } = DEFAULT_BACKUP_CONFIG
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : enabled,
    cadence: BACKUP_CADENCES.includes(saved.cadence as BackupCadence) ? (saved.cadence as BackupCadence) : cadence,
    limit: Number.isInteger(saved.limit) && saved.limit! >= 1 && saved.limit! <= BACKUP_LIMIT_MAX ? saved.limit! : limit,
  }
}

export function writeBackupConfig(directory: string, config: BackupConfig): void {
  mkdirSync(directory, { recursive: true })
  const temporary = `${configFile(directory)}.tmp`
  writeFileSync(temporary, JSON.stringify(config, null, 2))
  renameSync(temporary, configFile(directory))
}

export interface BackupsOptions {
  /** The folder to back up: the hobkin home. */
  source: string
  /** Where backups and their settings are kept. Outside `source`. */
  directory: string
  now?: () => number
  archiver?: Archiver
  /** Runs `run` after `ms` and returns how to cancel it. A timer that does not keep the process alive when not given. */
  timer?: (run: () => void, ms: number) => () => void
  log?: (line: string) => void
  /**
   * Why a restore must wait now (an agent or a routine running, hobkin answering), or null when nothing runs. A restore
   * swaps the records under a running hobkin, so it is refused while this says something.
   */
  busy?: () => string | null
}

const RETRY_MS = 15 * 60_000

/**
 * What the newest backup could not take, and what it left out as not hobkin's own, kept beside the backups so it is still
 * told after the host restarts.
 */
const skippedFile = (directory: string) => join(directory, 'skipped.json')

const isStray = (entry: unknown): entry is BackupStray => {
  const { path, bytes } = (entry ?? {}) as Partial<BackupStray>
  return typeof path === 'string' && (bytes === null || Number.isFinite(bytes))
}

function readNote(directory: string, backups: readonly BackupEntry[]): Pick<BackupState, 'skipped' | 'strays'> {
  try {
    const saved = JSON.parse(readFileSync(skippedFile(directory), 'utf8')) as { name?: unknown; paths?: unknown; strays?: unknown }
    if (typeof saved.name !== 'string' || backups[0]?.name !== saved.name) return { skipped: null, strays: null }
    const paths = Array.isArray(saved.paths) ? saved.paths.filter((path): path is string => typeof path === 'string') : []
    const strays = Array.isArray(saved.strays) ? saved.strays.filter(isStray) : []
    return {
      skipped: paths.length ? { name: saved.name, paths } : null,
      strays: strays.length ? { name: saved.name, entries: strays } : null,
    }
  } catch {
    return { skipped: null, strays: null }
  }
}

const realTimer = (run: () => void, ms: number) => {
  const handle = setTimeout(run, ms)
  handle.unref()
  return () => clearTimeout(handle)
}

/** The settings, the schedule and the one-at-a-time rule around the functions above. */
export class Backups {
  private readonly source: string
  private readonly directory: string
  private readonly clock: () => number
  private readonly archiver: Archiver
  private readonly timer: (run: () => void, ms: number) => () => void
  private readonly log: (line: string) => void
  private readonly busy: () => string | null
  private working: BackupState['busy'] = null
  private failure: string | null = null
  private next: number | null = null
  private retryAt = 0
  private cancel: (() => void) | null = null
  private closed = false

  constructor({ source, directory, now = Date.now, archiver = zipArchiver, timer = realTimer, log = () => {}, busy = () => null }: BackupsOptions) {
    this.source = source
    this.directory = directory
    this.clock = now
    this.archiver = archiver
    this.timer = timer
    this.log = log
    this.busy = busy
  }

  state(): BackupState {
    const backups = listBackups(this.directory)
    return {
      config: readBackupConfig(this.directory),
      backups,
      busy: this.working,
      lastError: this.failure,
      nextAt: this.next,
      directory: this.directory,
      ...readNote(this.directory, backups),
    }
  }

  /** Starts the schedule from the newest backup, so a host that restarts does not back up again at once. */
  start(): void {
    // A backup cut short by the host stopping left a partial file, and the stores it was copying, behind.
    for (const name of safeReaddir(this.directory)) {
      if (name.startsWith('hobkin-backup-') && (name.endsWith('.partial') || name.endsWith('.stores'))) rmSync(join(this.directory, name), { recursive: true, force: true })
    }
    this.arm()
  }

  /** Says what a backup just made could not take, and what it left out as not hobkin's own: in the state, beside the backups, and in the log. */
  private noteSkipped({ name, skipped, strays }: BackupMade): void {
    try {
      if (skipped.length || strays.length) writeFileSync(skippedFile(this.directory), JSON.stringify({ name, paths: skipped, strays }))
      else rmSync(skippedFile(this.directory), { force: true })
    } catch {
      // The backup is made; only the note of what it missed is lost, and the log still has it.
    }
    if (skipped.length) this.log(`The backup ${name} could not take ${skipped.length} file${skipped.length === 1 ? '' : 's'}: ${skipped.slice(0, 5).join(', ')}`)
    if (strays.length) this.log(`The backup ${name} left out what hobkin did not write: ${strays.slice(0, 5).map(({ path }) => path).join(', ')}`)
  }

  close(): void {
    this.closed = true
    this.cancel?.()
    this.cancel = null
  }

  setConfig(change: Partial<BackupConfig>): BackupState {
    const config = { ...readBackupConfig(this.directory), ...change }
    if (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > BACKUP_LIMIT_MAX) throw Error(`The limit is a whole number from 1 to ${BACKUP_LIMIT_MAX}.`)
    writeBackupConfig(this.directory, config)
    // A lower limit takes effect now, not at the next backup.
    if (config.enabled) pruneBackups(this.directory, config.limit)
    this.arm()
    return this.state()
  }

  async backupNow(): Promise<BackupState> {
    await this.exclusive('backup', async () => {
      this.noteSkipped(await backupNow(this.source, this.directory, this.clock(), this.archiver))
      pruneBackups(this.directory, readBackupConfig(this.directory).limit)
    })
    this.arm()
    return this.state()
  }

  /**
   * Puts the records back as a backup has them, after taking a copy of what is there. The caller has the user's
   * confirmation. Refused while anything runs (`busy`).
   */
  async restore(name: string): Promise<{ restored: string; safety: string | null }> {
    if (backupTime(name) === null) throw Error('That is not one of the backups.')
    const waiting = this.busy()
    if (waiting) throw Error(`A restore waits until nothing runs. ${waiting}`)
    let safety: string | null = null
    await this.exclusive('restore', () =>
      restoreBackup(join(this.directory, name), this.source, {
        archiver: this.archiver,
        beforeReplace: async () => {
          const made = await backupNow(this.source, this.directory, this.clock(), this.archiver, BEFORE_RESTORE)
          safety = made.name
          this.noteSkipped(made)
          return made.skipped
        },
      }),
    )
    this.arm()
    return { restored: name, safety }
  }

  private async exclusive(kind: 'backup' | 'restore', work: () => Promise<void>): Promise<void> {
    if (this.working) throw Error(`A ${this.working} is already running.`)
    this.working = kind
    try {
      await work()
      if (kind === 'backup') this.failure = null
    } catch (error) {
      if (kind === 'backup') this.failure = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      this.working = null
    }
  }

  private arm(): void {
    this.cancel?.()
    this.cancel = null
    this.next = null
    const { enabled, cadence } = readBackupConfig(this.directory)
    if (!enabled || this.closed) return
    // The copy a restore takes first counts too, so the next automatic backup comes a whole cadence after a restore, and
    // its pruning never follows the restore at once and takes the backup it restored from.
    const last = listBackups(this.directory)[0]?.at ?? null
    const now = this.clock()
    this.next = Math.max(nextRunAt(last, cadence, now), this.retryAt)
    this.cancel = this.timer(() => void this.tick(), Math.max(0, this.next - now))
  }

  private async tick(): Promise<void> {
    try {
      if (this.working) throw Error(`A ${this.working} is already running.`)
      await this.exclusive('backup', async () => {
        this.noteSkipped(await backupNow(this.source, this.directory, this.clock(), this.archiver))
        pruneBackups(this.directory, readBackupConfig(this.directory).limit)
      })
      this.retryAt = 0
    } catch (error) {
      this.retryAt = this.clock() + Math.min(RETRY_MS, intervalMs(readBackupConfig(this.directory).cadence))
      this.log(`Automatic backup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.arm()
  }
}

const safeReaddir = (directory: string): string[] => {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}
