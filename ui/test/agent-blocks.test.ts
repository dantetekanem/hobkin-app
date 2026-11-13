import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blockOpen, useBlocks } from '../src/features/agent-activity/blocks.ts'

const all = () => useBlocks.getState()
/** A block of a kind Settings opens by default, or keeps closed, that arrived at this press of Control+O. */
const opens = (since = all().turn) => ({ byDefault: true, since })
const closed = (since = all().turn) => ({ byDefault: false, since })

test('a block arrives open or closed as Settings says for its kind, and a change in Settings applies at once', () => {
  useBlocks.setState(useBlocks.getInitialState())
  assert.equal(blockOpen(null, all(), opens()), true, 'a code change arrives open')
  assert.equal(blockOpen(null, all(), closed()), false, 'a command arrives closed to its one-line header')
  // What Settings says is read each time, so a block nobody opened or closed by hand follows it.
  const choseByHand = { open: false, turn: all().turn }
  assert.equal(blockOpen(choseByHand, all(), opens()), false, 'one closed by its header keeps what was chosen')
  assert.equal(blockOpen({ open: true, turn: all().turn }, all(), closed()), true, 'and so does one opened by its header')
})

test('Control+O opens every block and closes them all again, over what was chosen for one of them', () => {
  useBlocks.setState(useBlocks.getInitialState())
  const clicked = { open: true, turn: all().turn }
  assert.equal(blockOpen(clicked, all(), closed()), true, 'a click on its header opens just that block')
  assert.equal(blockOpen(null, all(), closed()), false, 'the others stay closed')

  all().toggleAll()
  assert.equal(blockOpen(null, all(), closed(0)), true, 'every block opens')
  assert.equal(blockOpen(null, all(), closed()), true, 'and one that arrives while they are open arrives open')
  assert.equal(blockOpen(clicked, all(), closed(0)), true)
  const closedAgain = { open: false, turn: all().turn }
  assert.equal(blockOpen(closedAgain, all(), closed(0)), false, 'one closed by its header stays closed while the rest are open')

  all().toggleAll()
  assert.equal(blockOpen(null, all(), closed(0)), false, 'every block closes')
  assert.equal(blockOpen(null, all(), opens(0)), false, 'a code change too')
  assert.equal(blockOpen(clicked, all(), closed(0)), false)
  assert.equal(blockOpen(closedAgain, all(), closed(0)), false)
  assert.equal(blockOpen(null, all(), opens()), true, 'a code change that arrives after they closed arrives open again')
})
