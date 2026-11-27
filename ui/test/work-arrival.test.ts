import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readViews } from './view-draws.ts'

// The metrics tiles need a live client subscription. Keep the actual Work page, lists and Motion components.
readViews({ 'features/work/WorkTiles.tsx': { WorkTiles: () => null } })
const { WorkScreen } = await import('../src/features/work/WorkScreen.tsx')
const { useView } = await import('../src/app/view-store.ts')

test('returning below the top paints the Work panel, finished section and rows visible on their first frame', () => {
  for (const scroll of [0, 420]) {
    useView.setState({ screen: 'review', trail: [{ screen: 'work', keep: { scroll } }] })
    useView.getState().back()
    const frame = renderToStaticMarkup(createElement(WorkScreen))
    const opacity = scroll > 0 ? '1' : '0'
    assert.equal(frame.match(/role="tabpanel"[^>]*style="opacity:(\d)/)?.[1], opacity)
    assert.equal(frame.match(/style="opacity:(\d)[^"]*"><section aria-label="Finished changes"/)?.[1], opacity)
    const rows = [...frame.matchAll(/<li\b[^>]*style="opacity:(\d)/g)]
    assert.ok(rows.length > 1 && rows.every((row) => row[1] === opacity))
  }
})
