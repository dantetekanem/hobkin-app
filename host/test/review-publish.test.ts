import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GhOutcome } from '../src/github-gh.ts'
import { gitPublisher, githubRepoOf } from '../src/review/publish.ts'

test('reads the GitHub repository a project pushes to from its origin', () => {
  assert.equal(githubRepoOf('https://github.com/acme/shop.git'), 'acme/shop')
  assert.equal(githubRepoOf('git@github.com:acme/shop.git'), 'acme/shop')
  assert.equal(githubRepoOf('ssh://git@github.com/acme/shop'), 'acme/shop')
  assert.equal(githubRepoOf('https://gitlab.com/acme/shop.git'), null)
})

test('opens a pull request by pushing the reviewed commit to the branch and asking GitHub for it', async () => {
  const ran: string[][] = []
  const asked: { args: readonly string[]; input?: string }[] = []
  const publisher = gitPublisher({
    repoOf: (slug) => (slug === 'shop' ? '/projects/shop.invalid' : null),
    baseOf: async () => 'main',
    git: async (repo, args) => {
      ran.push([repo, ...args])
      return args[0] === 'remote' ? 'git@github.com:acme/shop.git\n' : ''
    },
    gh: async (args, input): Promise<GhOutcome> => {
      asked.push({ args, input })
      return { kind: 'done', stdout: JSON.stringify({ html_url: 'https://github.com/acme/shop/pull/9' }) }
    },
  })

  const plan = await publisher.plan('shop', 'hobkin/7d02c9-word')
  assert.deepEqual(plan, { slug: 'shop', repo: 'acme/shop', base: 'main', branch: 'hobkin/7d02c9-word' })
  assert.deepEqual(ran, [['/projects/shop.invalid', 'remote', 'get-url', 'origin']], 'a plan only reads')

  const head = 'a'.repeat(40)
  assert.deepEqual(await publisher.open(plan, { head, title: 'Say the word', body: 'What it does.' }), { url: 'https://github.com/acme/shop/pull/9' })
  assert.deepEqual(ran.at(-1), ['/projects/shop.invalid', 'push', 'origin', `${head}:refs/heads/hobkin/7d02c9-word`])
  assert.deepEqual(asked[0]!.args, ['api', '--hostname', 'github.com', '--method', 'POST', 'repos/acme/shop/pulls', '--input', '-'])
  assert.deepEqual(JSON.parse(asked[0]!.input!), { title: 'Say the word', head: 'hobkin/7d02c9-word', base: 'main', body: 'What it does.' })

  await assert.rejects(publisher.plan('elsewhere', 'b'), /no folder/)
})

test('a project that does not push to GitHub cannot open a pull request, and says why', async () => {
  const publisher = gitPublisher({
    repoOf: () => '/projects/shop.invalid',
    baseOf: async () => 'main',
    git: async () => 'https://gitlab.com/acme/shop.git\n',
    gh: async () => ({ kind: 'missing' }),
  })
  await assert.rejects(publisher.plan('shop', 'b'), /not on GitHub/)
  const unpushed = gitPublisher({ repoOf: () => '/projects/shop.invalid', baseOf: async () => 'main', git: async () => { throw new Error('No such remote') }, gh: async () => ({ kind: 'missing' }) })
  await assert.rejects(unpushed.plan('shop', 'b'), /no origin/)
})
