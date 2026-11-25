import type { FinishedChange, WorkProject } from '#shared/protocol/work.ts'
import { isGoal } from './projects.ts'

/**
 * Try it on a finished change (_specs/068-run-guide, "In the window"): the first step that brings the change into the
 * user's own checkout, before the project's run guide. Pure, so it is tested without a window.
 */

export interface FirstStep {
  /** A pull request is checked out with gh, a branch is fetched and switched to, and a change with neither has no step. */
  kind: 'pr' | 'branch' | 'none'
  /** The commands to run in the checkout, in order, each as it is typed. */
  commands: string[]
}

/** A word the shell reads as it is, or the word in single quotes. */
const shellWord = (word: string) => (/^[\w./@%+=:,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`)

/** The commands that bring the change in: `gh pr checkout <number>` for a pull request, else `git fetch` and `git switch <branch>`. */
export function firstStepOf(change: Pick<FinishedChange, 'branch' | 'pr'>): FirstStep {
  if (change.pr) {
    const number = /\/pull\/(\d+)/.exec(change.pr)?.[1]
    return { kind: 'pr', commands: [`gh pr checkout ${number ?? shellWord(change.pr)}`] }
  }
  if (change.branch) return { kind: 'branch', commands: ['git fetch', `git switch ${shellWord(change.branch)}`] }
  return { kind: 'none', commands: [] }
}

/** A goal's changes have no Try it: a goal has no run guide. A project the window does not know yet is code. */
export function offersTryIt(change: Pick<FinishedChange, 'slug'>, projects: readonly Pick<WorkProject, 'slug' | 'kind'>[]): boolean {
  const project = projects.find(({ slug }) => slug === change.slug)
  return !project || !isGoal(project)
}
