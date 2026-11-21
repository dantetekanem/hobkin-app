import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { backupNow, Backups, homeContents, leftOut, restoreBackup, zipArchiver } from '../src/backup.ts'
import { afterTest, temporaryDirectory } from './support.ts'

// Every path here is a temp directory. Nothing touches a real hobkin home.
const AT = Date.UTC(2026, 10, 21, 17, 45, 0)
const MB = 1024 * 1024

const archived = (archive: string) => execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean)

/**
 * A Unix socket at `path`, left there the way a VM's host agent leaves its sockets. A socket's own path is limited to about
 * a hundred bytes, so it is made in a short folder and moved into place.
 */
async function socketAt(t: TestContext, path: string) {
  const short = mkdtempSync('/tmp/hk-')
  afterTest(t, () => rmSync(short, { recursive: true, force: true }))
  const server = createServer()
  await new Promise<void>((done) => server.listen(join(short, 's'), done))
  mkdirSync(dirname(path), { recursive: true })
  renameSync(join(short, 's'), path)
  await new Promise<void>((done) => server.close(() => done()))
  assert.ok(lstatSync(path).isSocket())
}

/** hobkin's own records, and beside them what agents left at the three levels: the home's root, `runtime/` and a project's folder. */
async function homeWithStrays(t: TestContext) {
  const base = temporaryDirectory(t)
  const source = join(base, 'home')
  const put = (path: string, text: string | Buffer = `was ${path}`) => {
    mkdirSync(dirname(join(source, path)), { recursive: true })
    writeFileSync(join(source, path), text)
  }
  const records = ['config.json', 'memory.md', 'AGENTS.md', 'sessions/one.jsonl', 'notes/a.md', 'runtime/view.json', 'runtime/handoffs/job.md', 'work/projects.jsonl', 'work/app/items.jsonl', 'work/app/project.md']
  for (const path of records) put(path)
  // An agent's release build at the root, a Linux VM in `runtime/` and a pack of notes in a project's folder.
  put('rpsleague-release-bbaa.mppfA9/source/big.bin', Buffer.alloc(3 * MB, 'x'))
  symlinkSync('/', join(source, 'rpsleague-release-bbaa.mppfA9/l'))
  put('runtime/rps-ee8d-build.OwUqoa8K/lima.tgz', Buffer.alloc(2 * MB, 'y'))
  await socketAt(t, join(source, 'runtime/rps-ee8d-build.OwUqoa8K/vms/rpg/default_ep.sock'))
  await socketAt(t, join(source, 'runtime/rps-ee8d-build.OwUqoa8K/vms/rpg/ssh.sock'))
  put('work/app/state-machines-20261121/accept.py')
  put('scratch.log', 'an agent wrote this here')
  const strays = ['rpsleague-release-bbaa.mppfA9', 'runtime/rps-ee8d-build.OwUqoa8K', 'scratch.log', 'work/app/state-machines-20261121']
  return { base, source, directory: join(base, 'home-backups'), put, records, strays }
}

test("what is not hobkin's own at the root, in runtime/ and in a project's folder is left out, told with its size, and is no failure", async (t) => {
  const { source, directory, records, strays } = await homeWithStrays(t)
  const engine = new Backups({ source, directory, now: () => AT, timer: () => () => {} })
  const state = await engine.backupNow()

  const inside = archived(join(directory, state.backups[0]!.name))
  for (const path of records) assert.ok(inside.includes(`home/${path}`), `${path} is hobkin's own`)
  for (const path of strays) assert.equal(inside.some((name) => name === `home/${path}` || name.startsWith(`home/${path}/`)), false, `${path} is left out`)
  assert.equal(state.skipped, null, 'nothing left out is a failure, and the sockets are not either')

  assert.equal(state.strays?.name, state.backups[0]!.name)
  const told = Object.fromEntries((state.strays?.entries ?? []).map(({ path, bytes }) => [path, bytes]))
  assert.deepEqual(Object.keys(told).sort(), strays)
  assert.ok(told['rpsleague-release-bbaa.mppfA9']! >= 3 * MB, `${told['rpsleague-release-bbaa.mppfA9']} bytes, and the link inside is not followed`)
  assert.ok(told['rpsleague-release-bbaa.mppfA9']! < 4 * MB)
  assert.ok(told['runtime/rps-ee8d-build.OwUqoa8K']! >= 2 * MB)
  // The largest come first, so the ones worth cleaning are the ones named.
  assert.deepEqual(state.strays?.entries.slice(0, 2).map(({ path }) => path), ['rpsleague-release-bbaa.mppfA9', 'runtime/rps-ee8d-build.OwUqoa8K'])

  // Told again after a restart of the host, from the note beside the backups.
  const again = new Backups({ source, directory, now: () => AT, timer: () => () => {} })
  assert.deepEqual(again.state().strays, state.strays)
  for (const path of strays) assert.equal(leftOut(path), true, path)
})

test("a socket or a named pipe in hobkin's own folders is passed over in silence, and a file of its own it cannot read is still a failure", async (t) => {
  const { source, directory } = await homeWithStrays(t)
  await socketAt(t, join(source, 'notes/live.sock'))
  execFileSync('mkfifo', [join(source, 'notes/pipe')])
  writeFileSync(join(source, 'notes/locked.md'), 'nobody may read this')
  chmodSync(join(source, 'notes/locked.md'), 0o000)
  t.after(() => existsSync(join(source, 'notes/locked.md')) && chmodSync(join(source, 'notes/locked.md'), 0o600))

  const contents = homeContents(source)
  assert.equal(contents.records.some((path) => path === 'notes/live.sock' || path === 'notes/pipe'), false)
  assert.deepEqual(contents.skipped, [])
  const made = await backupNow(source, directory, AT)
  assert.deepEqual(made.skipped, ['notes/locked.md'])
  const inside = archived(join(directory, made.name))
  assert.ok(inside.includes('home/notes/a.md'))
  assert.equal(inside.some((name) => /live\.sock|pipe/.test(name)), false)
})

test("a restore puts hobkin's records back and leaves what is not its own where it is", async (t) => {
  const { source, directory, put, strays } = await homeWithStrays(t)
  const made = await backupNow(source, directory, AT)
  put('memory.md', 'changed since')
  put('runtime/view.json', 'changed since')
  put('work/app/items.jsonl', 'changed since')
  put('rpsleague-release-bbaa.mppfA9/source/big.bin', 'the agent rebuilt it')
  put('runtime/another-build.Ab12/out.bin', 'a new stray since')
  const sockets = join(source, 'runtime/rps-ee8d-build.OwUqoa8K/vms/rpg')

  await restoreBackup(join(directory, made.name), source)

  for (const path of ['memory.md', 'runtime/view.json', 'work/app/items.jsonl']) assert.equal(readFileSync(join(source, path), 'utf8'), `was ${path}`, path)
  assert.ok(readFileSync(join(source, 'rpsleague-release-bbaa.mppfA9/source/big.bin'), 'utf8') === 'the agent rebuilt it', 'the build is as the agent left it')
  assert.equal(readFileSync(join(source, 'runtime/another-build.Ab12/out.bin'), 'utf8'), 'a new stray since')
  assert.equal(readlinkSync(join(source, 'rpsleague-release-bbaa.mppfA9/l')), '/')
  assert.ok(lstatSync(join(sockets, 'default_ep.sock')).isSocket())
  for (const path of strays) assert.ok(existsSync(join(source, path)), path)
})

test('a backup made before this rule, with the strays in it, still restores, and brings none of them back', async (t) => {
  const { source, directory, put, records } = await homeWithStrays(t)
  // The old rule took every file it could read at every level: the build at the root, the VM's files, the project's pack.
  const before = ['rpsleague-release-bbaa.mppfA9/source/big.bin', 'runtime/rps-ee8d-build.OwUqoa8K/lima.tgz', 'work/app/state-machines-20261121/accept.py', 'scratch.log']
  mkdirSync(directory, { recursive: true })
  const archive = join(directory, 'hobkin-backup-2026-11-20T17-45-00.zip')
  assert.deepEqual(await zipArchiver.create(source, archive, [...records, ...before]), [])
  assert.ok(archived(archive).includes('home/runtime/rps-ee8d-build.OwUqoa8K/lima.tgz'))
  // Since then hobkin's records changed, and the user cleaned the strays away.
  put('memory.md', 'changed since')
  put('notes/new.md', 'written since')
  for (const path of ['rpsleague-release-bbaa.mppfA9', 'runtime/rps-ee8d-build.OwUqoa8K', 'work/app/state-machines-20261121', 'scratch.log']) rmSync(join(source, path), { recursive: true })

  await restoreBackup(archive, source)

  for (const path of records) assert.equal(readFileSync(join(source, path), 'utf8'), `was ${path}`, path)
  assert.equal(existsSync(join(source, 'notes/new.md')), false)
  for (const path of ['rpsleague-release-bbaa.mppfA9', 'runtime/rps-ee8d-build.OwUqoa8K', 'work/app/state-machines-20261121', 'scratch.log']) assert.equal(existsSync(join(source, path)), false, `${path} is not brought back`)
})
