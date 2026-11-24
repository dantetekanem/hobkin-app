import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COMMANDS } from '#shared/commands/registry.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand, Unavailable } from '../src/commands.ts'
import { chooseFolder, folderPickHandlers, type PickRun } from '../src/folder-pick.ts'

type Ending = { out?: string; fail?: { code?: number; stderr?: string } }

/** A runner that records what it was asked and ends as told, without any dialog. */
function fakeRun(ending: Ending, calls: string[][] = []): PickRun {
  return (file, args, done) => {
    calls.push([file, ...args])
    if (ending.fail) done(Object.assign(Error('failed'), { code: ending.fail.code }), '', ending.fail.stderr ?? '')
    else done(null, ending.out ?? '', '')
  }
}

test('a picked folder comes back without the newline and the trailing slash, and the chooser is the Mac\'s own', async () => {
  const calls: string[][] = []
  assert.equal(await chooseFolder(fakeRun({ out: '/Users/me/code/storefront/\n' }, calls), 'darwin'), '/Users/me/code/storefront')
  assert.equal(calls[0]![0], 'osascript')
  assert.match(calls[0]!.join(' '), /choose folder/)
  assert.equal(await chooseFolder(fakeRun({ out: '/\n' }), 'darwin'), '/')
})

test('closing the chooser is no folder, and any other failure says so in plain words', async () => {
  const closed = { fail: { code: 1, stderr: '0:30: execution error: User canceled. (-128)' } }
  assert.equal(await chooseFolder(fakeRun(closed), 'darwin'), null)
  await assert.rejects(chooseFolder(fakeRun({ fail: { code: 1, stderr: 'boom' } }), 'darwin'), /could not show the folder chooser/i)
  await assert.rejects(chooseFolder(fakeRun({ out: '\n' }), 'darwin'), /no folder/i)
})

test('on another platform the chooser is unavailable and nothing runs', async () => {
  const calls: string[][] = []
  await assert.rejects(chooseFolder(fakeRun({ out: '/x' }, calls), 'linux'), (error) => error instanceof Unavailable && /only on a Mac/.test(error.message))
  assert.deepEqual(calls, [])
})

test('a second press while the chooser is open gets the first one\'s answer, and opens no second chooser', async () => {
  const calls: string[][] = []
  let finish: () => void = () => {}
  const run: PickRun = (file, args, done) => {
    calls.push([file, ...args])
    finish = () => done(null, '/a/b/\n', '')
  }
  const handlers = folderPickHandlers({ pick: () => chooseFolder(run, 'darwin') })
  const first = runCommand(handlers, 'work.folder.pick', {})
  const second = runCommand(handlers, 'work.folder.pick', {})
  finish()
  assert.deepEqual(await first, { ok: true, value: { folder: '/a/b' } })
  assert.deepEqual(await second, { ok: true, value: { folder: '/a/b' } })
  assert.equal(calls.length, 1)
  // Once it has ended, the next press opens a new one.
  const third = runCommand(handlers, 'work.folder.pick', {})
  assert.equal(calls.length, 2)
  finish()
  await third
})

test("only the window sends it: hobkin's client tool neither lists nor runs it", async () => {
  const ran: string[] = []
  const tool = createClientTool({ run: async (name) => (ran.push(name), { ok: true, value: {} }) })
  assert.equal(COMMANDS['work.folder.pick'].runs, 'host')
  assert.equal('hobkin' in COMMANDS['work.folder.pick'], false)
  const listed = (await tool.execute('1', { action: 'list' })).details as { name: string }[]
  assert.equal(listed.some((command) => command.name === 'work.folder.pick'), false)
  await assert.rejects(tool.execute('2', { action: 'run', name: 'work.folder.pick', args: {} }), /cannot run work\.folder\.pick/)
  assert.deepEqual(ran, [])
})
