import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement as h, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnimatePresence, motion } from 'motion/react'
import { WidgetCell, WidgetCells } from '../src/features/home/cells.ts'

const KINDS = ['needs', 'running', 'upcoming']

/**
 * Home as the canvas holds it: a screen section and its own entrance (Canvas.tsx), Home's staggered column
 * (HomeScreen.tsx), then the dashboard grid's presence and cells. `initial: false` is the canvas on the app's first
 * paint, which draws the opening screen in place and plays no entrance for it.
 */
function home(opening: boolean): string {
  const grid = h(WidgetCells, null, KINDS.map(kind => h(WidgetCell, { key: kind, children: kind })))
  const column = h(motion.div, { variants: { enter: {}, center: {} } }, grid)
  const arrive = h(motion.div, { variants: { enter: {}, center: {} }, initial: 'enter', animate: 'center' }, column)
  const section = h(motion.section, { key: 'home', variants: { enter: {}, center: {} }, initial: 'enter', animate: 'center' }, arrive)
  const canvas = (children: ReactNode) => h(AnimatePresence, opening ? { initial: false } : {}, children)
  return renderToStaticMarkup(canvas(section))
}

test('opening the app on Home draws every widget at rest, since no screen entrance will play them in', () => {
  const page = home(true)
  assert.doesNotMatch(page, /opacity:0/)
  assert.equal(page.match(/opacity:1/g)?.length, KINDS.length)
})

test('arriving at Home leaves the widgets at their entrance, for the screen stagger to play them in', () => {
  const page = home(false)
  assert.equal(page.match(/opacity:0/g)?.length, KINDS.length)
})
