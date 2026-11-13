import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workReader } from '../src/work-items.ts'

/** hobkin's work status as its snapshot carries it: each project whole, with the folder or the remote it works from. */
const status = (projects: Record<string, unknown>[]) => ({ enabled: true, folder: '/code.invalid', agents: 1, agentsAllowed: 1, queued: 0, plan: [], projects })

test("each project hobkin works on carries its repository on GitHub, from its folder's origin or the remote hobkin clones, and each folder is asked once", () => {
  const asked: string[] = []
  const origins: Record<string, string> = { '/code.invalid/web': 'git@github.com:Acme/Web.git', '/code.invalid/wiki': 'https://gitlab.com/acme/wiki.git' }
  const originOf = (folder: string) => {
    asked.push(folder)
    return origins[folder] ?? null
  }
  const read = workReader(() => '/home.invalid', originOf)
  const projects = [
    { slug: 'web', state: 'chosen', path: '/code.invalid/web' },
    { slug: 'cloned', state: 'chosen', remote: 'https://github.com/acme/cloned.git' },
    { slug: 'wiki', state: 'chosen', path: '/code.invalid/wiki' },
    { slug: 'loose', state: 'proposed', path: '/code.invalid/loose' },
    { slug: 'nowhere', state: 'skipped' },
  ]

  const repos = (work: ReturnType<typeof read>) => Object.fromEntries((work?.projects ?? []).map(({ slug, repo }) => [slug, repo]))
  // Only the projects hobkin works on are asked about: a look for projects can propose many folders.
  assert.deepEqual(repos(read({ work: status(projects), waiting: null })), { web: 'Acme/Web', cloned: 'acme/cloned', wiki: null, loose: undefined, nowhere: undefined })
  // A refresh brings a new status. The folders' origins are not asked again.
  assert.equal(repos(read({ work: status(projects), waiting: null })).web, 'Acme/Web')
  assert.deepEqual(asked, ['/code.invalid/web', '/code.invalid/wiki'])
})
