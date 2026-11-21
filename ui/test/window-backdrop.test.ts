import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backdropOf, followBackdrop, startWindowBackdrop } from '../src/app/window-backdrop.ts'

/** A page whose background the test changes, and that counts what watches it. */
function fakePage(background: string) {
  let changed: (() => void) | null = null
  const page = {
    background,
    watching: 0,
    read: () => page.background,
    watch(listener: () => void) {
      page.watching += 1
      changed = listener
      return () => {
        page.watching -= 1
        changed = null
      }
    },
    change(next: string) {
      page.background = next
      changed?.()
    },
  }
  return page
}

test('the page background reads as how much of it shows and its color, in the forms WebKit gives', () => {
  assert.deepEqual(backdropOf('rgb(14, 15, 19)'), { opacity: 1, color: [14, 15, 19] })
  assert.deepEqual(backdropOf('rgba(240, 234, 214, 0.35)'), { opacity: 0.35, color: [240, 234, 214] })
  assert.deepEqual(backdropOf('rgb(240 234 214 / 50%)'), { opacity: 0.5, color: [240, 234, 214] })
  assert.deepEqual(backdropOf('color(srgb 0.0549 0.0588 0.0745)'), { opacity: 1, color: [14, 15, 19] })
  assert.deepEqual(backdropOf('color(srgb 0.941 0.918 0.839 / 0.8)'), { opacity: 0.8, color: [240, 234, 214] })
  assert.deepEqual(backdropOf('color(srgb 1.2 -0.01 1e-5)'), { opacity: 1, color: [255, 0, 0] })
  assert.equal(backdropOf('oklab(0.2 0.01 0.02)'), null, 'a form it does not read tells the shell nothing')
  assert.equal(backdropOf(''), null)
})

test('the shell hears the backdrop as the window starts, and again only when the page background changes', () => {
  const page = fakePage('rgb(14, 15, 19)')
  const told: unknown[] = []
  const stop = followBackdrop(page, (backdrop) => told.push(backdrop))
  assert.deepEqual(told, [{ opacity: 1, color: [14, 15, 19] }])

  page.change('rgb(14, 15, 19)')
  page.change('lab(20 1 2)')
  assert.equal(told.length, 1, 'the same background, or one it cannot read, tells nothing')

  page.change('color(srgb 0.0549 0.0588 0.0745 / 0.8)')
  assert.deepEqual(told.at(-1), { opacity: 0.8, color: [14, 15, 19] })
  page.change('rgb(14, 15, 19)')
  assert.deepEqual(told.at(-1), { opacity: 1, color: [14, 15, 19] })
  assert.equal(told.length, 3)

  stop()
  assert.equal(page.watching, 0)
})

test('a shell from before the command is never asked, and the page is not watched', async () => {
  const page = fakePage('rgb(14, 15, 19)')
  startWindowBackdrop(async () => ({ backdrop: null }), page)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(page.watching, 0)
})

test('a shell with the command hears the backdrop, and a refusal changes nothing in the window', async () => {
  const page = fakePage('rgb(14, 15, 19)')
  const told: unknown[] = []
  const stop = startWindowBackdrop(async () => ({
    backdrop: {
      set: async (backdrop) => {
        told.push(backdrop)
        throw new Error('not the main window')
      },
    },
  }), page)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(told, [{ opacity: 1, color: [14, 15, 19] }])
  assert.equal(page.watching, 1)
  stop()
  assert.equal(page.watching, 0)
})
