import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INTRO_KEY, introSeen, markIntroSeen } from '../src/features/hobkins/intro.ts'

/** A window's storage, as much of it as the explanation uses. */
function storage(): Pick<Storage, 'getItem' | 'setItem'> & { kept: Map<string, string> } {
  const kept = new Map<string, string>()
  return { kept, getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => void kept.set(key, value) }
}

test('the explanation shows once', () => {
  const window = storage()
  assert.equal(introSeen(window), false, 'the first Command+N explains first')
  markIntroSeen(window)
  assert.equal(introSeen(window), true, 'afterwards the sheet opens on the form')
  assert.deepEqual([...window.kept.keys()], [INTRO_KEY], 'one key in the window storage')

  const broken = {
    getItem: () => {
      throw new Error('storage is off')
    },
    setItem: () => {
      throw new Error('storage is off')
    },
  }
  assert.equal(introSeen(broken), false, 'without storage it explains again, which does no harm')
  assert.doesNotThrow(() => markIntroSeen(broken))
  assert.equal(introSeen(undefined), false, 'a window with no storage at all')
})
