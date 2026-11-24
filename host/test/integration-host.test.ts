import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Type } from 'typebox'
import { allCommands, checkArguments, commandDefinition, isCommand, isScreen, registerIntegration } from '#shared/commands/registry.ts'
import { defineIntegration, type IntegrationManifest } from '#shared/integration/manifest.ts'

const nothing = Type.Object({}, { additionalProperties: false })
const manifest = (id: string, extra: Partial<IntegrationManifest> = {}): IntegrationManifest => ({
  id,
  name: id,
  line: 'A test integration',
  commands: { [`${id}.ping`]: { description: 'Ping', runs: 'host', args: Type.Object({ n: Type.Integer() }, { additionalProperties: false }), hobkin: true } },
  screens: [{ id: `${id}-page`, label: id, line: 'A page', keywords: [] }],
  ...extra,
})

test('an integration registers its commands and screens, and the registry checks them as its own', () => {
  registerIntegration(defineIntegration(manifest('reg-one')))
  assert.equal(isCommand('reg-one.ping'), true)
  assert.equal(commandDefinition('reg-one.ping')?.hobkin, true)
  assert.ok(allCommands().some(([name]) => name === 'reg-one.ping'))
  assert.equal(isScreen('reg-one-page'), true)
  assert.deepEqual(checkArguments('reg-one.ping', { n: 1 }), { ok: true })
  const bad = checkArguments('reg-one.ping', { n: 'one' })
  assert.equal(!bad.ok && bad.code, 'invalid-arguments')
  const unknown = checkArguments('reg-one.nothing', {})
  assert.equal(!unknown.ok && unknown.code, 'unknown-command')
})

test('registering is refused with the reason, and leaves nothing behind', () => {
  assert.throws(() => registerIntegration(manifest('Bad Id')), /not an integration id/)
  assert.throws(() => registerIntegration(manifest('reg-two', { commands: { 'other.ping': { description: 'x', runs: 'host', args: nothing } } })), /reg-two\.<something>/)
  assert.throws(() => registerIntegration(manifest('reg-two', { commands: { 'reg-two.': { description: 'x', runs: 'host', args: nothing } } })), /reg-two\.<something>/)
  assert.throws(() => registerIntegration(manifest('app', { commands: { 'app.state': { description: 'x', runs: 'host', args: nothing } } })), /already has/)
  // The second command is a duplicate: the first must not stay registered.
  assert.throws(() => registerIntegration(manifest('reg-three', { commands: { 'reg-three.a': { description: 'x', runs: 'host', args: nothing }, 'reg-three.b': { description: 'x', runs: 'host', args: nothing } }, screens: [{ id: 'work', label: 'x', line: 'x', keywords: [] }] })), /screen/)
  assert.equal(isCommand('reg-three.a'), false)
  assert.equal(isScreen('reg-three-page'), false)
  registerIntegration(manifest('reg-four'))
  assert.throws(() => registerIntegration(manifest('reg-four')), /already has/)
  assert.throws(() => registerIntegration(manifest('reg-five', { screens: [{ id: 'reg-four-page', label: 'x', line: 'x', keywords: [] }] })), /already has/)
  assert.equal(isCommand('reg-five.ping'), false)
})

test('view.open takes a core screen or a registered one, and refuses any other', () => {
  registerIntegration(manifest('reg-six'))
  assert.deepEqual(checkArguments('view.open', { screen: 'work' }), { ok: true })
  assert.deepEqual(checkArguments('view.open', { screen: 'reg-six-page' }), { ok: true })
  assert.equal(checkArguments('view.open', { screen: 'nowhere' }).ok, false)
})
