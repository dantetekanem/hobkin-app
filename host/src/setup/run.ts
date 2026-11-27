import { execFile } from 'node:child_process'
import { scrubText } from '#shared/integrations/redact.ts'
import type { NodeFetch } from '../pi/node.ts'
import type { PiRun } from '../pi/install.ts'

/**
 * What the setup's program installs share (025-onboarding): one way to run a program with a time limit, one way to say
 * why it failed, and one way to download, each in plain words with anything shaped like a secret hidden.
 */

const LAST_LINES = 8
const ANSI = /\x1b\[[0-9;]*m/g

export const realRun: PiRun = (file, args, options, done) => execFile(file, [...args], options, done)
export const realFetch: NodeFetch = (url, init) => fetch(url, init)

export interface Ran {
  error: (Error & { killed?: boolean }) | null
  stdout: string
  stderr: string
}

/** Runs a program and answers with how it ended. It never throws. */
export function ran(run: PiRun, file: string, args: readonly string[], timeout: number, env: NodeJS.ProcessEnv = process.env): Promise<Ran> {
  return new Promise((resolve) => {
    try {
      run(file, args, { timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', env }, (error, stdout, stderr) =>
        resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
      )
    } catch (error) {
      resolve({ error: error instanceof Error ? error : Error(String(error)), stdout: '', stderr: '' })
    }
  })
}

/** The last lines a program printed, without colors. */
export function lastLines(printed: string): string[] {
  return printed
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-LAST_LINES)
}

/** Plain words, then the last lines the program printed, with anything shaped like a secret hidden. */
export function failure(words: string, { error, stdout, stderr }: Ran, limitMs: number): Error {
  const slow = error?.killed ? ` It took longer than ${Math.round(limitMs / 60_000)} minutes, so it was stopped.` : ''
  const lines = lastLines(stderr.trim() ? stderr : stdout)

  let said = ''
  if (lines.length) said = `\n${lines.join('\n')}`
  else if (!slow) said = ` ${error?.message ?? ''}`

  return Error(scrubText(`${words}${slow}${said}`.trimEnd()))
}

/** Downloads one file, saying in plain words what failed: no network, a slow answer, or the site's refusal. */
export async function download<T>(fetcher: NodeFetch, url: string, site: string, limitMs: number, body: (answer: { text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }) => Promise<T>): Promise<T> {
  const failed = (error: unknown) => {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return Error(`The download from ${site} took longer than ${Math.round(limitMs / 60_000)} minutes, so it was stopped and nothing was installed.`)
    }
    const message = error instanceof Error ? error.message : String(error)
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''
    return Error(scrubText(`Nothing could be downloaded from ${site}, so nothing was installed. This Mac may be offline, or ${site} did not answer. (${message}${cause})`))
  }

  let answer: Awaited<ReturnType<NodeFetch>>
  try {
    answer = await fetcher(url, { signal: AbortSignal.timeout(limitMs) })
  } catch (error) {
    throw failed(error)
  }
  if (!answer.ok) throw Error(`${site} answered ${answer.status} for ${url}, so nothing was installed.`)
  try {
    return await body(answer)
  } catch (error) {
    throw failed(error)
  }
}
