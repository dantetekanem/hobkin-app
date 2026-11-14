import assert from 'node:assert/strict'
import { test } from 'node:test'
import { themeSwatches, themeToRestore } from '../src/features/settings/kept-themes.ts'

const DRACULA = { background: '#282a36', surface: '#343746', text: '#f8f8f2', muted: '#b5b9d6', accent: '#bd93f9' }
const BURGER = { background: '#fff0d3', surface: '#fffaed', text: '#482b1b', muted: '#785b43', accent: '#b93224' }
const burger = { id: '0000000b', name: 'Burger Joint', asked: null, palette: BURGER, at: '2026-11-13T22:51:51.303Z' }
const dracula = { id: '0000000a', name: null, asked: 'dracula!', palette: DRACULA, photo: 'milky-way' as const, at: '2026-11-13T03:30:11.423Z' }

test('Custom brings back the theme shown last, or the newest when that one is gone', () => {
  assert.equal(themeToRestore({ themes: [burger, dracula], worn: dracula.id, showing: false })?.id, dracula.id)
  assert.equal(themeToRestore({ themes: [burger, dracula], worn: null, showing: false })?.id, burger.id)
  assert.equal(themeToRestore({ themes: [burger], worn: 'ffffffff', showing: false })?.id, burger.id)
  assert.equal(themeToRestore({ themes: [], worn: null, showing: false }), null)
  assert.equal(themeToRestore(null), null)
  assert.equal(themeToRestore(undefined), null, 'a host from before kept themes')
})

test('only the theme on now is marked, and only while the window shows a custom theme', () => {
  const kept = { themes: [burger, dracula], worn: burger.id, showing: true }
  assert.deepEqual(themeSwatches(kept, true).map(({ on }) => on), [true, false])
  assert.deepEqual(themeSwatches(kept, false).map(({ on }) => on), [false, false], 'a built-in theme is showing here')
  assert.deepEqual(themeSwatches({ ...kept, showing: false }, true).map(({ on }) => on), [false, false])
})

test('a swatch is named by its name, else by the words the user asked with, and its colors are checked again', () => {
  const [named, unnamed] = themeSwatches({ themes: [burger, dracula], worn: null, showing: false }, true)
  assert.deepEqual([named!.title, named!.asked, named!.photo], ['Burger Joint', null, false])
  assert.deepEqual([unnamed!.title, unnamed!.asked, unnamed!.photo], ['dracula!', null, true], 'the words are not said twice')
  const broken = { ...burger, id: '0000000c', palette: { ...BURGER, accent: 'url(https://invalid.test/x)' } }
  const unreadable = { ...burger, id: '0000000d', palette: { ...BURGER, text: BURGER.background } }
  const badBorder = { ...burger, id: '0000000e', border: 'red' }
  assert.deepEqual(themeSwatches({ themes: [broken, unreadable, badBorder, burger], worn: null, showing: false }, true).map(({ id }) => id), [burger.id])
})
