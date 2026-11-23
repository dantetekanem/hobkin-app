/**
 * Reads a change from a git repository for the review passes. Only `git log`, `git diff`, `git merge-base`,
 * `git rev-parse`, `git rev-list` and `git show` ever run, so the repository is never changed.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChangeReader, ChangedPath, FileRead } from '#shared/review/capture.ts'

const run = promisify(execFile)
const MAX_BYTES = 64 * 1024 * 1024
const GIT_TIMEOUT_MS = 30_000

export interface GitCommit {
  hash: string
  parent: string
  subject: string
}

export interface GitReader extends ChangeReader {
  commit(ref: string): Promise<GitCommit>
  /** The commit a name points at, or null when it names nothing. */
  resolve(ref: string): Promise<string | null>
  /** The last commit `commit` shares with the other lines of history: with one, or with any of several taken together. */
  mergeBase(commit: string, ...others: string[]): Promise<string>
  /** A file's text at a commit, or null when it is not there or is binary. */
  text(commit: string, path: string): Promise<string | null>
  /** Whether `older` is `newer` or one of its ancestors. */
  contains(newer: string, older: string): Promise<boolean>
  /** Where `into` stood before the merge that brought `head` into it, or null when no merge did, as for a fast-forward. */
  beforeMergeOf(head: string, into: string): Promise<string | null>
}

export function gitReader(repository: string): GitReader {
  const git = async (...args: string[]) => (await run('git', ['-C', repository, ...args], { encoding: 'buffer', maxBuffer: MAX_BYTES, timeout: GIT_TIMEOUT_MS })).stdout

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
    async resolve(ref) {
      try {
        return (await git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`)).toString('utf8').trim() || null
      } catch {
        return null
      }
    },
    async mergeBase(commit, ...others) {
      return (await git('merge-base', commit, ...others)).toString('utf8').trim()
    },
    async contains(newer, older) {
      return git('merge-base', '--is-ancestor', older, newer).then(() => true, () => false)
    },
    async beforeMergeOf(head, into) {
      // The oldest merge on the branch's own line that holds `head`: its first parent is where the branch stood before it.
      const merges = (await git('rev-list', '--merges', '--first-parent', '--ancestry-path', '--reverse', `${head}..${into}`).catch(() => Buffer.from(''))).toString('utf8').split('\n').filter(Boolean)
      if (!merges[0]) return null
      return (await git('rev-parse', '--verify', '--quiet', `${merges[0]}^1`).catch(() => Buffer.from(''))).toString('utf8').trim() || null
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
