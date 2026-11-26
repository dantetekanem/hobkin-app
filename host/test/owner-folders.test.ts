import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { test } from 'node:test'
import { usersFolders } from '../src/owner.ts'

test("only the real home is given the user's teams home and Pi's folder, and no other home loads Pi to find it", async () => {
  let loaded = 0
  const loadPi = async () => {
    loaded += 1
    return { getAgentDir: () => '/pi-folder.invalid' }
  }

  assert.deepEqual(await usersFolders(false, loadPi), {})
  assert.equal(loaded, 0, 'a home started for development or a test never asks Pi where its folder is')
  assert.deepEqual(await usersFolders(true, loadPi), { teamsHome: homedir(), piAgentDir: '/pi-folder.invalid' })
  assert.deepEqual(await usersFolders(true, async () => { throw Error('no Pi') }), { teamsHome: homedir() }, 'without Pi hobkin still starts, learning nothing')
})
