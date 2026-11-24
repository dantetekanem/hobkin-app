import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkArguments, COMMANDS } from '#shared/commands/registry.ts'
import { readYoloNames, readYoloRules } from '#shared/protocol/work.ts'

test('work.yolo.rules is the window\'s alone: outside, and not one of hobkin\'s own commands', () => {
  const command = COMMANDS['work.yolo.rules']
  assert.equal(command.outside, true)
  assert.equal('hobkin' in command, false)
  assert.equal(command.runs, 'host')
})

test('work.yolo.rules takes rules for every project or one, and names the rules a project gives back', () => {
  const ok = [
    { rules: { lowestRate: 8.4 } },
    { rules: { mostLines: null, mergePulls: true, kinds: ['bug-fix'], reviewPulls: 'both' } },
    { slug: 'web', rules: { lowestRate: 7 } },
    { slug: 'web', clear: ['lowestRate'] },
    { slug: 'web', rules: { lowestRate: 7 }, clear: ['mostLines'] },
  ]
  for (const args of ok) assert.deepEqual(checkArguments('work.yolo.rules', args), { ok: true }, JSON.stringify(args))

  const refused = [
    {},
    { rules: {} },
    { slug: 'Not a slug', rules: { lowestRate: 7 } },
    { rules: { lowestRate: { deep: 1 } } },
    { rules: { lowestRate: 8 }, clear: ['lowestRate'] },
    { clear: ['lowestRate'] },
    { rules: { lowestRate: 8 }, extra: true },
  ]
  for (const args of refused) assert.equal(checkArguments('work.yolo.rules', args).ok, false, JSON.stringify(args))
})

test('rules a runtime sent read as they came, and a runtime that has none reads as none', () => {
  const sent = { lowestRate: 8, tests: true, mostLines: null, kinds: ['bug-fix', 'small-change'], reviewPulls: 'both' }
  assert.deepEqual(readYoloRules(sent), sent)
  for (const none of [undefined, null, 'on', 3, [], [1]]) assert.equal(readYoloRules(none), undefined, JSON.stringify(none))
  assert.deepEqual(readYoloRules({ lowestRate: 8, odd: { a: 1 }, worse: [1], nan: Number.NaN }), { lowestRate: 8 })
  assert.deepEqual(readYoloNames(['lowestRate']), ['lowestRate'])
  for (const none of [undefined, 'lowestRate', [1], null]) assert.equal(readYoloNames(none), undefined)
})
