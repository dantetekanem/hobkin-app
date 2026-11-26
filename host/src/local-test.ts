import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { readProject } from 'hobkin/src/cli/work/store.mjs'
import { defaultBranch } from 'hobkin/src/cli/work/tree.mjs'
import { landingTip } from 'hobkin/src/cli/work/unmerged.mjs'

const run = promisify(execFile)
const names = ['rpsleague-local-setup.md', 'rpsleague-end-to-end.md']

export async function inspectLocalTest(slug: string, checkout: (slug: string) => string | null) {
  const unknown = { repo: null, head: null, candidate: null, dirty: null, guides: [null, null] }
  if (slug !== 'rpsleague') return unknown
  const folder = checkout(slug)
  if (!folder || !isAbsolute(folder)) return unknown
  const repo = await realpath(folder).catch(() => null)
  if (!repo) return unknown
  const git = async (...args: string[]) => {
    const { stdout } = await run('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', repo, ...args], { timeout: 5000 })
    return stdout.trim()
  }
  if (await git('rev-parse', '--show-toplevel').catch(() => null) !== repo) return unknown
  const guide = async (name: string) => {
    const file = join(repo, 'guides', name)
    const real = await realpath(file).catch(() => null)
    if (!real || relative(repo, real).startsWith('..')) return null
    const entry = await stat(real).catch(() => null)
    return entry?.isFile() ? real : null
  }
  const [head, status, candidate, guides] = await Promise.all([
    git('rev-parse', '--verify', 'HEAD').catch(() => null),
    git('status', '--porcelain').catch(() => null),
    defaultBranch(repo).then(base => landingTip(repo, base)).catch(() => null),
    Promise.all(names.map(guide)),
  ])
  return { repo, head, candidate, dirty: status === null ? null : Boolean(status), guides }
}

export const localTestOf = (root: string, slug: string) => inspectLocalTest(slug, (name) => readProject(root, name)?.path ?? null)
