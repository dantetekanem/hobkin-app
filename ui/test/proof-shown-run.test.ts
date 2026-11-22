import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, useState } from 'react'
import { useShownRun } from '../src/features/proofs/shown-run.ts'
import { mountCounting } from './render-count.ts'

test('a panel tells its holder each run it shows: the first, every one J and K move to, and a new one the holder asks for', async () => {
  const told: string[] = []
  const handles = {} as { ask: (id: string) => void; move: (id: string) => void; retell: () => void }
  const Probe = () => {
    const [asked, ask] = useState('one')
    // A holder that hands a new function on each draw is told only when the run changes.
    const [, redraw] = useState(0)
    const [, move] = useShownRun(asked, (id) => told.push(id))
    Object.assign(handles, { ask, move, retell: () => redraw((count) => count + 1) })
    return null
  }
  const mounted = await mountCounting(() => createElement(Probe))
  assert.deepEqual(told, ['one'], 'the first run, once')

  await mounted.change(() => handles.move('two'))
  await mounted.change(() => handles.move('three'))
  await mounted.change(() => handles.move('three'))
  assert.deepEqual(told, ['one', 'two', 'three'], 'each run J and K move to, once')

  await mounted.change(() => handles.retell())
  assert.deepEqual(told, ['one', 'two', 'three'], 'a new function is not a new run')

  await mounted.change(() => handles.ask('four'))
  assert.deepEqual(told, ['one', 'two', 'three', 'four'], 'a run the holder asks for')
  await mounted.unmount()
})
