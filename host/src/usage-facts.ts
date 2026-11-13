import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { resolveDataRoot } from 'hobkin/src/cli/migration/admission.mjs'
import type { UsageFacts } from '#shared/protocol/system.ts'
import { MAIN } from './history.ts'

const run = promisify(execFile)

/** `du -sk` output: "123456\t/path" in kilobytes, as bytes. */
export function parseDu(output: string): number | null {
  const kilobytes = Number(/^\s*(\d+)/.exec(output)?.[1])
  return Number.isFinite(kilobytes) ? kilobytes * 1024 : null
}

/** Read from hobkin's own files and never written: `initializedAt` in its config, and its main conversation files. */
export async function usageFacts(root: string, backups: string): Promise<UsageFacts> {
  const data = resolve(resolveDataRoot(root))
  const config = await readFile(join(data, 'config.json'), 'utf8').then((text) => JSON.parse(text) as { initializedAt?: unknown }, () => ({}) as { initializedAt?: unknown })
  const at = typeof config.initializedAt === 'string' && Number.isFinite(Date.parse(config.initializedAt)) ? config.initializedAt : null
  const files = await readdir(join(data, 'sessions')).catch(() => [])
  const size = (path: string) => run('du', ['-sk', path], { timeout: 15_000 }).then(({ stdout }) => parseDu(stdout), () => null)
  const [homeBytes, backupsBytes] = await Promise.all([size(data), size(backups)])
  return { firstLoginAt: at, conversations: files.filter((name) => MAIN.test(name)).length, homeBytes, backupsBytes }
}
