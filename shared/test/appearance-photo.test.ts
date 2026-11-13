import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { asBackground, backgroundImageCss, contrast } from '../protocol/appearance.ts'
import { migrateSettings, receiveAppearance } from '../../ui/src/features/settings/rules.ts'

const palette = { background: '#080c1b', surface: '#151b30', text: '#f1f3ff', muted: '#b2bbd5', accent: '#b89af5' }
const photo = { kind: 'photo', id: 'milky-way' } as const

test('bundled photo is the bounded, verified JPEG, not a symlink or substituted active content', () => {
  const path = new URL('../../ui/public/photos/milky-way.jpg', import.meta.url)
  const stat = lstatSync(path)
  assert.ok(stat.isFile())
  assert.ok(stat.size > 0 && stat.size <= 1_500_000)
  const bytes = readFileSync(path)
  assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff')
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '6df7ce3cea79841c15e7d04750c073b6680671efa01be3da5eae433846e28c70')
})

test('local photo background validates and survives settings migration and receipts', () => {
  assert.deepEqual(asBackground(photo), photo)
  assert.deepEqual(migrateSettings({ palette, background: photo }).background, photo)
  assert.deepEqual(receiveAppearance({ appearanceId: 0 }, { id: 1, name: 'Milky Way', palette, background: photo })?.background, photo)
  for (const id of ['../secret', '/image.jpg', 'https://invalid.test/photo.jpg', 'data:image/png;base64,AAAA']) {
    assert.equal(asBackground({ kind: 'photo', id }), null)
  }
  assert.equal(asBackground({ ...photo, url: 'https://invalid.test' }), null)
})

test('photo CSS uses only the bundled asset and a readable palette overlay', () => {
  const css = backgroundImageCss(photo, palette)
  assert.match(css, /url\("\/photos\/milky-way.jpg"\)/)
  const alpha = Number(css.match(/\/ ([.\d]+)\)/)?.[1])
  assert.ok(alpha >= 0.65 && alpha <= 1)
  const channels = [8, 12, 27]
  for (let pixel = 0; pixel <= 255; pixel++) {
    const back = '#' + channels.map(c => Math.round(c * alpha + pixel * (1 - alpha)).toString(16).padStart(2, '0')).join('')
    assert.ok(contrast(palette.text, back) >= 4.5)
    assert.ok(contrast(palette.muted, back) >= 4.5)
  }
})
