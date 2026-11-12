/**
 * How a finished change lands on the user's yes (spec 032). Whether its commit merges into its default branch now is
 * checked with git, without moving a branch or touching an index or a working tree: one that merges cleanly is merged
 * straight away, and only a real conflict sends an agent to bring it up to date first. What changed on the branch
 * since the commit a review read is said, never refused: the yes is pinned to the commit the preview showed.
 */
import { gitIn, type GitRun } from './assessment.ts'

/** How a commit merges into a branch: it holds the branch's tip already, a merge commit makes it with no conflict, or it conflicts. */
export type Merges = 'fast-forward' | 'clean' | 'conflicts'

/** What changed on a branch between the commit a review read and where it is now. */
export interface Moved {
  /** Its history was written again, such as by a rebase, rather than added to. */
  rebased: boolean
  /** Written again with the same commits, only onto a newer base. */
  same: boolean
  /** The subjects of its commits that are new since. */
  subjects: string[]
}

/** How the yes lands a finished change, as the preview says it and the verdict does it. */
export interface MergePlan {
  /** hobkin's own merge, its pull request's merge on GitHub, or a refresh first, only when it conflicts. */
  route: 'merge' | 'mergePr' | 'refreshMerge'
  into: string
  merges: Merges
  /** The commit it merges: where the branch is now, which the preview shows and the yes is pinned to. */
  head: string
  /** What moved since the commit the review read, when it moved. */
  moved?: Moved
}

const isAncestor = (git: GitRun, repo: string, older: string, newer: string) => git(repo, 'merge-base', '--is-ancestor', older, newer).then(() => true, () => false)

/** The tip a merge goes onto: the local branch, unless the remote's is newer, as hobkin's own merge takes it. */
async function tipOf(git: GitRun, repo: string, into: string): Promise<string | null> {
  const tip = (ref: string) => git(repo, 'rev-parse', '--verify', '--quiet', ref).then((sha) => sha || null, () => null)
  const [local, remote] = await Promise.all([tip(`refs/heads/${into}`), tip(`refs/remotes/origin/${into}`)])
  if (local && remote && !(await isAncestor(git, repo, local, remote))) return local
  return remote ?? local
}

/** Whether `head` merges into `into` now. `git merge-tree --write-tree` only writes objects nothing refers to. */
export async function mergeCheck({ repo, into, head, git = gitIn }: { repo: string; into: string; head: string; git?: GitRun }): Promise<{ tip: string; merges: Merges }> {
  const tip = await tipOf(git, repo, into)
  if (!tip) throw new Error(`There is no ${into} to merge into.`)
  if (await isAncestor(git, repo, tip, head)) return { tip, merges: 'fast-forward' }
  try {
    await git(repo, 'merge-tree', '--write-tree', '--no-messages', tip, head)
    return { tip, merges: 'clean' }
  } catch (error) {
    // git says 1 for a merge with conflicts, and anything else when it could not tell.
    if ((error as { code?: unknown }).code === 1) return { tip, merges: 'conflicts' }
    const said = (error as { stderr?: string }).stderr?.trim().split('\n', 1)[0]
    throw new Error(`git could not tell whether it merges into ${into}: ${said || (error instanceof Error ? error.message : String(error))}`)
  }
}

const subjectsOf = async (git: GitRun, repo: string, range: string) => (await git(repo, 'log', '--format=%s', '--reverse', range)).split('\n').filter(Boolean)

/** What changed on a branch from `from` to `to`: commits added, or its history written again, the same or not. */
export async function movedSince({ repo, from, to, tip, git = gitIn }: { repo: string; from: string; to: string; tip: string; git?: GitRun }): Promise<Moved> {
  if (await isAncestor(git, repo, from, to)) return { rebased: false, same: false, subjects: await subjectsOf(git, repo, `${from}..${to}`) }
  const [before, after] = await Promise.all([git(repo, 'merge-base', from, tip), git(repo, 'merge-base', to, tip)])
  const subjects = await subjectsOf(git, repo, `${after}..${to}`)
  try {
    // Each pair of commits on one line: `=` when the change is the same, `!` when it differs, `<` or `>` when one side has none.
    const pairs = (await git(repo, 'range-diff', '--no-color', '--no-patch', `${before}..${from}`, `${after}..${to}`)).split('\n').filter((line) => /^\s*(?:\d+|-):\s/.test(line))
    return { rebased: true, same: pairs.length > 0 && pairs.every((line) => /^\s*\d+:\s+[0-9a-f]+\s+=\s+\d+:/.test(line)), subjects }
  } catch {
    // The commit the review read may be gone, as after a rebase and a clean-up: it moved, and how is unknown.
    return { rebased: true, same: false, subjects }
  }
}

/**
 * How a yes lands a finished change now. A change that merges cleanly into its default branch is merged straight away:
 * by hobkin on this machine, or as its pull request on GitHub when it has one open. Only one that conflicts is sent to
 * an agent to bring up to date first. It merges where the branch is now, and says what moved since the review.
 */
export async function mergePlan({ repo, into, reviewed, current, pr, git = gitIn }: { repo: string; into: string; reviewed: string; current: string; pr: boolean; git?: GitRun }): Promise<MergePlan> {
  const { tip, merges } = await mergeCheck({ repo, into, head: current, git })
  const moved = current !== reviewed ? await movedSince({ repo, from: reviewed, to: current, tip, git }) : undefined
  const route = merges === 'conflicts' ? 'refreshMerge' : pr ? 'mergePr' : 'merge'
  return { route, into, merges, head: current, ...(moved ? { moved } : {}) }
}
