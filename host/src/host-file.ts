import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface HostAddress {
  pid: number
  port: number
  token: string
}

const fileIn = (root: string) => join(root, 'client', 'host.json')

function read(root: string): HostAddress | null {
  try {
    return JSON.parse(readFileSync(fileIn(root), 'utf8')) as HostAddress
  } catch {
    return null
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // No permission to signal it still means it is there.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The host already serving this home, if one is. A file left by a host that died is ignored. */
export function runningHost(root: string): HostAddress | null {
  const address = read(root)
  return address && Number.isInteger(address.pid) && address.pid !== process.pid && isRunning(address.pid) ? address : null
}

/**
 * Tells the shell where this host is, so it can attach again. It holds the token, so only the user may read it.
 * Written whole under another name and moved into place, so a reader never sees half of it.
 */
export function writeHostFile(root: string, address: HostAddress): void {
  const file = fileIn(root)
  mkdirSync(join(root, 'client'), { recursive: true, mode: 0o700 })
  const draft = `${file}.${process.pid}.tmp`
  writeFileSync(draft, `${JSON.stringify(address)}\n`, { mode: 0o600 })
  renameSync(draft, file)
}

/** Removes the file only while it is still this host's, so a newer host's file is left alone. */
export function removeHostFile(root: string): void {
  if (read(root)?.pid === process.pid) rmSync(fileIn(root), { force: true })
}
