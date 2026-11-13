import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  adjustedPalette,
  asBackground,
  backgroundImageCss,
  contrast,
  paletteProblems,
  type Palette,
} from '../protocol/appearance.ts'

const VIVID_DAY: Palette = {
  // "A One Piece sunshine day": sky-blue background, cream cards, deep-ocean text, Luffy-red accent.
  background: '#6fb7ff',
  surface: '#fff6e0',
  text: '#0a2a5e',
  muted: '#3a6ea5',
  accent: '#e62329',
}

test('a readable palette is returned unchanged, color for color', () => {
  const readable: Palette = { background: '#0e0f13', surface: '#17191f', text: '#f0ead6', muted: '#a8a291', accent: '#ffc940' }
  assert.deepEqual(adjustedPalette(readable), readable)
})

test('a vivid palette keeps its background, surface and accent, and only its text is nudged to read', () => {
  const adjusted = adjustedPalette(VIVID_DAY)!
  assert.equal(adjusted.background, VIVID_DAY.background, 'the sky-blue background survives exactly')
  assert.equal(adjusted.surface, VIVID_DAY.surface, 'the cream cards survive exactly')
  assert.equal(adjusted.accent, VIVID_DAY.accent, 'the Luffy-red accent survives exactly')
  assert.deepEqual(paletteProblems(adjusted), [], 'and every text color now reads 4.5 to 1')
})

test('text that is already far too faint is pushed all the way until it reads', () => {
  // Near-black muted text on a dark background: the whole range toward white is needed.
  const faint: Palette = { background: '#101010', surface: '#1b1b1b', text: '#131313', muted: '#151515', accent: '#ff8800' }
  const adjusted = adjustedPalette(faint)!
  assert.deepEqual(paletteProblems(adjusted), [])
  assert.ok(contrast(adjusted.text, faint.background) >= 4.5)
})

test('a value that is not five hex colors is not a palette', () => {
  assert.equal(adjustedPalette({ background: '#000000' }), null)
  assert.equal(adjustedPalette(null), null)
  assert.equal(adjustedPalette({ ...VIVID_DAY, accent: 'red' }), null)
})

test('a gradient backdrop is accepted only as a bare, balanced CSS gradient', () => {
  const ok = asBackground({ kind: 'gradient', value: 'linear-gradient(180deg, #6fb7ff 0%, #fff6e0 100%)' })
  assert.deepEqual(ok, { kind: 'gradient', value: 'linear-gradient(180deg, #6fb7ff 0%, #fff6e0 100%)' })
  assert.equal(backgroundImageCss(ok!), 'linear-gradient(180deg, #6fb7ff 0%, #fff6e0 100%)')
  assert.deepEqual(asBackground({ kind: 'gradient', value: 'RADIAL-GRADIENT(circle, #fff, #000)' }), { kind: 'gradient', value: 'radial-gradient(circle, #fff, #000)' }, 'case is normalized')
  // Anything that is not purely a gradient is refused.
  assert.equal(asBackground({ kind: 'gradient', value: 'red; } body { display: none' }), null)
  assert.equal(asBackground({ kind: 'gradient', value: 'linear-gradient(#000) url(https://evil.test/x.png)' }), null)
  assert.equal(asBackground({ kind: 'gradient', value: 'linear-gradient(var(--x), #000)' }), null)
  assert.equal(asBackground({ kind: 'gradient', value: 'linear-gradient(#000' }), null, 'unbalanced parentheses are refused')
})

test('an image backdrop is accepted only as an https or base64 data-image URL, and refuses SVG', () => {
  const https = asBackground({ kind: 'image', url: 'https://cdn.test/one-piece-day.png' })
  assert.deepEqual(https, { kind: 'image', url: 'https://cdn.test/one-piece-day.png' })
  assert.equal(backgroundImageCss(https!), 'url("https://cdn.test/one-piece-day.png")')
  assert.ok(asBackground({ kind: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEA' }))
  assert.equal(asBackground({ kind: 'image', url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }), null, 'SVG can carry script, so it is refused')
  assert.equal(asBackground({ kind: 'image', url: 'http://cdn.test/x.png' }), null, 'plain http is refused')
  assert.equal(asBackground({ kind: 'image', url: 'https://cdn.test/x.png") ; background: red' }), null, 'a url that could break out of url("") is refused')
  assert.equal(asBackground({ kind: 'image', url: 'javascript:alert(1)' }), null)
})

test('an absent or unknown backdrop is null', () => {
  assert.equal(asBackground(undefined), null)
  assert.equal(asBackground({ kind: 'video', url: 'https://cdn.test/x.mp4' }), null)
})
