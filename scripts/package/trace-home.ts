/**
 * Loaded with `--import` by `check.ts --trace`, never by the app. It notes, in a log beside itself, every path the
 * host touches in the temporary HOME, every write it tries inside the staged copy, every path under /Users it names,
 * and every program it starts, so the check can say what a packaged host looks for on a Mac and where it writes.
 * It only watches: each call goes on to the real function unchanged.
 */
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { resolve } from 'node:path'

interface TraceSettings {
  log: string
  home: string
  hobkinHome: string
  copy: string
}

const settings = JSON.parse(fs.readFileSync(new URL('./trace.json', import.meta.url), 'utf8')) as TraceSettings
const append = fs.appendFileSync.bind(fs)
const note = (line: string) => {
  try {
    append(settings.log, `${line}\n`)
  } catch {
    // A note that cannot be written is lost. The host goes on.
  }
}

const within = (folder: string, path: string) => path === folder || path.startsWith(`${folder}/`)

function pathOf(value: unknown): string | null {
  if (typeof value === 'string') return resolve(value)
  if (value instanceof URL && value.protocol === 'file:') return resolve(decodeURIComponent(value.pathname))
  if (Buffer.isBuffer(value)) return resolve(value.toString())
  return null
}

function watchPath(call: string, value: unknown, writes: boolean): void {
  const path = pathOf(value)
  if (!path) return
  if (within(settings.home, path) && !within(settings.hobkinHome, path)) note(`home ${call} ${path}`)
  if (writes && within(settings.copy, path)) note(`copy ${call} ${path}`)
  if (path.startsWith('/Users/')) note(`users ${call} ${path}`)
}

const READS = ['existsSync', 'statSync', 'lstatSync', 'readFileSync', 'readdirSync', 'accessSync', 'realpathSync', 'opendirSync', 'readlinkSync', 'watch', 'watchFile']
const WRITES = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'copyFileSync', 'cpSync', 'symlinkSync', 'chmodSync', 'utimesSync']
const ASYNC_READS = ['stat', 'lstat', 'readFile', 'readdir', 'access', 'realpath', 'opendir', 'readlink']
const ASYNC_WRITES = ['writeFile', 'appendFile', 'mkdir', 'rename', 'rm', 'rmdir', 'unlink', 'copyFile', 'cp', 'symlink', 'chmod', 'utimes']
// These take a second path that is written to.
const TWO_PATHS = new Set(['renameSync', 'copyFileSync', 'cpSync', 'symlinkSync', 'rename', 'copyFile', 'cp', 'symlink'])
const opensForWriting = (flags: unknown) => typeof flags === 'string' ? /[wa+]/.test(flags) : typeof flags === 'number' && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== 0

function wrap(owner: Record<string, unknown>, name: string, writes: boolean): void {
  const original = owner[name]
  if (typeof original !== 'function') return
  const watched = function (this: unknown, ...args: unknown[]) {
    const writing = writes || ((name === 'openSync' || name === 'open') && opensForWriting(args[1]))
    watchPath(name, args[0], writing)
    if (TWO_PATHS.has(name)) watchPath(name, args[1], true)
    return (original as (...values: unknown[]) => unknown).apply(this, args)
  }
  // Keeps properties such as `realpathSync.native`.
  Object.assign(watched, original)
  owner[name] = watched
}

const sync = fs as unknown as Record<string, unknown>
const promises = fs.promises as unknown as Record<string, unknown>
for (const name of READS) wrap(sync, name, false)
for (const name of WRITES) wrap(sync, name, true)
wrap(sync, 'openSync', false)
for (const name of ASYNC_READS) {
  wrap(sync, name, false)
  wrap(promises, name, false)
}
for (const name of ASYNC_WRITES) {
  wrap(sync, name, true)
  wrap(promises, name, true)
}
wrap(sync, 'open', false)
wrap(promises, 'open', false)

const programs = childProcess as unknown as Record<string, unknown>
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) {
  const original = programs[name]
  if (typeof original !== 'function') continue
  const watched = function (this: unknown, ...args: unknown[]) {
    const [command, rest] = args
    const first = Array.isArray(rest) && typeof rest[0] === 'string' ? ` ${rest[0]}` : ''
    note(`run ${name} ${String(command)}${first}`)
    return (original as (...values: unknown[]) => unknown).apply(this, args)
  }
  Object.assign(watched, original)
  programs[name] = watched
}

// Modules that import named functions from node:fs or node:child_process see the watched ones too.
syncBuiltinESMExports()
