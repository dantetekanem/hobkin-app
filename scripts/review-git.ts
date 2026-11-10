/**
 * Reads a change from a git repository for the review passes. It only ever runs `git log`, `git diff`
 * and `git show`, so the repository it reads is never changed.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChangeReader, ChangedPath, FileRead } from '#shared/review/capture.ts'

const run = promisify(execFile)
const MAX_BYTES = 64 * 1024 * 1024

export interface GitCommit {
  hash: string
  parent: string
  subject: string
}

export interface GitReader extends ChangeReader {
  commit(ref: string): Promise<GitCommit>
  /** A file's text at a commit, or null when it is not there or is binary. */
  text(commit: string, path: string): Promise<string | null>
}

export function gitReader(repository: string): GitReader {
  const git = async (...args: string[]) => (await run('git', ['-C', repository, ...args], { encoding: 'buffer', maxBuffer: MAX_BYTES })).stdout

  const read = async (commit: string, path: string): Promise<FileRead> => {
    let bytes: Buffer
    try {
      bytes = await git('show', `${commit}:${path}`)
    } catch {
      return { kind: 'missing' }
    }
    // The same test git uses: a zero byte near the start means the file is not text.
    if (bytes.subarray(0, 8000).includes(0)) return { kind: 'binary' }
    return { kind: 'text', text: bytes.toString('utf8') }
  }

  return {
    read,
    async text(commit, path) {
      const file = await read(commit, path)
      return file.kind === 'text' ? file.text : null
    },
    async commit(ref) {
      const [hash = '', parents = '', subject = ''] = (await git('log', '-1', '--format=%H%n%P%n%s', ref)).toString('utf8').split('\n')
      const parent = parents.split(' ')[0] ?? ''
      if (!hash || !parent) throw new Error(`${ref} is not a commit with a parent in ${repository}.`)
      return { hash, parent, subject }
    },
    async changed(base, head) {
      const fields = (await git('diff', '--name-status', '-M', '-z', base, head)).toString('utf8').split('\0')
      const changed: ChangedPath[] = []
      for (let index = 0; index < fields.length - 1; ) {
        const status = fields[index++]!
        if (status.startsWith('R') || status.startsWith('C')) {
          const oldPath = fields[index++]!
          const path = fields[index++]!
          // A copy leaves its source in place, so only the new file changed.
          changed.push(status.startsWith('R') ? { path, oldPath, status: 'renamed' } : { path, status: 'added' })
        } else {
          const path = fields[index++]!
          changed.push({ path, status: status === 'A' ? 'added' : status === 'D' ? 'deleted' : 'modified' })
        }
      }
      return changed
    },
  }
}
