import assert from 'node:assert/strict'
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { PROJECTS_MAX, type ProjectsFound } from '#shared/protocol/setup.ts'
import { findProjects } from '../src/projects-folder.ts'
import { Client, hostFor, temporaryDirectory } from './support.ts'

const folderAged = (parent: string, name: string, secondsAgo: number) => {
  const path = join(parent, name)
  mkdirSync(path, { recursive: true })
  const when = new Date(Date.now() - secondsAgo * 1000)
  utimesSync(path, when, when)
  return path
}
const names = (found: ProjectsFound) => found.projects.map(({ name }) => name)

test('folders are listed with their full path, and files are not', (t) => {
  const home = temporaryDirectory(t)
  const projects = join(home, 'code')
  folderAged(projects, 'alpha', 10)
  writeFileSync(join(projects, 'notes.txt'), 'x')
  const found = findProjects(projects, { home })
  assert.deepEqual(found, { folder: projects, found: true, projects: [{ name: 'alpha', path: join(projects, 'alpha'), git: false }], more: 0 })
})

test('dot folders and node_modules are left out', (t) => {
  const projects = temporaryDirectory(t)
  for (const name of ['.cache', '.git', 'node_modules', 'real']) folderAged(projects, name, 10)
  assert.deepEqual(names(findProjects(projects, { home: projects })), ['real'])
})

test('a folder with a .git entry is marked as a git repository', (t) => {
  const projects = temporaryDirectory(t)
  mkdirSync(join(projects, 'repo', '.git'), { recursive: true })
  folderAged(projects, 'plain', 10)
  // A linked worktree has a `.git` file rather than a folder.
  mkdirSync(join(projects, 'worktree'))
  writeFileSync(join(projects, 'worktree', '.git'), 'gitdir: elsewhere')
  const marked = Object.fromEntries(findProjects(projects, { home: projects }).projects.map(({ name, git }) => [name, git]))
  assert.deepEqual(marked, { repo: true, plain: false, worktree: true })
})

test('the folder changed most recently comes first', (t) => {
  const projects = temporaryDirectory(t)
  folderAged(projects, 'old', 3000)
  folderAged(projects, 'newest', 5)
  folderAged(projects, 'middle', 500)
  assert.deepEqual(names(findProjects(projects, { home: projects })), ['newest', 'middle', 'old'])
})

test('~ stands for the home that was given', (t) => {
  const home = temporaryDirectory(t)
  folderAged(join(home, 'code'), 'alpha', 10)
  folderAged(home, 'top', 10)
  const inside = findProjects('~/code', { home })
  assert.equal(inside.found, true)
  assert.equal(inside.folder, join(home, 'code'))
  assert.deepEqual(names(inside), ['alpha'])
  assert.equal(findProjects('~', { home }).folder, home)
  assert.deepEqual(names(findProjects('~', { home })).sort(), ['code', 'top'])
})

test('a relative path, a missing folder and a file are not found, and nothing throws', (t) => {
  const home = temporaryDirectory(t)
  writeFileSync(join(home, 'file.txt'), 'x')
  const empty = (folder: string): ProjectsFound => ({ folder, found: false, projects: [], more: 0 })
  assert.deepEqual(findProjects('code/projects', { home }), empty('code/projects'))
  assert.deepEqual(findProjects('~other/x', { home }), empty('~other/x'))
  assert.deepEqual(findProjects('', { home }), empty(''))
  assert.deepEqual(findProjects(join(home, 'missing'), { home }), empty(join(home, 'missing')))
  assert.deepEqual(findProjects(join(home, 'file.txt'), { home }), empty(join(home, 'file.txt')))
  const unreadable = { home, readdir: () => { throw new Error('EACCES') } }
  assert.equal(findProjects(home, unreadable).found, false)
})

test('more than the cap is cut and the rest is counted', (t) => {
  const projects = temporaryDirectory(t)
  for (let index = 0; index < PROJECTS_MAX + 7; index++) mkdirSync(join(projects, `p${index}`))
  const found = findProjects(projects, { home: projects })
  assert.equal(found.projects.length, PROJECTS_MAX)
  assert.equal(found.more, 7)
})

test('a symlink to a folder is listed, and one to a file or to nothing is not', (t) => {
  const projects = temporaryDirectory(t)
  const elsewhere = folderAged(temporaryDirectory(t), 'target', 10)
  writeFileSync(join(projects, 'a-file'), 'x')
  symlinkSync(elsewhere, join(projects, 'linked'))
  symlinkSync(join(projects, 'a-file'), join(projects, 'file-link'))
  symlinkSync(join(projects, 'nowhere'), join(projects, 'broken'))
  assert.deepEqual(names(findProjects(projects, { home: projects })), ['linked'])
})

test('the command answers over the socket', async (t) => {
  const projects = temporaryDirectory(t)
  folderAged(projects, 'alpha', 10)
  const client = await Client.connect(await hostFor(t))
  const found = await client.run<ProjectsFound>('setup.projects', { folder: projects })
  assert.deepEqual(found, { folder: projects, found: true, projects: [{ name: 'alpha', path: join(projects, 'alpha'), git: false }], more: 0 })
  assert.equal((await client.run<ProjectsFound>('setup.projects', { folder: 'relative/path' })).found, false)
  assert.equal((await client.command('setup.projects', { folder: '' })).ok, false)
})
