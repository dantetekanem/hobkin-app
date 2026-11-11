/**
 * Opening a finished hobkin change's pull request, once its review says yes. The branch is pushed at the exact commit
 * the review was built from, never whatever it points at by then, and GitHub is asked for the pull request through
 * gh, as the user. Nothing here runs without a verdict the user confirmed.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ghText, type GhCall } from './gh.ts'
import type { Publisher } from './reviews.ts'

const exec = promisify(execFile)
const GIT_TIMEOUT_MS = 120_000

/** Runs git in a repository and answers what it wrote. */
export type GitRun = (repo: string, args: readonly string[]) => Promise<string>

const runGit: GitRun = async (repo, args) => (await exec('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout

/** `owner/name` of a GitHub remote, from its https or ssh address. Null for anywhere else. */
export function githubRepoOf(url: string): string | null {
  const found = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())
  return found ? `${found[1]}/${found[2]}` : null
}

export function gitPublisher({
  repoOf,
  baseOf,
  gh,
  git = runGit,
}: {
  /** The project's repository folder, or null when hobkin knows none. */
  repoOf: (slug: string) => string | null
  /** The branch everything starts from in a repository. */
  baseOf: (repo: string) => Promise<string>
  gh: GhCall
  git?: GitRun
}): Publisher {
  const folder = (slug: string) => {
    const repo = repoOf(slug)
    if (!repo) throw new Error(`hobkin knows no folder for the project ${slug}.`)
    return repo
  }
  return {
    async plan(slug, branch) {
      const repo = folder(slug)
      let origin: string
      try {
        origin = await git(repo, ['remote', 'get-url', 'origin'])
      } catch {
        throw new Error('This project has no origin to push to, so a pull request cannot be opened from here.')
      }
      const github = githubRepoOf(origin)
      if (!github) throw new Error("This project's origin is not on GitHub, so a pull request cannot be opened from here.")
      return { slug, repo: github, base: await baseOf(repo), branch }
    },
    async open(plan, { head, title, body }) {
      await git(folder(plan.slug), ['push', 'origin', `${head}:refs/heads/${plan.branch}`]).catch((error: { stderr?: string; message?: string }) => {
        throw new Error(`The branch was not pushed: ${(error.stderr || error.message || '').trim().split('\n')[0]}`)
      })
      const answer = await ghText(gh, ['api', '--hostname', 'github.com', '--method', 'POST', `repos/${plan.repo}/pulls`, '--input', '-'], JSON.stringify({ title, head: plan.branch, base: plan.base, body }))
      const url = (JSON.parse(answer || '{}') as { html_url?: string }).html_url
      if (!url) throw new Error('GitHub did not say where the pull request is.')
      return { url }
    },
  }
}
