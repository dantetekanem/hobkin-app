/**
 * Where a review's change comes from: a finished hobkin branch, read with git in the project's repository, or a
 * GitHub pull request, read through gh. Both only read. Each answers the commit the change is at, cheaply, and the
 * whole change at that commit for the review passes.
 */
import { captureChange, type CapturedFile, type ChangedPath, type ChangeReader, type FileRead } from '#shared/review/capture.ts'
import type { PrepareInput } from '#shared/review/draft.ts'
import { pullUrl, type ReviewTarget } from '#shared/review/ids.ts'
import { fileRole } from '#shared/review/paths.ts'
import { SIZE_LIMIT } from '#shared/review/types.ts'
import type { Vicinity } from '#shared/review/vicinity.ts'
import { ghText, type GhCall } from './gh.ts'
import { gitReader, type GitReader } from './git.ts'

/** What the review passes need, but its id. A pull request also has its description, which the review shows as it is. */
export type ChangeInput = Omit<PrepareInput, 'id'> & { description?: string }

export interface ReviewSource {
  /** The commit the change is at now, or null when it is gone: merged, closed or deleted. */
  head(target: ReviewTarget): Promise<string | null>
  /** The whole change at that commit. */
  read(target: ReviewTarget, head: string): Promise<ChangeInput>
}

/** The spec of a change on a hobkin branch: `hobkin/<id>-<slug>` keeps it in `_specs/<id>-<slug>/spec.md`. */
export function specPathFor(branch: string | null, changed: readonly { path: string }[]): string | null {
  const named = branch?.match(/^hobkin\/(.+)$/)?.[1]
  if (named) return `_specs/${named}/spec.md`
  // Otherwise the spec the change itself wrote or changed, when there is exactly one.
  const specs = changed.map((file) => file.path).filter((path) => /^_specs\/[^/]+\/spec\.md$/.test(path))
  return specs.length === 1 ? specs[0]! : null
}

/** A finished change as the Work screen knows it. */
export interface ChangeFacts {
  project: string
  title: string
  branch: string | null
  head: string | null
}

/** A finished hobkin change, read with git in the project's own repository. */
export function changeSource({
  find,
  repoOf,
  baseOf,
  git = gitReader,
  vicinity,
}: {
  /** The change as the Work screen has it, or null when hobkin no longer lists it. */
  find: (slug: string, item: string) => ChangeFacts | null
  /** The project's repository folder. */
  repoOf: (slug: string) => string | null
  /** The branch everything starts from in a repository. */
  baseOf: (repo: string) => Promise<string>
  git?: (repo: string) => GitReader
  /** The unchanged code around the change, from a call-graph scan of the repository. Without it the review shows none. */
  vicinity?: (repo: string, base: string, head: string) => Promise<Vicinity>
}): ReviewSource {
  const where = (target: ReviewTarget) => {
    if (target.kind !== 'change') throw new Error('Not a finished change.')
    const facts = find(target.slug, target.item)
    if (!facts) throw new Error('hobkin no longer lists this change as finished.')
    const repo = repoOf(target.slug)
    if (!repo) throw new Error(`hobkin knows no folder for the project ${target.slug}.`)
    return { facts, repo, target }
  }
  return {
    async head(target) {
      const { facts, repo } = where(target)
      if (facts.head) return facts.head
      return facts.branch ? git(repo).resolve(facts.branch) : null
    },
    async read(target, head) {
      const { facts, repo, target: change } = where(target)
      const reader = git(repo)
      const base = await reader.mergeBase(await baseOf(repo), head)
      const capture = await captureChange(reader, base, head)
      const specPath = specPathFor(facts.branch, capture.files)
      const specText = specPath ? await reader.text(head, specPath) : null
      return {
        change: { project: facts.project, item: change.kind === 'change' ? change.item : '', title: facts.title, branch: facts.branch ?? head.slice(0, 12) },
        capture,
        spec: specPath && specText != null ? { path: specPath, text: specText } : null,
        readHead: (path) => reader.text(head, path),
        ...(vicinity ? { vicinity: await vicinity(repo, base, head) } : {}),
      }
    },
  }
}

interface PullFile {
  filename: string
  previous_filename?: string
  status: string
  additions: number
  deletions: number
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** A GitHub pull request, read through gh with GET requests only. */
export function pullSource({ gh, limit = SIZE_LIMIT }: { gh: GhCall; limit?: { files: number; changedLines: number } }): ReviewSource {
  const api = async <Value>(path: string): Promise<Value> => JSON.parse(await ghText(gh, ['api', '--hostname', 'github.com', path])) as Value
  const pullOf = (target: ReviewTarget) => {
    if (target.kind !== 'pull') throw new Error('Not a pull request.')
    return { repo: `repos/${target.owner}/${target.repo}`, target }
  }

  return {
    async head(target) {
      const { repo } = pullOf(target)
      const pull = await api<{ state?: string; head?: { sha?: string } }>(`${repo}/pulls/${target.kind === 'pull' ? target.number : 0}`)
      return pull.state === 'open' && pull.head?.sha ? pull.head.sha : null
    },
    async read(target, head) {
      const { repo, target: pull } = pullOf(target)
      if (pull.kind !== 'pull') throw new Error('Not a pull request.')
      const details = await api<{ title: string; body?: string | null; base: { sha: string }; head: { ref: string }; user?: { login?: string } }>(`${repo}/pulls/${pull.number}`)
      // The files GitHub lists are against the merge base, so that is the side the review compares with.
      const compare = await api<{ merge_base_commit?: { sha?: string } }>(`${repo}/compare/${details.base.sha}...${head}`)
      const base = compare.merge_base_commit?.sha ?? details.base.sha

      const files: PullFile[] = []
      for (let page = 1; page <= 30; page += 1) {
        const batch = await api<PullFile[]>(`${repo}/pulls/${pull.number}/files?per_page=100&page=${page}`)
        files.push(...batch)
        if (batch.length < 100) break
      }
      // Read as many files as the size limits keep in detail, code and tests first. The rest are counted, not read.
      const ranked = [...files].sort((a, b) => Number(fileRole(a.filename) === 'file') - Number(fileRole(b.filename) === 'file') || a.filename.localeCompare(b.filename))
      const read = new Set<string>()
      let lines = 0
      for (const file of ranked) {
        const size = file.additions + file.deletions
        if (read.size < limit.files && lines + size <= limit.changedLines) {
          read.add(file.filename)
          lines += size
        }
      }

      const contents = new Map<string, Promise<FileRead>>()
      const fetchFile = (commit: string, path: string): Promise<FileRead> => {
        const key = `${commit}:${path}`
        if (!contents.has(key)) {
          contents.set(
            key,
            gh(['api', '--hostname', 'github.com', '-H', 'Accept: application/vnd.github.raw', `${repo}/contents/${encodePath(path)}?ref=${commit}`]).then((outcome): FileRead => {
              if (outcome.kind !== 'done') return { kind: 'missing' }
              return outcome.stdout.slice(0, 8000).includes('\u0000') ? { kind: 'binary' } : { kind: 'text', text: outcome.stdout }
            }),
          )
        }
        return contents.get(key)!
      }
      const reader: ChangeReader = {
        changed: async () =>
          files.map((file): ChangedPath => {
            const status = file.status === 'added' ? 'added' : file.status === 'removed' ? 'deleted' : file.status === 'renamed' ? 'renamed' : 'modified'
            return {
              path: file.filename,
              ...(file.previous_filename ? { oldPath: file.previous_filename } : {}),
              status,
              ...(read.has(file.filename) ? {} : { counted: { additions: file.additions, deletions: file.deletions } }),
            }
          }),
        read: (commit, path) => fetchFile(commit, path),
      }
      const capture = await captureChange(reader, base, head, limit)
      const specPath = specPathFor(details.head.ref, capture.files as CapturedFile[])
      const specFile = specPath ? await fetchFile(head, specPath) : null
      return {
        change: { project: `${pull.owner}/${pull.repo}`, item: `#${pull.number}`, title: details.title, branch: details.head.ref },
        // The same answer as the title, so nothing more is asked of GitHub. GitHub writes its lines with \r\n.
        description: (details.body ?? '').replace(/\r\n?/g, '\n').trim(),
        vicinity: { links: [], notice: 'Callers and callees are not shown: a pull request is read from GitHub, with no checkout to scan.' },
        capture,
        spec: specPath && specFile?.kind === 'text' ? { path: specPath, text: specFile.text } : null,
        readHead: async (path) => {
          const file = await fetchFile(head, path)
          return file.kind === 'text' ? file.text : null
        },
      }
    },
  }
}

/** The address a pull request review is about, for the words the screen shows. */
export const pullAddress = pullUrl
