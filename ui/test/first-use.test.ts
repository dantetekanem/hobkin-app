import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { create } from 'zustand'
import { useWantedOnce } from '../src/app/first-use.ts'
import { mountCounting } from './render-count.ts'

/** A part loaded on first use, such as the first-run setup and the tour: whether it is mounted after each change. */
async function mountedAfter(startsOpen: boolean, changes: boolean[]) {
  const wanted = create(() => ({ open: startsOpen }))
  let mounted = false
  const Layer = () => {
    mounted = useWantedOnce(wanted((state) => state.open))
    return null
  }
  const root = await mountCounting(() => createElement(Layer))
  const seen = [mounted]
  for (const open of changes) {
    await root.change(() => wanted.setState({ open }))
    seen.push(mounted)
  }
  await root.unmount()
  return seen
}

test('a window whose setup is done mounts no setup until it opens, then keeps it for its exit', async () => {
  assert.deepEqual(await mountedAfter(false, [false, true, false, true]), [false, false, true, true, true])
})

test('a window that opens on the setup mounts it in its first draw', async () => {
  assert.deepEqual(await mountedAfter(true, [false]), [true, true])
})
