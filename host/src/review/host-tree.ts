/**
 * A code host's own review tree (spec 048, entry 15): for a repository too large to check out whole, the code host file
 * names a tree, the command that makes it and the command that fits it to a change. hobkin makes it when it is missing,
 * and for each review checks it out at the change's head, empties it of what an earlier review left, and fits it: with
 * the host's command when one is named, else to the folders of the changed files. Only a tree that is a worktree of the
 * same repository is ever touched; any other folder at that place is left alone.
 */
import { existsSync, realpathSync, statfsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { scrubText } from '#shared/integrations/redact.ts'
import { runProgram } from '../../../packages/change-review/src/git.ts'
import type { HostTree } from './code-hosts.ts'

const GB = 1024 ** 3
/** Making a tree of a very large repository takes a while; fitting and checking it out less. */
const TREE_TIMEOUT_MS = 30 * 60_000
const FULL_COMMIT = /^[0-9a-f]{40}$/
/** A folder name git or a fit could read as an option or a pattern is never named to it. */
const UNSAFE = /^-|[*?[\]\\!:]/

/** Free bytes for a new tree where it is made. */
const freeIn = (folder: string) => {
  const stats = statfsSync(folder)
  return stats.bavail * stats.bsize
}

const lastLine = (text: string) => text.trim().split('\n').filter((line) => line.trim()).at(-1)?.trim() ?? ''

export async function readyHostTree({ tree, repo, base, head, program = runProgram, freeBytes = freeIn }: {
  tree: HostTree
  /** The repository the pull request was fetched into, whose worktree the tree must be. */
  repo: string
  base: string
  head: string
  program?: typeof runProgram
  freeBytes?: (folder: string) => number
}): Promise<string> {
  const env = { ...process.env, ...tree.env, GIT_TERMINAL_PROMPT: '0' }
  const words = (command: readonly string[]) =>
    command.map((word) => {
      if (!word.includes('{base}')) return word
      if (!FULL_COMMIT.test(base)) throw new Error(`The change's base, ${base}, is not a full commit, so it is not put in the review tree's commands.`)
      return word.replaceAll('{base}', base)
    })
  const run = async (cwd: string, command: readonly string[], what: string) => {
    const [file, ...args] = words(command)
    const ran = await program(file!, args, { cwd, env, timeoutMs: TREE_TIMEOUT_MS, group: true })
    if (ran.started && !ran.timedOut && ran.code === 0) return ran.stdout.toString('utf8')
    const why = !ran.started ? ran.reason : ran.timedOut ? `it took longer than ${TREE_TIMEOUT_MS / 60_000} minutes` : lastLine(ran.stderr.toString('utf8')) || `it stopped with code ${ran.code}`
    throw new Error(scrubText(`The review tree's ${what} failed: ${why}`))
  }
  const git = (cwd: string, ...args: string[]) => run(cwd, ['git', '-C', cwd, ...args], `git ${args[0]}`).then((out) => out.trim())

  if (!existsSync(tree.path)) {
    const free = freeBytes(existsSync(tree.makeIn) ? tree.makeIn : dirname(tree.makeIn))
    if (free < tree.leastFreeGb * GB) throw new Error(`A new review tree needs ${tree.leastFreeGb} GB free in ${tree.makeIn}, and ${Math.floor(free / GB)} GB are.`)
    await run(tree.makeIn, tree.make, 'make command')
    if (!existsSync(tree.path)) throw new Error(`The review tree's make command did not make ${tree.path}.`)
  }
  // Only a worktree of the same repository, never the repository itself: any other folder there is left alone.
  const commonOf = async (folder: string) => realpathSync(resolve(folder, await git(folder, 'rev-parse', '--git-common-dir')))
  const same = await Promise.all([commonOf(tree.path), commonOf(repo)]).then(([a, b]) => a === b, () => false)
  if (!same || realpathSync(tree.path) === realpathSync(repo)) throw new Error(`${tree.path} is not a worktree of ${repo}, so it is left alone.`)

  await git(tree.path, 'checkout', '--quiet', '--detach', '--force', head)
  // Untracked files an earlier review left go. Ignored ones, such as an install, stay.
  await git(tree.path, 'clean', '-fdq')
  if (tree.fit) await run(tree.path, tree.fit, 'fit command')
  else {
    const changed = (await git(repo, 'diff', '--name-only', '-z', base, head)).split('\0').filter(Boolean)
    const folders = [...new Set(changed.map((path) => dirname(path)).filter((folder) => folder !== '.' && folder.split('/').every((part) => !UNSAFE.test(part))))]
    await git(tree.path, 'sparse-checkout', 'set', '--cone', ...folders)
  }
  const at = await git(tree.path, 'rev-parse', 'HEAD')
  if (at !== head) throw new Error(`The review tree is at ${at.slice(0, 7)}, not ${head.slice(0, 7)}.`)
  return tree.path
}
