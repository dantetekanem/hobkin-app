import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Unavailable } from '../src/commands.ts'
import { readUserProfile, saveUserProfile } from '../src/profile.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

test('a home with no profile has said nothing yet', async (t) => {
  assert.deepEqual(await readUserProfile(temporaryDirectory(t)), { name: null, email: null, computer: null })
})

test("the profile is saved in hobkin's own file, what is left out stays, and it reads back", async (t) => {
  const root = temporaryDirectory(t)
  // What to call them is hobkin's own field. The setup does not ask it, and keeps it.
  writeFileSync(join(root, 'profile.json'), JSON.stringify({ callMe: 'Ada' }))

  assert.deepEqual(await saveUserProfile(root, { name: 'Ada Lovelace', computer: 'work' }), { name: 'Ada Lovelace', email: null, computer: 'work' })
  assert.deepEqual(await saveUserProfile(root, { email: 'ada@example.invalid' }), { name: 'Ada Lovelace', email: 'ada@example.invalid', computer: 'work' })

  assert.deepEqual(JSON.parse(readFileSync(join(root, 'profile.json'), 'utf8')), { callMe: 'Ada', name: 'Ada Lovelace', computer: 'work', email: 'ada@example.invalid' })
  assert.deepEqual(await readUserProfile(root), { name: 'Ada Lovelace', email: 'ada@example.invalid', computer: 'work' })
})

test("a value hobkin refuses saves nothing, and hobkin's own words say why", async (t) => {
  const root = temporaryDirectory(t)
  await saveUserProfile(root, { name: 'Ada' })

  const refusals: [Parameters<typeof saveUserProfile>[1], RegExp][] = [
    [{ name: 'Grace', email: 'not an email' }, /^That does not look like a real email\.$/],
    [{ name: 'two\nlines' }, /^Use one line of at most 120 characters\.$/],
  ]
  for (const [change, words] of refusals) {
    await assert.rejects(saveUserProfile(root, change), (error) => error instanceof Unavailable && words.test(error.message))
  }
  assert.deepEqual(await readUserProfile(root), { name: 'Ada', email: null, computer: null })
})

test('a name saved from the window greets the user at once, without a restart', async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  await client.live()
  assert.equal(client.view.snapshot.userName ?? null, null)

  assert.deepEqual(await client.run('profile.set', { name: 'Ada', computer: 'personal' }), { name: 'Ada', email: null, computer: 'personal' })
  await client.until((view) => view.snapshot.userName === 'Ada', 'the new name in the snapshot')
  assert.deepEqual(await client.run('profile.read'), { name: 'Ada', email: null, computer: 'personal' })

  const refusals: [unknown, string, RegExp][] = [
    [{}, 'invalid-arguments', /need a name, an email or a computer/],
    [{ computer: 'laptop' }, 'invalid-arguments', /computer/],
    [{ name: 'x'.repeat(121) }, 'invalid-arguments', /name/],
    [{ name: 'Ada', age: 36 }, 'invalid-arguments', /"age"/],
    [{ email: 'not an email' }, 'unavailable', /real email/],
  ]
  for (const [args, code, reason] of refusals) {
    const refused = await client.command('profile.set', args)
    assert.equal(!refused.ok && refused.error.code, code, JSON.stringify(args))
    assert.match(!refused.ok ? refused.error.message : '', reason)
  }
  assert.deepEqual(await client.run('profile.read'), { name: 'Ada', email: null, computer: 'personal' })

  // hobkin keeps its own profile command, so it cannot run these through its client tool.
  const { COMMANDS } = await import('#shared/commands/registry.ts')
  for (const name of ['profile.read', 'profile.set'] as const) {
    assert.equal('hobkin' in COMMANDS[name] || 'outside' in COMMANDS[name], false, name)
  }
})
