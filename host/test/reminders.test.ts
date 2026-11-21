import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ReminderReader, reminderHandlers, reminderState } from '../src/reminders.ts'
import { runCommand } from '../src/commands.ts'
import { COMMANDS } from '../../shared/commands/registry.ts'

const occurrence = (rest = {}) => ({
  id: 'call-office:2026-11-12', routineId: 'call-office', on: '2026-11-12',
  dueAt: '2026-11-12T14:00:00.000Z', timezone: 'America/Toronto', deliveredAt: '2026-11-12T14:11:00.000Z',
  title: 'Call the office', next: 'Call and ask about availability.', status: 'pending-confirmation', resolvedAt: null, ...rest,
})
function fixture(t: test.TestContext, entries = [occurrence()]) {
  const root = mkdtempSync(join(resolve(tmpdir()), 'hobkin-reminder-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'client'))
  const file = join(root, 'client', 'reminder-occurrences.json')
  writeFileSync(file, JSON.stringify({ version: 1, entries }))
  return { root, file }
}

test('a saved occurrence references the original report without making a decision, inbox notice or routine', t => {
  const { root } = fixture(t)
  assert.deepEqual(reminderState(root), { home: root, entries: [occurrence()] })
})

test('each publish reads the reminders again only when their file changed', t => {
  const { root, file } = fixture(t)
  const reader = new ReminderReader()
  const first = reader.read(root)
  assert.deepEqual(first, { home: root, entries: [occurrence()] })
  assert.equal(reader.read(root), first, 'an unchanged file gives what was read')

  writeFileSync(file, JSON.stringify({ version: 1, entries: [occurrence({ status: 'done', resolvedAt: '2026-11-12T15:00:00.000Z' })] }))
  assert.equal(reader.read(root).entries[0]?.status, 'done')
  rmSync(file)
  const none = reader.read(root)
  assert.deepEqual(none, { home: root, entries: [] })
  assert.equal(reader.read(root), none)
  const other = fixture(t)
  assert.deepEqual(reader.read(other.root), { home: other.root, entries: [occurrence()] }, 'another home is read')
})
for (const status of ['done', 'dismissed'] as const) {
  test(`explicit ${status} persists across a new reader, retention and root changes`, async t => {
    const unrelated = occurrence({ id: 'another-office:2026-11-12', routineId: 'another-office' })
    const { root, file } = fixture(t, [occurrence(), unrelated])
    const other = fixture(t)
    let current = root
    let publications = 0
    const handlers = reminderHandlers({ root: () => current, changed: () => { publications++ } })
    const args = { home: root, id: occurrence().id, status }
    const result = await runCommand(handlers, 'reminder.resolve', args)
    assert.equal(result.ok, true)
    const saved = reminderState(root).entries[0]!
    assert.equal(saved.status, status)
    assert.ok(saved.resolvedAt)
    assert.equal(publications, 1)
    assert.deepEqual(reminderState(root).entries[1], unrelated)
    assert.deepEqual(readdirSync(root), ['client'])
    assert.deepEqual(readdirSync(join(root, 'client')), ['reminder-occurrences.json'])
    const bytes = readFileSync(file, 'utf8')
    // A retry or a conflicting terminal choice cannot rewrite the user's first recorded transition.
    assert.equal((await runCommand(handlers, 'reminder.resolve', { ...args, status: status === 'done' ? 'dismissed' : 'done' })).ok, true)
    assert.equal(readFileSync(file, 'utf8'), bytes)
    current = other.root
    assert.equal((await runCommand(handlers, 'reminder.resolve', args)).ok, false)
    assert.equal(reminderState(other.root).entries[0]?.status, 'pending-confirmation')
    current = root
    assert.deepEqual(reminderState(current).entries[0], saved)
  })
}

test('the command is user-only and accepts neither paths, arbitrary states nor unknown identities', async t => {
  const { root, file } = fixture(t)
  const handlers = reminderHandlers({ root: () => root, changed: () => {} })
  const before = readFileSync(file, 'utf8')
  assert.notEqual('hobkin' in COMMANDS['reminder.resolve'] && COMMANDS['reminder.resolve'].hobkin, true)
  for (const args of [
    { home: root, id: '../other', status: 'done' },
    { home: root, id: 'other:2026-11-12', status: 'done' },
    { home: root, id: occurrence().id, status: 'read' },
    { home: root, id: occurrence().id, status: 'done', path: '/other' },
  ]) assert.equal((await runCommand(handlers, 'reminder.resolve', args)).ok, false)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('malformed, duplicate and cross-routine references cannot mutate the file', async t => {
  const { root, file } = fixture(t)
  const handlers = reminderHandlers({ root: () => root, changed: () => {} })
  for (const entries of [
    [occurrence({ routineId: 'other' })], [occurrence(), occurrence()],
    [occurrence({ dueAt: 'not a date' })], [occurrence({ timezone: '../zone' })],
    [occurrence({ on: '2026-11-13' })], [occurrence({ status: 'done', resolvedAt: null })],
  ]) {
    writeFileSync(file, JSON.stringify({ version: 1, entries }))
    const before = readFileSync(file, 'utf8')
    assert.throws(() => reminderState(root))
    assert.equal((await runCommand(handlers, 'reminder.resolve', { home: root, id: occurrence().id, status: 'done' })).ok, false)
    assert.equal(readFileSync(file, 'utf8'), before)
  }
})

test('a missing metadata file is empty; symlinked files and directories never reach their targets', async t => {
  const { root, file } = fixture(t)
  rmSync(file)
  assert.deepEqual(reminderState(root).entries, [])
  const target = join(root, 'untouched')
  writeFileSync(target, 'do not change')
  symlinkSync(target, file)
  const handlers = reminderHandlers({ root: () => root, changed: () => {} })
  assert.throws(() => reminderState(root))
  assert.equal((await runCommand(handlers, 'reminder.resolve', { home: root, id: occurrence().id, status: 'done' })).ok, false)
  assert.equal(readFileSync(target, 'utf8'), 'do not change')
  rmSync(file)
  rmSync(join(root, 'client'), { recursive: true })
  const other = fixture(t)
  symlinkSync(join(other.root, 'client'), join(root, 'client'))
  assert.throws(() => reminderState(root))
  assert.equal(reminderState(other.root).entries[0]?.status, 'pending-confirmation')
})
