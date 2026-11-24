import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changesOnlyUnread } from '../src/unread.ts'
import type { ChangedFile, RepoReader } from '../src/types.ts'

const file = (path: string, patch: Partial<ChangedFile> = {}): ChangedFile => ({ path, status: 'modified', added: 1, deleted: 1, binary: false, ...patch })

/** A repository whose only searchable text is `texts`, by path: grep finds a path or a name the way git grep would. */
const repoWith = (texts: Record<string, string>): Pick<RepoReader, 'grep'> => ({
  async grep(_rev, pattern, paths) {
    const re = new RegExp(pattern)
    return Object.entries(texts)
      .filter(([path]) => !paths || paths.includes(path))
      .flatMap(([path, text]) => text.split('\n').flatMap((line, index) => (re.test(line) ? [{ path, line: index + 1, text: line }] : [])))
  },
})

const DOCS = [file('PLAN.md'), file('docs/client-api-v1.md')]

test('a change of documents nothing else names is read by nothing', async () => {
  const repo = repoWith({ 'src/app.js': 'export const x = 1', 'PLAN.md': 'see docs/client-api-v1.md' })
  assert.equal(await changesOnlyUnread(DOCS, repo, 'head'), true)
})

test('a markdown file that code reads by its path or its name is code, and the change is not unread', async () => {
  const byName = repoWith({ 'src/app.js': "readFileSync(new URL('../PLAN.md', import.meta.url))" })
  assert.equal(await changesOnlyUnread(DOCS, byName, 'head'), false)
  const byCi = repoWith({ '.github/workflows/ci.yml': 'run: markdownlint docs/client-api-v1.md' })
  assert.equal(await changesOnlyUnread(DOCS, byCi, 'head'), false)
})

test('a changed file that is not a document, or no changed file at all, is never unread', async () => {
  const repo = repoWith({})
  assert.equal(await changesOnlyUnread([file('PLAN.md'), file('src/app.js')], repo, 'head'), false)
  assert.equal(await changesOnlyUnread([], repo, 'head'), false)
})
