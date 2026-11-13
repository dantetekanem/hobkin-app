import assert from 'node:assert/strict'
import fs, { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test, type TestContext } from 'node:test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { backupName, backupNow, Backups, backupTime, homeContents, leftOut, listBackups, nextRunAt, pruneBackups, readBackupConfig, restoreBackup, writeBackupConfig, zipArchiver, type Archiver } from '../src/backup.ts'
import { Client, hostFor, temporaryDirectory } from './support.ts'

// Every path here is a temp directory. Nothing touches a real hobkin home.
const AT = Date.UTC(2026, 10, 12, 22, 30, 0)

function home(t: import('node:test').TestContext) {
  const base = temporaryDirectory(t)
  const source = join(base, 'home')
  mkdirSync(join(source, 'sessions'), { recursive: true })
  mkdirSync(join(source, 'client'), { recursive: true })
  mkdirSync(join(source, 'runtime.lock'), { recursive: true })
  writeFileSync(join(source, 'config.json'), '{"a":1}')
  writeFileSync(join(source, 'sessions', 'one.jsonl'), 'hello\n')
  writeFileSync(join(source, 'client', 'host.json'), '{"pid":1}')
  return { base, source, directory: join(base, 'home-backups') }
}

/** Records what it was asked and writes a small file instead of a zip. */
function fakeArchiver(): Archiver & { created: string[]; extracted: string[]; fail: boolean } {
  const archiver = {
    created: [] as string[],
    extracted: [] as string[],
    fail: false,
    async create(source: string, archive: string) {
      if (archiver.fail) throw Error('disk full')
      archiver.created.push(source)
      writeFileSync(archive, 'zip')
    },
    async extract(archive: string, into: string) {
      archiver.extracted.push(archive)
      mkdirSync(join(into, 'home'), { recursive: true })
      writeFileSync(join(into, 'home', 'from-backup.txt'), 'restored')
    },
  }
  return archiver
}

test('names sort in time order and read back to the same moment', () => {
  assert.equal(backupName(AT), 'hobkin-backup-2026-11-12T22-30-00.zip')
  assert.equal(backupName(AT, '-before-restore'), 'hobkin-backup-2026-11-12T22-30-00-before-restore.zip')
  assert.equal(backupTime(backupName(AT)), AT)
  assert.equal(backupTime('hobkin-backup-2026-11-12T22-30-00.zip.partial'), null)
  assert.equal(backupTime('notes.zip'), null)
})

test('the next run is one cadence after the last backup, and now when none or overdue', () => {
  const hour = 3_600_000
  assert.equal(nextRunAt(null, 'daily', AT), AT)
  assert.equal(nextRunAt(AT - hour / 2, 'hourly', AT), AT + hour / 2)
  assert.equal(nextRunAt(AT - 25 * hour, 'daily', AT), AT)
  assert.equal(nextRunAt(AT - hour, 'daily', AT), AT + 23 * hour)
})

test('pruning keeps the newest N, ignores other files, and never goes below one', (t) => {
  const { base } = home(t)
  const directory = join(base, 'b')
  mkdirSync(directory)
  for (let hour = 0; hour < 5; hour++) writeFileSync(join(directory, backupName(AT + hour * 3_600_000)), 'x')
  writeFileSync(join(directory, 'config.json'), '{}')
  writeFileSync(join(directory, 'stranger.zip'), 'x')
  assert.equal(listBackups(directory).length, 5)
  const removed = pruneBackups(directory, 2)
  assert.deepEqual(removed.sort(), [backupName(AT), backupName(AT + 3_600_000), backupName(AT + 7_200_000)])
  assert.deepEqual(listBackups(directory).map(({ at }) => at), [AT + 4 * 3_600_000, AT + 3 * 3_600_000])
  assert.ok(existsSync(join(directory, 'stranger.zip')) && existsSync(join(directory, 'config.json')))
  pruneBackups(directory, 0)
  assert.equal(listBackups(directory).length, 1)
})

test('a backup lands under the time\'s name, a second one in the same second gets the next, and a failure leaves nothing', async (t) => {
  const { source, directory } = home(t)
  const archiver = fakeArchiver()
  const first = await backupNow(source, directory, AT, archiver)
  const second = await backupNow(source, directory, AT + 400, archiver)
  assert.equal(first.name, 'hobkin-backup-2026-11-12T22-30-00.zip')
  assert.equal(second.name, 'hobkin-backup-2026-11-12T22-30-01.zip')
  archiver.fail = true
  await assert.rejects(backupNow(source, directory, AT + 60_000, archiver), /disk full/)
  assert.deepEqual(readdirSync(directory).sort(), [first.name, second.name])
})

test('a backups folder inside the home is refused', async (t) => {
  const { source } = home(t)
  await assert.rejects(backupNow(source, join(source, 'backups'), AT, fakeArchiver()), /outside/)
})

test('a real zip round trip restores the home and keeps the running process\'s own files', async (t) => {
  const { source, directory } = home(t)
  const entry = await backupNow(source, directory, AT)
  assert.ok(entry.bytes > 0)
  symlinkSync('config.json', join(source, 'link'))
  // Change the home after the backup: the restore must undo this.
  writeFileSync(join(source, 'config.json'), '{"a":2}')
  writeFileSync(join(source, 'new.txt'), 'later')
  writeFileSync(join(source, 'client', 'host.json'), '{"pid":2}')
  await restoreBackup(join(directory, entry.name), source)
  assert.equal(readFileSync(join(source, 'config.json'), 'utf8'), '{"a":1}')
  assert.equal(readFileSync(join(source, 'sessions', 'one.jsonl'), 'utf8'), 'hello\n')
  assert.equal(existsSync(join(source, 'new.txt')), false)
  // Left out of the archive; the live ones stay.
  assert.equal(readFileSync(join(source, 'client', 'host.json'), 'utf8'), '{"pid":2}')
  assert.ok(existsSync(join(source, 'runtime.lock')))
  assert.deepEqual(readdirSync(join(source, '..')).filter((name) => name.includes('restoring') || name.includes('replaced')), [])
})

test('a bad archive changes nothing', async (t) => {
  const { source, directory } = home(t)
  mkdirSync(directory, { recursive: true })
  const bad = join(directory, backupName(AT))
  writeFileSync(bad, 'not a zip')
  await assert.rejects(restoreBackup(bad, source))
  assert.equal(readFileSync(join(source, 'config.json'), 'utf8'), '{"a":1}')
  assert.deepEqual(readdirSync(join(source, '..')).sort(), ['home', 'home-backups'])
})

test('the engine saves settings, backs up on its schedule from the last backup, prunes, and backs off after a failure', async (t) => {
  const { source, directory } = home(t)
  const archiver = fakeArchiver()
  let now = AT
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = []
  const engine = new Backups({
    source,
    directory,
    archiver,
    now: () => now,
    timer: (run, ms) => {
      const timer = { run, ms, cancelled: false }
      timers.push(timer)
      return () => (timer.cancelled = true)
    },
  })
  engine.start()
  assert.deepEqual(engine.state().config, { enabled: false, cadence: 'daily', limit: 10 })
  assert.equal(timers.length, 0, 'off by default: nothing is scheduled')

  // Turning it on with nothing backed up yet schedules one at once.
  engine.setConfig({ enabled: true, cadence: 'hourly', limit: 2 })
  assert.deepEqual(readBackupConfig(directory), { enabled: true, cadence: 'hourly', limit: 2 })
  assert.equal(timers.at(-1)!.ms, 0)
  const tick = async () => {
    const timer = timers.at(-1)!
    timer.run()
    // The tick is asynchronous: let it finish.
    for (let i = 0; i < 50 && engine.state().busy; i++) await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
  }
  await tick()
  assert.equal(engine.state().backups.length, 1)
  // Next one is an hour after the last backup.
  assert.equal(timers.at(-1)!.ms, 3_600_000)
  assert.equal(engine.state().nextAt, AT + 3_600_000)

  for (let hour = 1; hour <= 3; hour++) {
    now = AT + hour * 3_600_000
    await tick()
  }
  const kept = engine.state().backups
  assert.equal(kept.length, 2, 'pruned to the limit')
  assert.equal(kept[0]!.at, AT + 3 * 3_600_000)

  // A failure is reported, and the next try waits instead of running again at once.
  archiver.fail = true
  now += 3_600_000
  await tick()
  assert.match(engine.state().lastError ?? '', /disk full/)
  assert.equal(timers.at(-1)!.ms, 15 * 60_000)
  archiver.fail = false
  now += 15 * 60_000
  await tick()
  assert.equal(engine.state().lastError, null)

  // A restarted host reads the newest backup instead of running again.
  const newest = engine.state().backups[0]!.at
  engine.close()
  const again = new Backups({ source, directory, archiver, now: () => newest + 600_000, timer: (run, ms) => (timers.push({ run, ms, cancelled: false }), () => {}) })
  again.start()
  assert.equal(timers.at(-1)!.ms, 3_600_000 - 600_000)

  // Turning it off cancels the schedule.
  again.setConfig({ enabled: false })
  assert.equal(again.state().nextAt, null)
  assert.throws(() => again.setConfig({ limit: 0 }), /limit/)
})

test('a restore takes a copy of the current data first, and only one thing runs at a time', async (t) => {
  const { source, directory } = home(t)
  const archiver = fakeArchiver()
  const engine = new Backups({ source, directory, archiver, now: () => AT, timer: () => () => {} })
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, backupName(AT - 86_400_000)), 'zip')
  const restoring = engine.restore(backupName(AT - 86_400_000))
  await assert.rejects(engine.backupNow(), /restore is already running/)
  await assert.rejects(engine.restore(backupName(AT - 86_400_000)), /already running/)
  const done = await restoring
  assert.equal(done.safety, backupName(AT, '-before-restore'))
  assert.equal(readFileSync(join(source, 'from-backup.txt'), 'utf8'), 'restored')
  await assert.rejects(engine.restore('../../etc/passwd'), /not one of the backups/)
  assert.equal(engine.state().busy, null)
})

test('the commands work through the host, and restore needs its confirmation', async (t) => {
  const base = temporaryDirectory(t)
  const archiver = fakeArchiver()
  const host = await hostFor(t, { backupsDir: join(base, 'kept'), backupArchiver: archiver })
  const client = await Client.connect(host)
  t.after(() => client.close())
  const listed = await client.run('backup.list', {})
  assert.deepEqual((listed as { config: unknown }).config, { enabled: false, cadence: 'daily', limit: 10 })
  const configured = await client.command('backup.config', { limit: 3, cadence: 'hourly' })
  assert.equal(configured.ok && (configured.value as { config: { limit: number } }).config.limit, 3)
  assert.equal((await client.command('backup.config', {})).ok, false)
  assert.equal((await client.command('backup.config', { limit: 0 })).ok, false)
  const made = await client.run('backup.now', {})
  assert.equal((made as { backups: unknown[] }).backups.length, 1)
  const name = (made as { backups: { name: string }[] }).backups[0]!.name
  const unconfirmed = await client.command('backup.restore', { name })
  assert.equal(!unconfirmed.ok && unconfirmed.error.code, 'invalid-arguments')
  assert.equal((await client.command('backup.restore', { name: '../x.zip', confirm: true })).ok, false)
  assert.equal(archiver.extracted.length, 0)
})

/** A home with hobkin's own records, and beside them everything a backup leaves out. */
function fullHome(t: import('node:test').TestContext) {
  const made = home(t)
  const put = (path: string, text = 'x') => {
    mkdirSync(join(made.source, path, '..'), { recursive: true })
    writeFileSync(join(made.source, path), text)
  }
  const records = [
    'config.json', 'memory.md', 'decisions.jsonl', 'sessions/one.jsonl', 'notes/a.md', 'reports/r.md', 'routines/daily/check.md',
    'hobkins/a1b2c3d4.jsonl', 'canvas/state.json', 'runtime/hobkin.sqlite', 'runtime/view.json', 'runtime/handoffs/job.md',
    'runtime/handoffs/job.report.md', 'runtime/handoffs/sessions.jsonl', 'client/reviews/r.json', 'client/titles.json',
    'work/app/items.jsonl', 'work/app/project.md', 'work/app/prs/1.json',
  ]
  const leftOutOfIt = [
    'work/app/trees/3fa9c1/node_modules/big.js', 'work/app/trees/3fa9c1/src/app.ts', 'work/app/runs/r1/home/file', 'work/app/reviews/c1/file',
    'work/app/releases/v1/out.tgz', 'work/app/release-1-evidence/shot.png', 'runtime/handoffs/job.artifacts/out.bin',
    'runtime/handoffs/job.evidence/log.txt', 'runtime/handoffs/no-f9f3-evidence/log.txt', 'runtime/.qmd/index.sqlite',
    'client/review-trees/t1/file', 'jobs/1.jsonl',
  ]
  for (const path of [...records, ...leftOutOfIt]) put(path, `was ${path}`)
  mkdirSync(join(made.source, 'schedules'), { recursive: true })
  return { ...made, put, records, leftOutOfIt }
}

test("a backup holds hobkin's own records, and leaves out working copies, artifacts, run transcripts and indexes", async (t) => {
  const { source, directory, records, leftOutOfIt } = fullHome(t)
  const entry = await backupNow(source, directory, AT)
  const inside = execFileSync('unzip', ['-Z1', join(directory, entry.name)], { encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const path of records) assert.ok(inside.includes(`home/${path}`), `${path} is a record`)
  for (const path of leftOutOfIt) assert.equal(inside.includes(`home/${path}`), false, `${path} is left out`)
  assert.equal(inside.some((name) => /node_modules|review-trees|\.qmd|jobs\//.test(name)), false)
  // An empty folder hobkin made is a record of nothing, and still comes back.
  assert.ok(inside.includes('home/schedules/'))
  // The two files of the running process stay out, as before.
  assert.equal(inside.some((name) => name === 'home/client/host.json' || name.startsWith('home/runtime.lock')), false)

  // The rule itself, by path inside the home.
  for (const path of ['work/app/trees', 'work/app/runs/r1', 'work/app/reviews', 'work/app/releases', 'client/review-trees', 'jobs', 'runtime/.qmd', 'runtime/handoffs/x.artifacts', 'runtime/handoffs/x.evidence', 'work/app/release-1-evidence', 'runtime.lock', 'client/host.json']) {
    assert.equal(leftOut(path), true, path)
  }
  for (const path of ['work', 'work/app', 'work/app/items.jsonl', 'work/app/prs', 'work/app/runs', 'client', 'client/reviews', 'runtime', 'runtime/handoffs', 'runtime/handoffs/job.md', 'sessions', 'hobkins', 'notes/trees', 'reviews', 'evidence.md']) {
    assert.equal(leftOut(path), false, path)
  }
})

test('a restore puts the records back and keeps everything a backup leaves out as the home has it now', async (t) => {
  const { source, directory, put, leftOutOfIt } = fullHome(t)
  const entry = await backupNow(source, directory, AT)

  // After the backup: records change, and so does what the backup never held.
  put('sessions/one.jsonl', 'changed since')
  put('notes/new.md', 'written since')
  put('work/app/trees/3fa9c1/src/app.ts', 'edited by an agent since')
  put('work/app/trees/9c2e77/new-tree.ts', 'a tree made since')
  put('jobs/2.jsonl', 'a run since')

  await restoreBackup(join(directory, entry.name), source)

  // The records are the backup's.
  assert.equal(readFileSync(join(source, 'sessions/one.jsonl'), 'utf8'), 'was sessions/one.jsonl')
  assert.equal(existsSync(join(source, 'notes/new.md')), false)
  assert.equal(readFileSync(join(source, 'work/app/items.jsonl'), 'utf8'), 'was work/app/items.jsonl')
  // What a backup leaves out is exactly what the home had when it was restored: nothing of it is lost or rolled back.
  assert.equal(readFileSync(join(source, 'work/app/trees/3fa9c1/src/app.ts'), 'utf8'), 'edited by an agent since')
  assert.equal(readFileSync(join(source, 'work/app/trees/9c2e77/new-tree.ts'), 'utf8'), 'a tree made since')
  assert.equal(readFileSync(join(source, 'jobs/2.jsonl'), 'utf8'), 'a run since')
  for (const path of leftOutOfIt.filter((each) => each !== 'work/app/trees/3fa9c1/src/app.ts')) assert.equal(readFileSync(join(source, path), 'utf8'), `was ${path}`, path)
  assert.deepEqual(readdirSync(join(source, '..')).filter((name) => name.includes('restoring') || name.includes('replaced')), [])
})

test("a run's brief and report are records, and what the run left beside them is not", () => {
  const run = '0d7c6c26-98ec-4294-a32e-39af637168ab'
  for (const path of [`work/app/runs/${run}.md`, `work/app/runs/${run}.report.md`]) assert.equal(leftOut(path), false, path)
  for (const path of [`work/app/runs/${run}-artifacts`, `work/app/runs/${run}.artifacts`, 'work/app/runs/0d7c6c26-evidence', `work/app/runs/${run}-review`, `work/app/runs/${run}-preview.log`, `work/app/runs/${run}-acceptance.md`, 'runtime/handoffs/job-artifacts']) {
    assert.equal(leftOut(path), true, path)
  }
})

/** Every file, folder and link under `folder` by its path, with what it holds. A link is read, never followed. */
function snapshot(folder: string): Record<string, string> {
  const found: Record<string, string> = {}
  if (!existsSync(folder)) return found
  const walk = (at: string) => {
    for (const entry of readdirSync(join(folder, at), { withFileTypes: true })) {
      const path = at ? `${at}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) found[path] = `-> ${readlinkSync(join(folder, path))}`
      else if (entry.isDirectory()) (found[`${path}/`] = 'folder'), walk(path)
      else found[path] = readFileSync(join(folder, path), 'utf8')
    }
  }
  walk('')
  return found
}

/**
 * Puts a stand-in for `renameSync` under the code for the rest of the test, the way a failing disk would behave: the n-th
 * rename from now throws when `fails(n)` says so. `check` runs before each one. Returns the renames asked for, and how to stop.
 */
function renames(t: TestContext, fails: (n: number) => boolean, check: (from: string) => void = () => {}) {
  const real = fs.renameSync
  const asked: [string, string][] = []
  const stop = () => {
    fs.renameSync = real
    syncBuiltinESMExports()
  }
  fs.renameSync = ((from: string, to: string) => {
    check(from)
    asked.push([from, to])
    if (fails(asked.length)) throw Object.assign(Error(`EIO: i/o error, rename '${from}'`), { code: 'EIO' })
    real(from, to)
  }) as typeof fs.renameSync
  syncBuiltinESMExports()
  t.after(stop)
  return { asked, stop }
}

/** A home as `fullHome` makes it, changed since its backup was taken, and that backup. */
async function homeChangedSince(t: TestContext) {
  const made = fullHome(t)
  const entry = await backupNow(made.source, made.directory, AT)
  made.put('sessions/one.jsonl', 'changed since')
  made.put('notes/new.md', 'written since')
  made.put('work/app/trees/3fa9c1/src/app.ts', 'edited by an agent since')
  made.put('jobs/2.jsonl', 'a run since')
  return { ...made, archive: join(made.directory, entry.name) }
}

const leftBeside = (source: string) => readdirSync(join(source, '..')).filter((name) => name.endsWith('.restoring') || name.endsWith('.replaced'))

test('a restore that fails at any one step puts the home back exactly as it was', async (t) => {
  const clean = await homeChangedSince(t)
  const counting = renames(t, () => false)
  await restoreBackup(clean.archive, clean.source)
  counting.stop()
  const steps = counting.asked.length
  assert.ok(steps > 10, `${steps} renames`)
  for (let step = 1; step <= steps; step++) {
    const { source, archive } = await homeChangedSince(t)
    const before = snapshot(source)
    const failing = renames(t, (n) => n === step)
    await assert.rejects(restoreBackup(archive, source), /EIO/, `step ${step}`)
    failing.stop()
    assert.deepEqual(snapshot(source), before, `step ${step}`)
    assert.deepEqual(leftBeside(source), [], `step ${step}`)
  }
})

test('a restore that fails and cannot put things back deletes nothing, and its error says where the pieces are', async (t) => {
  const clean = await homeChangedSince(t)
  const counting = renames(t, () => false)
  await restoreBackup(clean.archive, clean.source)
  counting.stop()
  for (let step = 1; step <= counting.asked.length; step++) {
    const { source, archive } = await homeChangedSince(t)
    const before = snapshot(source)
    const kept = homeContents(source).kept
    // From this step on every rename fails, the ones that would put things back too.
    const failing = renames(t, (n) => n >= step)
    const error: Error = await restoreBackup(archive, source).then(() => assert.fail(`step ${step} went through`), (failure: Error) => failure)
    failing.stop()
    const home = snapshot(source)
    const aside = snapshot(`${source}.replaced`)
    if (Object.keys(aside).some((path) => !path.endsWith('/'))) assert.ok(error.message.includes(`${source}.replaced`), `step ${step}: ${error.message}`)
    for (const [path, held] of Object.entries(before)) {
      if (path.endsWith('/')) continue
      // What a backup leaves out never leaves its place; each record is in the home or set aside, as it was.
      if (kept.some((each) => path.startsWith(`${each}/`) || path === each)) assert.equal(home[path], held, `step ${step}: ${path}`)
      else assert.ok(home[path] === held || aside[path] === held, `step ${step}: ${path} is lost`)
    }
  }
})

test('every working copy stays at its path through every step of a restore', async (t) => {
  const { source, archive } = await homeChangedSince(t)
  const kept = homeContents(source).kept.map((path) => join(source, path))
  const tree = join(source, 'work/app/trees/3fa9c1/src/app.ts')
  let missing = 0
  const watching = renames(t, () => false, () => void (existsSync(tree) && existsSync(join(source, 'jobs/2.jsonl')) ? 0 : missing++))
  await restoreBackup(archive, source)
  watching.stop()
  assert.equal(missing, 0, 'an agent working in a tree would have lost its folder for a moment')
  for (const [from, to] of watching.asked) assert.equal(kept.some((path) => from === path || from.startsWith(`${path}/`) || to === path), false, `${from} -> ${to}`)
  assert.equal(readFileSync(tree, 'utf8'), 'edited by an agent since')
})

test('what an agent makes in a record folder while the restore sets it aside goes back into the home', async (t) => {
  const { source, archive } = await homeChangedSince(t)
  const prs = join(source, 'work/app/prs')
  // Just before that folder is set aside, an agent leaves evidence in it.
  const watching = renames(t, () => false, (from) => {
    if (from === prs) mkdirSync(join(prs, '9-evidence'), { recursive: true }), writeFileSync(join(prs, '9-evidence/shot.png'), 'made during the restore')
  })
  await restoreBackup(archive, source)
  watching.stop()
  assert.equal(readFileSync(join(prs, '9-evidence/shot.png'), 'utf8'), 'made during the restore')
  assert.equal(readFileSync(join(prs, '1.json'), 'utf8'), 'was work/app/prs/1.json')
  assert.deepEqual(leftBeside(source), [])
})

test('a restore never deletes what an unfinished one left beside the home', async (t) => {
  const { source, archive } = await homeChangedSince(t)
  // A restore cut short in the middle leaves the home's own records here, and they may be the only copy.
  mkdirSync(`${source}.replaced/sessions`, { recursive: true })
  writeFileSync(`${source}.replaced/sessions/lost.jsonl`, 'the only copy')
  const before = snapshot(source)
  await assert.rejects(restoreBackup(archive, source), (error: Error) => error.message.includes(`${source}.replaced`))
  assert.equal(readFileSync(`${source}.replaced/sessions/lost.jsonl`, 'utf8'), 'the only copy')
  assert.deepEqual(snapshot(source), before)
  // What a restore unpacks is only ever a copy of the archive, so one left behind is cleared and the restore goes ahead.
  rmSync(`${source}.replaced`, { recursive: true })
  mkdirSync(`${source}.restoring/home`, { recursive: true })
  writeFileSync(`${source}.restoring/home/stale.txt`, 'from an earlier try')
  await restoreBackup(archive, source)
  assert.equal(readFileSync(join(source, 'sessions/one.jsonl'), 'utf8'), 'was sessions/one.jsonl')
  assert.equal(existsSync(join(source, 'stale.txt')), false)
  assert.deepEqual(leftBeside(source), [])
})

test('what a backup leaves out stays as the home has it now, whatever the archive holds of it', async (t) => {
  const { base, source, directory, put } = fullHome(t)
  // An older backup of the whole home held working copies, transcripts and the process files itself.
  const whole = join(base, 'whole')
  cpSync(source, join(whole, 'home'), { recursive: true })
  for (const [path, text] of [['work/app/trees/old-tree/file', 'old tree'], ['jobs/old.jsonl', 'old run'], ['work/gone/trees/t/file', 'gone tree'], ['work/gone/items.jsonl', 'gone items'], ['client/host.json', '{"pid":0}']]) {
    mkdirSync(join(whole, 'home', path, '..'), { recursive: true })
    writeFileSync(join(whole, 'home', path), text!)
  }
  const archive = join(directory, backupName(AT))
  mkdirSync(directory, { recursive: true })
  writeFileSync(archive, 'zip')
  const unpacking: Archiver = { create: async () => {}, extract: async (_archive, into) => cpSync(whole, into, { recursive: true }) }
  // Since then: a project with its own tree, and the review checkouts moved to another disk behind a link.
  put('work/new/items.jsonl', 'new items')
  put('work/new/trees/t/file', 'new tree')
  mkdirSync(join(base, 'elsewhere'))
  writeFileSync(join(base, 'elsewhere', 'file'), 'on another disk')
  rmSync(join(source, 'client/review-trees'), { recursive: true })
  symlinkSync(join(base, 'elsewhere'), join(source, 'client/review-trees'))
  const keptBefore = (home: Record<string, string>, kept: string[]) => Object.entries(home).filter(([path]) => kept.some((each) => path === each || path.startsWith(`${each}/`)))
  const kept = homeContents(source).kept
  const before = keptBefore(snapshot(source), kept)

  await restoreBackup(archive, source, { archiver: unpacking })

  assert.deepEqual(keptBefore(snapshot(source), kept), before, 'the live ones win, and nothing of the archive is merged into them')
  assert.equal(readFileSync(join(source, 'work/gone/items.jsonl'), 'utf8'), 'gone items')
  assert.equal(existsSync(join(source, 'work/gone/trees')), false, 'a working copy the home does not have is not brought back')
  assert.equal(existsSync(join(source, 'work/new/items.jsonl')), false)
  assert.equal(readFileSync(join(source, 'work/new/trees/t/file'), 'utf8'), 'new tree')
  assert.equal(readlinkSync(join(source, 'client/review-trees')), join(base, 'elsewhere'))
  assert.equal(readFileSync(join(base, 'elsewhere', 'file'), 'utf8'), 'on another disk')
  assert.equal(readFileSync(join(source, 'client/host.json'), 'utf8'), '{"pid":1}')
})

test('the zip takes names as they are, empty folders, and links as links, and a restore brings them all back', async (t) => {
  const { source, directory } = home(t)
  const odd = ['with space.txt', ' leading space', 'trailing space ', 'quote"d', "apos'd", 'café ünï', '-dash', 'star*', 'br[1]', 'back\\slash']
  mkdirSync(join(source, 'notes'))
  for (const name of odd) writeFileSync(join(source, 'notes', name), `named ${name}`)
  mkdirSync(join(source, 'empty'))
  symlinkSync('config.json', join(source, 'to-file'))
  symlinkSync('sessions', join(source, 'to-folder'))
  const entry = await backupNow(source, directory, AT)
  const inside = execFileSync('unzip', ['-Z1', join(directory, entry.name)], { encoding: 'utf8' }).split('\n').filter(Boolean)
  for (const name of odd) assert.ok(inside.includes(`home/notes/${name}`), name)
  for (const name of ['home/empty/', 'home/to-file', 'home/to-folder']) assert.ok(inside.includes(name), name)
  assert.equal(inside.includes('home/to-folder/one.jsonl'), false, 'a link to a folder is not followed')
  for (const name of ['notes', 'empty', 'to-file', 'to-folder']) rmSync(join(source, name), { recursive: true })

  await restoreBackup(join(directory, entry.name), source)
  for (const name of odd) assert.equal(readFileSync(join(source, 'notes', name), 'utf8'), `named ${name}`, name)
  assert.ok(lstatSync(join(source, 'empty')).isDirectory())
  assert.equal(readlinkSync(join(source, 'to-file')), 'config.json')
  assert.equal(readlinkSync(join(source, 'to-folder')), 'sessions')
})

test('a home with no records still backs up, and restoring that backup takes only the records away', async (t) => {
  const base = temporaryDirectory(t)
  const source = join(base, 'home')
  mkdirSync(join(source, 'runtime.lock'), { recursive: true })
  const entry = await backupNow(source, join(base, 'kept'), AT)
  assert.deepEqual(execFileSync('unzip', ['-Z1', join(base, 'kept', entry.name)], { encoding: 'utf8' }).split('\n').filter(Boolean), ['home/'])
  writeFileSync(join(source, 'config.json'), '{}')
  mkdirSync(join(source, 'work/app/trees/t'), { recursive: true })
  writeFileSync(join(source, 'work/app/trees/t/file'), 'a tree')
  await restoreBackup(join(base, 'kept', entry.name), source)
  assert.equal(existsSync(join(source, 'config.json')), false)
  assert.equal(readFileSync(join(source, 'work/app/trees/t/file'), 'utf8'), 'a tree')
  assert.ok(existsSync(join(source, 'runtime.lock')))
})

test('a file that goes away between the walk and the zip is left out, and the backup is still made', async (t) => {
  const { base, source } = home(t)
  const archive = join(base, 'a.zip')
  await zipArchiver.create(source, archive, ['config.json', 'gone.txt'])
  assert.deepEqual(execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n').filter(Boolean).sort(), ['home/', 'home/config.json'])
})

test('fifty thousand names all reach the zip', async (t) => {
  const { source, directory } = home(t)
  mkdirSync(join(source, 'notes'))
  for (let i = 0; i < 50_000; i++) writeFileSync(join(source, 'notes', `note-${i}.md`), String(i))
  const entry = await backupNow(source, directory, AT)
  const inside = execFileSync('unzip', ['-Z1', join(directory, entry.name)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n')
  assert.equal(inside.filter((name) => name.startsWith('home/notes/note-')).length, 50_000)
})

const gitIn = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' }).trim()
const archived = (archive: string) => execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)

test("hobkin's own clones and every other git checkout in the home stay out, and a tree made after the backup still works after a restore", async (t) => {
  const { source, directory } = home(t)
  const repo = join(source, 'work/app/repo')
  mkdirSync(repo, { recursive: true })
  gitIn(repo, 'init', '-q', '-b', 'main')
  gitIn(repo, 'commit', '-q', '--allow-empty', '-m', 'base')
  gitIn(repo, 'worktree', 'add', '-q', '-b', 'hobkin/old', join(source, 'work/app/trees/old'), 'main')
  // A change review's own clone, and a checkout where no rule names one.
  const review = join(source, 'client/review-clones/acme/api')
  const stray = join(source, 'notes/checkout')
  for (const folder of [review, stray]) {
    mkdirSync(folder, { recursive: true })
    gitIn(folder, 'init', '-q', '-b', 'main')
    gitIn(folder, 'commit', '-q', '--allow-empty', '-m', 'base')
  }
  writeFileSync(join(source, 'work/app/items.jsonl'), 'was items')
  const entry = await backupNow(source, directory, AT)
  const inside = archived(join(directory, entry.name))
  assert.ok(inside.includes('home/work/app/items.jsonl'))
  assert.deepEqual(inside.filter((name) => /\/(?:repo|review-clones|checkout|\.git)(?:\/|$)/.test(name)), [])
  for (const path of ['work/app/repo', 'client/review-clones']) assert.equal(leftOut(path), true, path)

  // After the backup an agent finishes a change in a new tree, and the other checkout gets a commit.
  const tree = join(source, 'work/app/trees/new')
  gitIn(repo, 'worktree', 'add', '-q', '-b', 'hobkin/new', tree, 'main')
  writeFileSync(join(tree, 'fix.txt'), 'the fix\n')
  gitIn(tree, 'add', 'fix.txt')
  gitIn(tree, 'commit', '-q', '-m', 'finished change')
  const sha = gitIn(repo, 'rev-parse', 'hobkin/new')
  gitIn(stray, 'commit', '-q', '--allow-empty', '-m', 'since')
  writeFileSync(join(source, 'work/app/items.jsonl'), 'changed since')

  await restoreBackup(join(directory, entry.name), source)
  assert.equal(readFileSync(join(source, 'work/app/items.jsonl'), 'utf8'), 'was items')
  assert.equal(gitIn(repo, 'rev-parse', 'hobkin/new'), sha)
  assert.equal(gitIn(tree, 'status', '--porcelain'), '')
  assert.equal(gitIn(tree, 'log', '-1', '--format=%s'), 'finished change')
  assert.equal(gitIn(stray, 'log', '-1', '--format=%s'), 'since')
  assert.equal(gitIn(review, 'log', '-1', '--format=%s'), 'base')
})

/** Lets an automatic backup that was started finish. */
async function settled(engine: Backups) {
  for (let i = 0; i < 100 && engine.state().busy; i++) await new Promise((done) => setImmediate(done))
  await new Promise((done) => setImmediate(done))
}

test('the copy a restore takes first outlives ordinary pruning, and no automatic backup follows a restore at once', async (t) => {
  const { source, directory } = home(t)
  const archiver = fakeArchiver()
  let now = AT
  const timers: { run: () => void; ms: number }[] = []
  const timer = (run: () => void, ms: number) => (timers.push({ run, ms }), () => {})
  await backupNow(source, directory, AT - 25 * 3_600_000, archiver)
  writeBackupConfig(directory, { enabled: true, cadence: 'daily', limit: 1 })
  const engine = new Backups({ source, directory, archiver, now: () => now, timer })
  engine.start()
  const [yesterday] = engine.state().backups
  const { safety } = await engine.restore(yesterday!.name)
  assert.equal(timers.at(-1)!.ms, 86_400_000, 'a whole day after the restore, not at once')
  engine.close()
  // A host started again after the restore waits as long.
  const again = new Backups({ source, directory, archiver, now: () => now, timer })
  again.start()
  assert.equal(timers.at(-1)!.ms, 86_400_000)
  now += 86_400_000
  timers.at(-1)!.run()
  await settled(again)
  const kept = again.state().backups.map(({ name }) => name)
  assert.equal(kept.length, 2, kept.join(', '))
  assert.ok(kept.includes(safety!), 'the copy from before the restore is kept past the limit of one')
  // Copies taken before restores are kept three at a time, apart from the limit.
  for (let second = 1; second <= 4; second++) writeFileSync(join(directory, backupName(now + second * 1000, '-before-restore')), 'zip')
  pruneBackups(directory, 1)
  assert.equal(listBackups(directory).filter(({ name }) => name.endsWith('-before-restore.zip')).length, 3)
  assert.equal(listBackups(directory).filter(({ name }) => !name.endsWith('-before-restore.zip')).length, 1)
  again.close()
})

/** Copies each record into a folder one at a time, the way zip reads them, and runs `between` after each one. */
function copyingArchiver(base: string, between: (path: string, source: string) => void): Archiver {
  return {
    async create(source, archive, records) {
      const held = existsSync(archive) ? readFileSync(archive, 'utf8') : join(base, `held-${randomUUID()}`)
      for (const path of records) {
        const to = join(held, basename(source), path)
        if (path.endsWith('/')) mkdirSync(to, { recursive: true })
        else mkdirSync(dirname(to), { recursive: true }), cpSync(join(source, path), to)
        between(path, source)
      }
      writeFileSync(archive, held)
    },
    async extract(archive, into) {
      cpSync(readFileSync(archive, 'utf8'), into, { recursive: true })
    },
  }
}

/** hobkin's store as it is while hobkin runs: its write-ahead log on, with rows in it not yet checkpointed. */
function liveStore(t: TestContext, source: string) {
  mkdirSync(join(source, 'runtime'), { recursive: true })
  const live = new DatabaseSync(join(source, 'runtime/hobkin.sqlite'))
  t.after(() => {
    if (live.isOpen) live.close()
  })
  live.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 1000; CREATE TABLE t (n INTEGER PRIMARY KEY, body TEXT); CREATE INDEX t_body ON t (body)')
  const insert = live.prepare('INSERT INTO t (body) VALUES (?)')
  const write = (count: number) => {
    live.exec('BEGIN')
    for (let i = 0; i < count; i++) insert.run(`row ${Math.random()} `.repeat(20))
    live.exec('COMMIT')
  }
  write(500)
  live.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  write(500)
  return { live, write }
}

const rowsIn = (file: string) => {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return {
      rows: (db.prepare('SELECT count(*) AS c FROM t').get() as { c: number }).c,
      integrity: (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
    }
  } finally {
    db.close()
  }
}

test('a backup takes each SQLite store whole even when a checkpoint falls while it reads, and leaves its write-ahead log out', async (t) => {
  const { base, source, directory } = home(t)
  const { live, write } = liveStore(t, source)
  const archiver = copyingArchiver(base, (path, from) => {
    // A checkpoint lands just after the store's main file is read, and hobkin writes on.
    if (from === source && path === 'runtime/hobkin.sqlite') live.exec('PRAGMA wal_checkpoint(RESTART)'), write(300)
  })
  const entry = await backupNow(source, directory, AT, archiver)
  const held = join(readFileSync(join(directory, entry.name), 'utf8'), 'home/runtime')
  assert.deepEqual(readdirSync(held).sort(), ['hobkin.sqlite'])
  assert.deepEqual(rowsIn(join(held, 'hobkin.sqlite')), { rows: 1000, integrity: 'ok' })
})

test('a restore never pairs the restored store with the write-ahead log of the one hobkin has open', async (t) => {
  const { source, directory } = home(t)
  const { live, write } = liveStore(t, source)
  // As in a real home, `runtime/` holds something backups leave out, so it stays and its files are swapped one by one.
  mkdirSync(join(source, 'runtime/.qmd'))
  const entry = await backupNow(source, directory, AT)
  assert.deepEqual(archived(join(directory, entry.name)).filter((name) => name.startsWith('home/runtime/') && !name.endsWith('/')), ['home/runtime/hobkin.sqlite'])
  // hobkin goes on writing after the backup, and is still open while the restore runs.
  write(50)
  await restoreBackup(join(directory, entry.name), source)
  // Then it closes, as hobkin's store closes when the host restarts.
  live.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  live.close()
  assert.deepEqual(rowsIn(join(source, 'runtime/hobkin.sqlite')), { rows: 1000, integrity: 'ok' })
})

test('a name zip cannot take, and a file it cannot read, are said, and a restore leaves both where they are', async (t) => {
  const { source, directory } = home(t)
  const notes = join(source, 'notes')
  mkdirSync(notes)
  writeFileSync(join(notes, 'icon\rname.md'), 'a name with a carriage return')
  writeFileSync(join(notes, 'locked.md'), 'nobody may read this')
  writeFileSync(join(notes, 'plain.md'), 'was plain')
  chmodSync(join(notes, 'locked.md'), 0o000)
  t.after(() => existsSync(join(notes, 'locked.md')) && chmodSync(join(notes, 'locked.md'), 0o600))
  const engine = new Backups({ source, directory, now: () => AT, timer: () => () => {} })
  const made = await engine.backupNow()
  assert.deepEqual(made.skipped?.paths.sort(), ['notes/icon\rname.md', 'notes/locked.md'])
  const name = made.backups[0]!.name
  assert.ok(archived(join(directory, name)).includes('home/notes/plain.md'))
  writeFileSync(join(notes, 'plain.md'), 'changed since')
  await engine.restore(name)
  assert.equal(readFileSync(join(notes, 'plain.md'), 'utf8'), 'was plain')
  assert.equal(readFileSync(join(notes, 'icon\rname.md'), 'utf8'), 'a name with a carriage return')
  chmodSync(join(notes, 'locked.md'), 0o600)
  assert.equal(readFileSync(join(notes, 'locked.md'), 'utf8'), 'nobody may read this')
})

test("only hobkin's own evidence and artifact folders are left out, not the user's folders named like them", () => {
  for (const path of ['memory/tax-evidence', 'notes/project.artifacts', 'notes/a/b-evidence', 'reports/x.evidence']) assert.equal(leftOut(path), false, path)
  for (const path of ['runtime/handoffs/job.evidence', 'runtime/handoffs/no-f9f3-evidence', 'runtime/handoffs/job.artifacts', 'runtime/handoffs/job-artifacts', 'work/app/release-1-evidence', 'work/app/prs/1-evidence']) {
    assert.equal(leftOut(path), true, path)
  }
})

test('a restore waits while anything runs, and changes nothing', async (t) => {
  const { source, directory } = home(t)
  const archiver = fakeArchiver()
  let running: string | null = 'An agent is working on app.'
  const engine = new Backups({ source, directory, archiver, now: () => AT, timer: () => () => {}, busy: () => running })
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, backupName(AT - 86_400_000)), 'zip')
  await assert.rejects(engine.restore(backupName(AT - 86_400_000)), /An agent is working on app/)
  assert.equal(archiver.extracted.length, 0)
  assert.equal(listBackups(directory).length, 1, 'no copy was taken either')
  running = null
  await engine.restore(backupName(AT - 86_400_000))
  assert.equal(archiver.extracted.length, 1)
})

test('a backups folder that is a link into the home is refused, and a restore never takes the backups with it', async (t) => {
  const { base, source, directory } = home(t)
  const entry = await backupNow(source, directory, AT)
  // The backups reached through a link that ends inside the home.
  mkdirSync(join(source, 'kept'))
  cpSync(join(directory, entry.name), join(source, 'kept', entry.name))
  const linked = join(base, 'linked-backups')
  symlinkSync(join(source, 'kept'), linked)
  await assert.rejects(backupNow(source, linked, AT + 1000), /outside/)
  const before = snapshot(source)
  await assert.rejects(restoreBackup(join(linked, entry.name), source), /inside/)
  assert.deepEqual(snapshot(source), before)
})
