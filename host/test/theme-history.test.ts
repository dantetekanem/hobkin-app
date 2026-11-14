import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KEPT_THEMES_MAX } from '#shared/protocol/theme-history.ts'
import {
  NO_THEMES,
  decodeThemeHistory,
  encodeThemeHistory,
  findColors,
  forgetTheme,
  keepTheme,
  keptThemes,
  photoTheme,
  renameTheme,
  wearTheme,
} from '../src/theme-history.ts'

const DRACULA = { background: '#282a36', surface: '#343746', text: '#f8f8f2', muted: '#b5b9d6', accent: '#bd93f9' }
const BURGER = { background: '#fff0d3', surface: '#fffaed', text: '#482b1b', muted: '#785b43', accent: '#b93224' }
const id = (n: number) => n.toString(16).padStart(8, '0')
const at = (day: number) => `2026-11-${String(day).padStart(2, '0')}T12:00:00.000Z`

test('a new theme goes first and is the one worn; the same colors again keep their place', () => {
  const first = keepTheme(NO_THEMES, { palette: DRACULA }, { id: id(1), at: at(13), name: 'Dracula', asked: 'dracula!' })
  const second = keepTheme(first.history, { palette: BURGER }, { id: id(2), at: at(14), name: 'Burger Joint' })
  assert.deepEqual(second.history.themes.map(({ name }) => name), ['Burger Joint', 'Dracula'])
  assert.equal(second.history.worn, id(2))
  assert.deepEqual(first.theme, { id: id(1), name: 'Dracula', asked: 'dracula!', palette: DRACULA, at: at(13) })

  // Asking for Dracula's colors again wears the kept one, renamed if hobkin named it, and adds nothing.
  const again = keepTheme(second.history, { palette: DRACULA }, { id: id(3), at: at(15), name: 'Count' })
  assert.deepEqual(again.history.themes.map(({ id }) => id), [id(2), id(1)])
  assert.deepEqual([again.theme.id, again.theme.name, again.theme.asked, again.history.worn], [id(1), 'Count', 'dracula!', id(1)])
  // With no name, the kept name stays.
  assert.equal(keepTheme(again.history, { palette: DRACULA }, { id: id(4), at: at(15) }).theme.name, 'Count')
  // Different borders make a different theme.
  assert.equal(keepTheme(again.history, { palette: DRACULA, border: '#44475a' }, { id: id(5), at: at(15) }).history.themes.length, 3)
})

test('the list holds twelve, and the oldest goes first', () => {
  let history = NO_THEMES
  for (let n = 1; n <= KEPT_THEMES_MAX + 1; n++) {
    const accent = `#${n.toString(16).padStart(2, '0')}93f9`
    history = keepTheme(history, { palette: { ...DRACULA, accent } }, { id: id(n), at: at(n), name: `Theme ${n}` }).history
  }
  assert.equal(history.themes.length, KEPT_THEMES_MAX)
  assert.equal(history.themes[0]!.name, `Theme ${KEPT_THEMES_MAX + 1}`)
  assert.equal(history.themes.at(-1)!.name, 'Theme 2', 'the first one made is the one that went')
})

test('wearing, renaming, a photo and removing act on one kept theme by its id', () => {
  const one = keepTheme(NO_THEMES, { palette: DRACULA }, { id: id(1), at: at(13), name: 'Dracula' }).history
  const two = keepTheme(one, { palette: BURGER }, { id: id(2), at: at(14), name: 'Burger Joint' }).history

  const worn = wearTheme(two, id(1))
  assert.deepEqual([worn.history.worn, worn.theme.name], [id(1), 'Dracula'])
  assert.deepEqual(worn.history.themes.map(({ id }) => id), [id(2), id(1)], 'wearing one does not move it')
  assert.throws(() => wearTheme(two, id(9)), /No kept theme/)

  const renamed = renameTheme(worn.history, id(2), '  Diner \n Night ')
  assert.equal(renamed.themes[0]!.name, 'Diner Night')
  assert.throws(() => renameTheme(renamed, id(2), '   '), /name/)

  const photographed = photoTheme(renamed, id(1), 'milky-way')
  assert.equal(photographed.themes[1]!.photo, 'milky-way')
  assert.equal(photoTheme(photographed, id(1), null).themes[1]!.photo, undefined)

  // The theme on now stays until another is put on. One not showing goes, and Custom then falls back to the newest.
  assert.throws(() => forgetTheme(photographed, id(1), { showing: true }), /on now/)
  const forgotten = forgetTheme(photographed, id(1), { showing: false })
  assert.deepEqual([forgotten.themes.map(({ id }) => id), forgotten.worn], [[id(2)], null])
  assert.deepEqual(forgetTheme(photographed, id(2), { showing: true }).themes.map(({ id }) => id), [id(1)])
  assert.throws(() => forgetTheme(photographed, id(9), { showing: false }), /No kept theme/)
})

test('the history survives a round trip through its file, and a damaged entry is dropped, not the whole list', () => {
  const kept = keepTheme(keepTheme(NO_THEMES, { palette: DRACULA }, { id: id(1), at: at(13), name: 'Dracula' }).history, { palette: BURGER, border: '#d9c7a3' }, { id: id(2), at: at(14), name: null, asked: 'a burger joint' })
  const history = photoTheme(kept.history, id(1), 'milky-way')
  assert.deepEqual(decodeThemeHistory(encodeThemeHistory(history)), history)
  assert.equal(findColors(history, { palette: BURGER, border: '#d9c7a3' })?.id, id(2))
  assert.equal(findColors(history, { palette: BURGER }), undefined)

  const file = JSON.parse(encodeThemeHistory(history)) as { themes: Record<string, unknown>[] }
  file.themes.push(
    { id: 'not-hex', name: 'Bad id', asked: null, palette: DRACULA, at: at(1) },
    { id: id(7), name: 'Unreadable', asked: null, palette: { ...DRACULA, text: '#282a36' }, at: at(1) },
    { id: id(8), name: 'Script', asked: null, palette: { ...DRACULA, accent: 'url(https://invalid.test/x)' }, at: at(1) },
    { id: id(1), name: 'Twin', asked: null, palette: BURGER, at: at(1) },
  )
  assert.deepEqual(decodeThemeHistory(JSON.stringify(file)), history)
  assert.deepEqual(decodeThemeHistory(JSON.stringify({ ...file, worn: id(9) })).worn, null, 'worn must be a kept theme')
  assert.throws(() => decodeThemeHistory('{"version":2,"themes":[]}'))
  assert.throws(() => decodeThemeHistory('not json'))
})

test('the window and hobkin see the list, which one is worn and whether it is on now', () => {
  const history = keepTheme(NO_THEMES, { palette: DRACULA }, { id: id(1), at: at(13), name: 'Dracula' }).history
  assert.deepEqual(keptThemes(history, true), { themes: history.themes, worn: id(1), showing: true })
  assert.deepEqual(keptThemes(history, false).showing, false)
  assert.deepEqual(keptThemes(NO_THEMES, true), { themes: [], worn: null, showing: false })
})
