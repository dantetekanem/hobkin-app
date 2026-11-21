import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { strictWhenAsked } from '../src/app/strict.ts'
import { mountCounting } from './render-count.ts'

/** How many times one draw of the window's tree runs a component's body, with this environment. */
async function bodiesPerDraw(env: { VITE_STRICT?: string }) {
  let bodies = 0
  const Counted = () => {
    bodies += 1
    return null
  }
  const mounted = await mountCounting(() => strictWhenAsked(createElement(Counted), env))
  await mounted.unmount()
  return bodies
}

test('the window runs each component once per draw, and twice only with VITE_STRICT=1', async () => {
  assert.equal(await bodiesPerDraw({}), 1)
  assert.equal(await bodiesPerDraw({ VITE_STRICT: '0' }), 1)
  assert.equal(await bodiesPerDraw({ VITE_STRICT: '1' }), 2)
})
