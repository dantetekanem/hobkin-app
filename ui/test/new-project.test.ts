import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FolderLook } from '../../shared/protocol/work.ts'
import {
  addProject,
  addsFromKey,
  blocker,
  folderLine,
  kindLine,
  kindOf,
  newProjectArgs,
  opensNewProject,
  rowAfterAdd,
  sampleAdd,
  sampleLook,
  yoloLine,
  yoloOn,
  type NewProjectForm,
} from '../src/features/work/new-project.ts'
import { sampleWork } from '../src/features/work/sample.ts'

const look = (rest: Partial<FolderLook> = {}): FolderLook => ({ typed: '~/Projects/app', folder: '/Users/me/Projects/app', found: 'folder', git: true, name: 'app', known: null, namesake: null, ...rest })
const formFor = (rest: Partial<NewProjectForm> & { found?: Partial<FolderLook> | null } = {}): NewProjectForm => {
  const { found, ...fields } = rest
  const folder = fields.folder ?? '~/Projects/app'
  return { folder, picked: null, wants: '', yoloChoice: null, from: 'work', looked: found === null ? null : { asked: folder.trim(), look: look({ typed: folder, ...found }) }, ...fields }
}

test('the folder line says one thing for each state of what is typed', () => {
  assert.equal(folderLine(formFor({ folder: '  ', found: null })), 'Type a folder, or choose one with Open.')
  assert.equal(folderLine(formFor({ found: null })), 'Looking…')
  assert.equal(folderLine(formFor({ found: { git: true } })), 'A git repository. It would be called app.')
  assert.equal(folderLine(formFor({ found: { git: false } })), 'No git repository yet: hobkin starts one when you add it. It would be called app.')
  assert.equal(folderLine(formFor({ found: { found: 'missing', folder: null, name: null } })), 'There is no folder there.')
  assert.equal(folderLine(formFor({ found: { found: 'file' } })), 'That is a file, not a folder.')
  assert.equal(folderLine(formFor({ found: { known: { slug: 'app', name: 'app', state: 'chosen' } } })), 'Work already has this folder as app, taken.')
  assert.equal(folderLine(formFor({ found: { known: { slug: 'app', name: 'app', state: 'skipped' } } })), 'Work already has this folder as app, skipped.')
  assert.equal(folderLine(formFor({ found: { namesake: '~/Work/app' } })), 'Another project called app is already in Work, at ~/Work/app.')
})

test('an answer for older text is no answer: the line says it is looking', () => {
  const form = formFor({ folder: '~/Projects/app2' })
  assert.equal(folderLine({ ...form, looked: { asked: '~/Projects/app', look: look() } }), 'Looking…')
})

test('the kind follows the folder until the user picks, and either kind can be picked for any folder', () => {
  const repository = formFor({ found: { git: true } })
  const plainFolder = formFor({ found: { git: false } })

  assert.equal(kindOf(repository), 'code')
  assert.equal(kindOf(plainFolder), 'goal')
  assert.equal(kindOf(formFor({ found: null })), 'code', 'before the look, a repository is the usual case')
  assert.equal(kindOf({ ...repository, picked: 'goal' }), 'goal', 'a pick stays')
  assert.equal(kindOf({ ...plainFolder, picked: 'code' }), 'code', 'hobkin starts a repository in a folder that has none')
  assert.notEqual(kindLine(repository), kindLine({ ...repository, picked: 'goal' }))
})

test('the YOLO switch starts from the page, and a goal has none to switch', () => {
  assert.equal(yoloOn(formFor({ from: 'yolo' })), true)
  assert.equal(yoloOn(formFor({ from: 'work' })), false)
  assert.equal(yoloOn(formFor({ from: 'yolo', yoloChoice: false })), false)
  assert.equal(yoloOn(formFor({ from: 'work', yoloChoice: true })), true)
  assert.equal(yoloOn(formFor({ from: 'yolo', picked: 'goal' })), false)
  assert.equal(yoloLine(formFor({ picked: 'goal' })), 'A goal has nothing to merge, so YOLO mode has nothing to do there.')
})

test('what stands in the way of Add, in the order the user can fix it', () => {
  assert.equal(blocker(formFor({ folder: '', found: null })), 'Name a folder first.')
  assert.equal(blocker(formFor({ found: null })), 'Waiting for the look at the folder.')
  assert.equal(blocker(formFor({ found: { found: 'missing', folder: null } })), 'There is no folder there.')
  assert.equal(blocker(formFor({ found: { found: 'file' } })), 'That is a file. Name a folder.')
  assert.equal(blocker(formFor({ found: { known: { slug: 'app', name: 'app', state: 'chosen' } } })), 'Work already has this folder as app.')
  assert.equal(blocker(formFor({ found: { namesake: '~/Work/app' } })), 'A project called app is already in Work.')
  assert.equal(blocker(formFor({ found: { git: false }, wants: '  ' })), 'A goal needs your words first.')
  assert.equal(blocker(formFor({ found: { git: true } })), null, 'code needs no words')
  assert.equal(blocker(formFor({ found: { git: false }, wants: 'Run the long route' })), null)
})

test('the add sends the folder, the kind and the words, and no words as none', () => {
  assert.deepEqual(newProjectArgs(formFor({ folder: ' ~/Projects/app ' })), { folder: '~/Projects/app', kind: 'code' })
  assert.deepEqual(newProjectArgs(formFor({ found: { git: false }, wants: ' Reach the long run ' })), { folder: '~/Projects/app', kind: 'goal', wants: 'Reach the long run' })
  assert.equal(newProjectArgs(formFor({ found: { git: false } })), null)
})

test('an add turns YOLO mode on after it, and its refusal keeps the add', async () => {
  const done = { slug: 'app', name: 'app', kind: 'code' as const, message: 'Added.' }
  const seen: string[] = []
  const calls = (yolo: () => Promise<unknown>) => ({
    add: async () => {
      seen.push('add')
      return done
    },
    yolo: async (args: { slug: string; on: true }) => {
      seen.push(`yolo ${args.slug}`)
      return yolo()
    },
  })
  assert.deepEqual(await addProject(formFor({ from: 'yolo' }), calls(async () => ({}))), { result: 'added', done })
  assert.deepEqual(seen, ['add', 'yolo app'])

  seen.length = 0
  assert.deepEqual(await addProject(formFor({ from: 'work' }), calls(async () => ({}))), { result: 'added', done })
  assert.deepEqual(seen, ['add'], 'off from Work')

  const refused = await addProject(formFor({ from: 'yolo' }), calls(async () => Promise.reject(new Error('YOLO mode needs a ready project.'))))
  assert.deepEqual(refused, { result: 'added-yolo-refused', done, line: 'app was added. YOLO mode did not turn on: YOLO mode needs a ready project.' })

  const no = await addProject(formFor(), { add: async () => Promise.reject(new Error('Work already has that folder.')), yolo: async () => ({}) })
  assert.deepEqual(no, { result: 'refused', line: 'Work already has that folder.' })

  seen.length = 0
  const blocked = await addProject(formFor({ found: { git: false } }), calls(async () => ({})))
  assert.equal(blocked.result, 'refused')
  assert.deepEqual(seen, [], 'nothing was sent')
})

test('N opens the popup alone, once, outside fields; Command+Enter adds', () => {
  const press = { key: 'n', metaKey: false, ctrlKey: false, altKey: false, repeat: false, handled: false, typing: false }
  assert.equal(opensNewProject(press), true)
  assert.equal(opensNewProject({ ...press, key: 'N' }), true)
  assert.equal(opensNewProject({ ...press, typing: true }), false)
  assert.equal(opensNewProject({ ...press, metaKey: true }), false, '⌘N is the frame’s')
  assert.equal(opensNewProject({ ...press, ctrlKey: true }), false)
  assert.equal(opensNewProject({ ...press, altKey: true }), false)
  assert.equal(opensNewProject({ ...press, repeat: true }), false)
  assert.equal(opensNewProject({ ...press, handled: true }), false)
  assert.equal(opensNewProject({ ...press, key: 'w' }), false)
  assert.equal(addsFromKey({ key: 'Enter', metaKey: true, ctrlKey: false }), true)
  assert.equal(addsFromKey({ key: 'Enter', metaKey: false, ctrlKey: false }), false)
})

test('the keyboard goes to the project’s row on Work and its card on YOLO mode', () => {
  assert.equal(rowAfterAdd('work', 'app'), '[data-world-project="app"]')
  assert.equal(rowAfterAdd('yolo', 'app'), '[data-yolo-project="app"]')
})

test('the sample looks from its own projects and an add changes only the sample', () => {
  const work = sampleWork()
  const projects = work.projects
  assert.equal(sampleLook('~/Projects/storefront', projects).known?.slug, 'storefront')
  assert.equal(sampleLook('~/Documents/storefront', projects).namesake, '~/Projects/storefront')
  assert.equal(sampleLook('~/Projects/newapp', projects).git, true)
  assert.equal(sampleLook('~/Documents/long-run', projects).git, false)
  assert.equal(sampleLook('~/Documents/notes.md', projects).found, 'file')
  assert.equal(sampleLook('/nowhere', projects).found, 'missing')

  const added = sampleAdd(work, { folder: '~/Documents/long-run', kind: 'goal', wants: 'Run the long route' })
  assert.ok('state' in added)
  if (!('state' in added)) return
  const project = added.state.projects.find(({ slug }) => slug === 'long-run')
  assert.equal(project?.kind, 'goal')
  assert.equal(project?.state, 'chosen')
  assert.equal(work.projects.some(({ slug }) => slug === 'long-run'), false, 'the sample it came from is as it was')
  assert.deepEqual(sampleAdd(work, { folder: '~/Projects/storefront', kind: 'code' }), { refused: 'Work already has this folder as storefront.' })
  assert.ok('state' in sampleAdd(work, { folder: '~/Documents/long-run', kind: 'code' }), 'a folder with no repository can be code too')
})
