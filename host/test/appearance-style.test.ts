import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeAppearanceStyle, encodeAppearanceStyle } from '../src/appearance-style.ts'

const palette = { background: '#000000', surface: '#07140a', text: '#9dffb0', muted: '#4fbf6a', accent: '#00ff41' }
const declarations = '--hb-bg: #000000; --hb-surface: #07140a; --hb-text: #9dffb0; --hb-muted: #4fbf6a; --hb-accent: #00ff41;'
const artifact = (body = declarations) => `:root { ${body} }`

test('decodes only typed colors and canonicalizes casing, ordering and optional borders', () => {
  const value = decodeAppearanceStyle(artifact(`${declarations} --hb-border-strong: #AABBCC; --hb-border: #123456;`))
  assert.deepEqual(value, { palette, border: '#123456', borderStrong: '#aabbcc' })
  const canonical = encodeAppearanceStyle(value)
  assert.deepEqual(decodeAppearanceStyle(canonical), value)
  const reordered = artifact(`--hb-accent: #00FF41; --hb-muted: #4FBF6A; --hb-text: #9DFFB0; --hb-surface: #07140A; --hb-bg: #000000; --hb-border: #123456; --hb-border-strong: #AABBCC;`)
  assert.equal(encodeAppearanceStyle(decodeAppearanceStyle(reordered)), canonical)
  assert.deepEqual(decodeAppearanceStyle(artifact()), { palette })
})

test('refuses unsupported CSS rather than filtering it into an accepted palette', () => {
  const bodies = [
    `${declarations} --hb-bg: #ffffff;`, `${declarations} --hb-radius: #ffffff;`,
    declarations.replace('#000000', 'var(--other)'), declarations.replace('#000000', 'url(https://example.invalid/a)'),
    declarations.replace('#000000', 'rgb(0 0 0)'), declarations.replace('#000000', '#000'),
    declarations.replace('#000000', '#000000 !important'), declarations.replace('--hb-bg', '--hb-\\62g'),
    `${declarations} /* comment */`, `${declarations} color: #ffffff;`, `${declarations} ;`,
    declarations.replace('--hb-accent: #00ff41;', ''), `${declarations} --hb-border: red;`,
  ]
  for (const body of bodies) assert.throws(() => decodeAppearanceStyle(artifact(body)), Error, body)
  for (const input of [artifact() + ' .x {}', '@import "x";' + artifact(), ':root:root {' + declarations + '}',
    artifact() + artifact(), artifact().replace(':root', 'body'), artifact() + '\u0000', null, {}, ' '.repeat(4097)]) {
    assert.throws(() => decodeAppearanceStyle(input), Error)
  }
})

test('bounds artifact size before parsing, including multibyte input', () => {
  const valid = artifact()
  assert.deepEqual(decodeAppearanceStyle(valid.padEnd(4096, ' ')), { palette })
  assert.throws(() => decodeAppearanceStyle(valid.padEnd(4097, ' ')), /4096 bytes/)
  assert.throws(() => decodeAppearanceStyle('é'.repeat(2049)), /4096 bytes/)
})

test('rejects trailing line terminators in every encoded color', () => {
  for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
    for (const key of Object.keys(palette) as (keyof typeof palette)[]) {
      assert.throws(() => encodeAppearanceStyle({ palette: { ...palette, [key]: `#123456${terminator}` } }), Error)
    }
    for (const key of ['border', 'borderStrong'] as const) {
      assert.throws(() => encodeAppearanceStyle({ palette, [key]: `#123456${terminator}` }), Error)
    }
  }
})

test('preserves all four text/background contrast checks and validates encoder input', () => {
  for (const [token, color] of [['--hb-text', '#000000'], ['--hb-muted', '#000000'],
    ['--hb-bg', '#ffffff'], ['--hb-surface', '#ffffff']]) {
    const changed = declarations.replace(new RegExp(`${token}: #[0-9a-f]{6}`), `${token}: ${color}`)
    assert.throws(() => decodeAppearanceStyle(artifact(changed)), /Reading needs 4\.5/)
  }
  assert.throws(() => encodeAppearanceStyle({ palette: { ...palette, text: '#000000' } }), /Reading needs 4\.5/)
  assert.throws(() => encodeAppearanceStyle({ palette, border: 'url(x)' }), Error)
  assert.throws(() => encodeAppearanceStyle({ palette, borderStrong: '#fff' }), Error)
})
