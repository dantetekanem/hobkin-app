import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SlashCommand } from '#shared/protocol/slash.ts'
import { closedSlash, slashKey, slashList, slashTyped, type SlashList } from '../src/features/chat/slash.ts'

const command = (name: string, count = 0, source: SlashCommand['source'] = 'hobkin'): SlashCommand => ({ name, description: `what ${name} does`, source, count })

// hobkin's own in the terminal app's order, then Pi's.
const COMMANDS = [
  command('/help', 2),
  command('/setup'),
  command('/clear', 9),
  command('/reset'),
  command('/work', 4),
  command('/learning', 4),
  command('/feedback'),
  command('/review', 7, 'pi'),
  command('/skill:release-notes', 1, 'pi'),
  command('/worktree', 0, 'pi'),
]
const names = (list: SlashList | null) => list?.rows.map(({ name }) => name) ?? null
const open = (text: string, selected = 0) => slashList(text, COMMANDS, { selected, closedFor: null })

test('an opening slash lists the five most used, and a later slash lists nothing', () => {
  // Most used first. Two with the same count keep the list's own order.
  assert.deepEqual(names(open('/')), ['/clear', '/review', '/work', '/learning', '/help'])
  assert.equal(open('/')?.rows.length, 5, 'never more than five')
  assert.deepEqual(open('/')?.rows[0], { name: '/clear', description: 'what /clear does', source: 'hobkin', count: 9 })

  // While nothing has been counted yet, the list's own order stands: hobkin's commands first.
  const fresh = COMMANDS.map((listed) => ({ ...listed, count: 0 }))
  assert.deepEqual(names(slashList('/', fresh, closedSlash)), ['/help', '/setup', '/clear', '/reset', '/work'])

  // Only a slash that starts the message is a command being typed.
  for (const text of ['', 'hello', 'see /help', ' /help', 'a/b', 'https://hobkin.dev/', '2/3']) assert.equal(open(text), null, JSON.stringify(text))
  // Once the command is written out and its arguments begin, the list has done its work.
  assert.equal(open('/work on'), null)
  assert.equal(open('/feedback the list flickers'), null)
  assert.equal(open('/help\n'), null)
  // With no commands known yet there is nothing to list.
  assert.equal(slashList('/', [], closedSlash), null)
})

test('typing narrows to the best matches', () => {
  // A name that starts with what was typed comes before one that only contains it. Among equals the most used leads.
  assert.deepEqual(names(open('/wor')), ['/work', '/worktree'])
  assert.deepEqual(names(open('/re')), ['/review', '/reset', '/skill:release-notes', '/worktree'], 'the two that start with it, then the two that contain it')
  assert.deepEqual(names(open('/e')), ['/clear', '/review', '/learning', '/help', '/skill:release-notes'], 'five at most, however many match')
  assert.deepEqual(names(open('/LEARN')), ['/learning'], 'capitals do not matter')
  assert.deepEqual(names(open('/help')), ['/help'])

  // Nothing matches: the list stays, says so, and offers nothing to pick.
  const none = open('/zzz')
  assert.deepEqual(none?.rows, [])
  assert.equal(none?.query, 'zzz')
  assert.equal(none?.selected, null)

  // The selection is a row of the list, wherever it was before the list narrowed.
  assert.equal(open('/', 3)?.selected, 3)
  assert.equal(open('/wor', 3)?.selected, 1, 'never past the last row')
})

test('tab completes, enter runs, escape keeps the text', () => {
  const state = { selected: 0, closedFor: null }

  // Down and Up walk the rows and stop at the ends.
  const list = (text: string, selected: number) => ({ text, commands: COMMANDS, state: { selected, closedFor: null } })
  assert.deepEqual(slashKey(list('/', 0), 'ArrowDown'), { state: { selected: 1, closedFor: null } })
  assert.deepEqual(slashKey(list('/', 4), 'ArrowDown'), { state: { selected: 4, closedFor: null } })
  assert.deepEqual(slashKey(list('/', 1), 'ArrowUp'), { state: { selected: 0, closedFor: null } })
  assert.deepEqual(slashKey(list('/', 0), 'ArrowUp'), { state: { selected: 0, closedFor: null } })

  // Tab writes the selected command into the input, ready for what follows it. Nothing runs.
  assert.deepEqual(slashKey(list('/wor', 1), 'Tab'), { text: '/worktree ', state })
  assert.deepEqual(slashKey(list('/', 0), 'Tab'), { text: '/clear ', state })

  // Enter runs the selected command and empties the input.
  assert.deepEqual(slashKey(list('/le', 0), 'Enter'), { run: { name: '/learning', args: '' }, text: '', state })
  assert.deepEqual(slashKey(list('/', 2), 'Enter'), { run: { name: '/work', args: '' }, text: '', state })

  // Escape closes the list for the text as it stands. The text stays, and typing on opens the list again.
  const escaped = slashKey(list('/wor', 0), 'Escape')
  assert.deepEqual(escaped, { state: { selected: 0, closedFor: '/wor' } })
  assert.equal(slashList('/wor', COMMANDS, escaped!.state), null)
  assert.deepEqual(names(slashList('/work', COMMANDS, slashTyped(escaped!.state, '/work'))), ['/work', '/worktree'])
  // Typing moves the selection back to the best match.
  assert.deepEqual(slashTyped({ selected: 3, closedFor: null }, '/w'), state)

  // With no match there is nothing to complete or run: the keys are not the list's, so Enter sends the text as a message.
  for (const key of ['Enter', 'Tab', 'ArrowDown', 'ArrowUp'] as const) assert.equal(slashKey(list('/zzz', 0), key), null, key)
  assert.deepEqual(slashKey(list('/zzz', 0), 'Escape'), { state: { selected: 0, closedFor: '/zzz' } })
  // With the list closed the keys are not the list's either, so Tab is the frame's again.
  for (const key of ['Enter', 'Tab', 'ArrowDown', 'Escape'] as const) assert.equal(slashKey(list('hello', 0), key), null, key)
  assert.equal(slashKey({ text: '/wor', commands: COMMANDS, state: { selected: 0, closedFor: '/wor' } }, 'Tab'), null)
})

test('a command written out with what follows it runs with those words', async () => {
  const { slashCommandIn } = await import('../src/features/chat/slash.ts')

  assert.deepEqual(slashCommandIn('/feedback the list flickers\non the second line', COMMANDS), { name: '/feedback', args: 'the list flickers\non the second line' })
  assert.deepEqual(slashCommandIn('/work   ~/code/storefront  ', COMMANDS), { name: '/work', args: '~/code/storefront' })
  assert.deepEqual(slashCommandIn('/help', COMMANDS), { name: '/help', args: '' })
  // What is not a command is a message, slash or not.
  assert.equal(slashCommandIn('/usr/local/bin is on my path', COMMANDS), null)
  assert.equal(slashCommandIn('/zzz', COMMANDS), null)
  assert.equal(slashCommandIn('see /help', COMMANDS), null)
})
